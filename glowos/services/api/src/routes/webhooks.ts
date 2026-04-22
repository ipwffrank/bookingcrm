import { Hono } from "hono";
import type Stripe from "stripe";
import { eq, and, desc, gt } from "drizzle-orm";
import twilioPkg from "twilio";
import {
  db,
  merchants,
  services,
  slotLeases,
  bookings,
  clients,
  clientProfiles,
  notificationLog,
  whatsappInboundLog,
} from "@glowos/db";
import { stripe } from "../lib/stripe.js";
import { config } from "../lib/config.js";
import { normalizePhone, normalizeEmail } from "../lib/normalize.js";
import { findOrCreateClient } from "../lib/findOrCreateClient.js";
import { invalidateAvailabilityCacheByMerchantId } from "../lib/availability.js";
import { addJob } from "../lib/queue.js";
import { scheduleReminder } from "../lib/scheduler.js";
import type { AppVariables } from "../lib/types.js";

const webhooksRouter = new Hono<{ Variables: AppVariables }>();

// ─── Helpers ───────────────────────────────────────────────────────────────────

async function findOrCreateClientProfile(
  merchantId: string,
  clientId: string
): Promise<{ id: string }> {
  const [existing] = await db
    .select({ id: clientProfiles.id })
    .from(clientProfiles)
    .where(
      and(
        eq(clientProfiles.merchantId, merchantId),
        eq(clientProfiles.clientId, clientId)
      )
    )
    .limit(1);

  if (existing) return existing;

  const [created] = await db
    .insert(clientProfiles)
    .values({ merchantId, clientId })
    .returning({ id: clientProfiles.id });

  if (!created) throw new Error("Failed to create client profile");
  return created;
}

// ─── POST /webhooks/stripe ────────────────────────────────────────────────────
//
// IMPORTANT: Stripe requires the RAW (un-parsed) request body for signature
// verification. In Hono we read c.req.raw.body (the ReadableStream from the
// underlying Request object) before any JSON parsing. The route is intentionally
// NOT wrapped with zValidator so the body is never parsed by the framework.

webhooksRouter.post("/stripe", async (c) => {
  const signature = c.req.header("stripe-signature");

  if (!signature) {
    return c.json({ error: "Bad Request", message: "Missing Stripe signature" }, 400);
  }

  // Read the raw body as text (Stripe needs the exact bytes)
  const rawBody = await c.req.text();

  // 1. Verify webhook signature — reject forged/replayed events immediately
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, config.stripeWebhookSecret);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Signature verification failed";
    console.error("[Webhook] Signature verification failed:", message);
    return c.json({ error: "Unauthorized", message }, 401);
  }

  // 2. Acknowledge immediately — Stripe requires < 5 s response
  //    We process synchronously here (within the request lifetime) but return
  //    early via the response only when we're done. For heavy workloads this
  //    should be moved to a background queue.

  console.log(`[Webhook] Received event: ${event.type} id=${event.id}`);

  try {
    switch (event.type) {
      // ── payment_intent.succeeded ─────────────────────────────────────────────
      case "payment_intent.succeeded": {
        const pi = event.data.object as Stripe.PaymentIntent;
        const meta = pi.metadata as {
          merchant_id?: string;
          lease_id?: string;
          service_id?: string;
          booking_source?: string;
          client_name?: string;
          client_email?: string;
          client_phone?: string;
          client_id?: string;
          first_timer_discount_applied?: string;
        };

        const { merchant_id, lease_id, service_id, booking_source } = meta;
        const firstTimerDiscountApplied = meta?.first_timer_discount_applied === "true";

        if (!merchant_id || !lease_id || !service_id) {
          console.warn("[Webhook] payment_intent.succeeded missing required metadata, skipping", {
            payment_intent_id: pi.id,
          });
          break;
        }

        // Load the lease to get slot details
        const [lease] = await db
          .select()
          .from(slotLeases)
          .where(
            and(eq(slotLeases.id, lease_id), eq(slotLeases.merchantId, merchant_id))
          )
          .limit(1);

        if (!lease) {
          console.warn("[Webhook] Lease not found (may have already been consumed)", {
            lease_id,
            payment_intent_id: pi.id,
          });
          break;
        }

        // Load service for price and duration
        const [service] = await db
          .select({
            priceSgd: services.priceSgd,
            durationMinutes: services.durationMinutes,
          })
          .from(services)
          .where(and(eq(services.id, service_id), eq(services.merchantId, merchant_id)))
          .limit(1);

        if (!service) {
          console.warn("[Webhook] Service not found", { service_id });
          break;
        }

        // Load merchant country for phone normalization default
        const [merchant] = await db
          .select({ country: merchants.country })
          .from(merchants)
          .where(eq(merchants.id, merchant_id))
          .limit(1);

        if (!merchant) {
          console.warn("[Webhook] Merchant not found", { merchant_id });
          break;
        }

        const defaultCountry = merchant.country;

        // Resolve customer details — prefer metadata (passed from booking form)
        // over billing_details (often incomplete for card/PayNow/GrabPay).
        let clientPhone = meta.client_phone || "";
        let clientName = meta.client_name || undefined;
        let clientEmail = meta.client_email || undefined;

        // Fall back to billing_details from the charge if metadata is empty
        if (!clientPhone && pi.latest_charge && typeof pi.latest_charge === "string") {
          try {
            const charge = await stripe.charges.retrieve(pi.latest_charge);
            clientPhone = charge.billing_details?.phone ?? "";
            if (!clientName) clientName = charge.billing_details?.name ?? undefined;
            if (!clientEmail) clientEmail = charge.billing_details?.email ?? undefined;
          } catch (err) {
            console.warn("[Webhook] Failed to retrieve charge for billing details", err);
          }
        }

        // Fall back to PaymentIntent-level receipt email
        if (!clientEmail && pi.receipt_email) {
          clientEmail = pi.receipt_email;
        }

        // If a pre-authenticated client_id was provided (Google Sign-In),
        // use it directly instead of creating a new client from phone.
        let client: { id: string };

        if (meta.client_id) {
          const [existing] = await db
            .select({ id: clients.id })
            .from(clients)
            .where(eq(clients.id, meta.client_id))
            .limit(1);

          if (existing) {
            client = existing;
            // Update phone/name/email if the form provided newer values (normalized).
            const normalizedPhone =
              clientPhone && !clientPhone.startsWith("pi_")
                ? normalizePhone(clientPhone, defaultCountry)
                : null;
            const normalizedEmail = normalizeEmail(clientEmail);
            await db
              .update(clients)
              .set({
                ...(normalizedPhone ? { phone: normalizedPhone } : {}),
                ...(clientName ? { name: clientName } : {}),
                ...(normalizedEmail ? { email: normalizedEmail } : {}),
              })
              .where(eq(clients.id, client.id));
          } else {
            // client_id not found — fall through to phone-based lookup
            if (!clientPhone) clientPhone = `pi_${pi.id}`;
            try {
              client = await findOrCreateClient(
                clientPhone,
                clientName,
                clientEmail,
                defaultCountry
              );
            } catch {
              console.error("[Webhook] Invalid phone, skipping client creation", {
                clientPhone,
                payment_intent_id: pi.id,
              });
              break;
            }
          }
        } else {
          // No client_id — use phone-based lookup (guest checkout)
          if (!clientPhone) clientPhone = `pi_${pi.id}`;
          try {
            client = await findOrCreateClient(
              clientPhone,
              clientName,
              clientEmail,
              defaultCountry
            );
          } catch {
            console.error("[Webhook] Invalid phone, skipping client creation", {
              clientPhone,
              payment_intent_id: pi.id,
            });
            break;
          }
        }

        await findOrCreateClientProfile(merchant_id, client.id);

        // Calculate commission amounts
        const priceSgd = parseFloat(String(service.priceSgd));
        const source = booking_source ?? "direct_widget";

        let commissionRate = 0;
        if (source === "google_reserve") commissionRate = 0.1;
        else if (source === "google_gbp_link") commissionRate = 0.075;

        const commissionSgd = parseFloat((priceSgd * commissionRate).toFixed(2));
        const merchantPayoutSgd = parseFloat((priceSgd - commissionSgd).toFixed(2));

        // Retrieve the charge ID
        const chargeId =
          typeof pi.latest_charge === "string" ? pi.latest_charge : undefined;

        // Create the confirmed booking
        const [booking] = await db
          .insert(bookings)
          .values({
            merchantId: merchant_id,
            clientId: client.id,
            serviceId: service_id,
            staffId: lease.staffId,
            startTime: lease.startTime,
            endTime: lease.endTime,
            durationMinutes: service.durationMinutes,
            status: "confirmed",
            priceSgd: service.priceSgd,
            paymentStatus: "paid",
            paymentMethod: "card",
            bookingSource: source,
            commissionRate: commissionRate.toFixed(4),
            commissionSgd: commissionSgd.toFixed(2),
            merchantPayoutSgd: merchantPayoutSgd.toFixed(2),
            stripePaymentIntentId: pi.id,
            stripeChargeId: chargeId,
            firstTimerDiscountApplied,
          })
          .returning();

        // Delete the used lease to free the slot
        await db.delete(slotLeases).where(eq(slotLeases.id, lease_id));
        await invalidateAvailabilityCacheByMerchantId(merchant_id);

        console.log("[Webhook] Booking created from payment_intent.succeeded", {
          booking_id: booking?.id,
          payment_intent_id: pi.id,
        });

        // Queue post-booking jobs
        if (booking) {
          await addJob("notifications", "booking_confirmation", { booking_id: booking.id });
          await addJob("crm", "update_client_profile", { booking_id: booking.id });
          await addJob("vip", "rescore_client", {
            merchant_id: booking.merchantId,
            client_id: booking.clientId,
          });
          await scheduleReminder(booking.id, booking.startTime);
        }

        break;
      }

      // ── payment_intent.payment_failed ────────────────────────────────────────
      case "payment_intent.payment_failed": {
        const pi = event.data.object as Stripe.PaymentIntent;
        const { lease_id, merchant_id } = pi.metadata as {
          lease_id?: string;
          merchant_id?: string;
        };

        if (!lease_id || !merchant_id) {
          console.warn("[Webhook] payment_intent.payment_failed missing metadata", {
            payment_intent_id: pi.id,
          });
          break;
        }

        // Free the slot by deleting the lease
        await db
          .delete(slotLeases)
          .where(and(eq(slotLeases.id, lease_id), eq(slotLeases.merchantId, merchant_id)));

        await invalidateAvailabilityCacheByMerchantId(merchant_id);

        console.log("[Webhook] Lease released after payment failure", {
          lease_id,
          payment_intent_id: pi.id,
          failure_message: pi.last_payment_error?.message,
        });
        break;
      }

      // ── charge.refunded ──────────────────────────────────────────────────────
      case "charge.refunded": {
        const charge = event.data.object as Stripe.Charge;

        // Find the booking by stripe_charge_id
        const [booking] = await db
          .select()
          .from(bookings)
          .where(eq(bookings.stripeChargeId, charge.id))
          .limit(1);

        if (!booking) {
          console.warn("[Webhook] charge.refunded: no booking found for charge", {
            charge_id: charge.id,
          });
          break;
        }

        const totalRefunded = charge.amount_refunded / 100; // convert cents → SGD
        const chargeAmount = charge.amount / 100;
        const isFullRefund = charge.refunded && charge.amount_refunded >= charge.amount;

        // Find the latest refund ID (Stripe puts most-recent first)
        const latestRefund = charge.refunds?.data?.[0];

        const updates: Partial<typeof bookings.$inferInsert> = {
          refundAmountSgd: totalRefunded.toFixed(2),
          stripeRefundId: latestRefund?.id,
          updatedAt: new Date(),
        };

        if (isFullRefund) {
          updates.paymentStatus = "refunded";
          updates.commissionSgd = "0";
        } else if (totalRefunded > 0) {
          updates.paymentStatus = "partially_refunded";
        }

        await db.update(bookings).set(updates).where(eq(bookings.id, booking.id));

        console.log("[Webhook] charge.refunded processed", {
          charge_id: charge.id,
          booking_id: booking.id,
          refunded_sgd: totalRefunded,
          full_refund: isFullRefund,
        });

        // Notify client of refund
        await addJob("notifications", "refund_confirmation", { booking_id: booking.id });

        break;
      }

      // ── account.updated (Connect) ────────────────────────────────────────────
      case "account.updated": {
        const account = event.data.object as Stripe.Account;

        // Find the merchant by stripe_account_id
        const [merchant] = await db
          .select({ id: merchants.id })
          .from(merchants)
          .where(eq(merchants.stripeAccountId, account.id))
          .limit(1);

        if (!merchant) {
          // This can fire for accounts we don't recognise — not an error
          console.warn("[Webhook] account.updated: no merchant found for Stripe account", {
            account_id: account.id,
          });
          break;
        }

        // When charges_enabled flips to true, mark the merchant as payment-ready
        // (we surface this via the connect-status endpoint; no extra DB column needed
        // because we always re-query Stripe for live status).
        console.log("[Webhook] account.updated", {
          account_id: account.id,
          merchant_id: merchant.id,
          charges_enabled: account.charges_enabled,
          payouts_enabled: account.payouts_enabled,
          details_submitted: account.details_submitted,
        });

        await db
          .update(merchants)
          .set({ updatedAt: new Date() })
          .where(eq(merchants.id, merchant.id));

        break;
      }

      default:
        console.log(`[Webhook] Unhandled event type: ${event.type}`);
    }
  } catch (err) {
    // Log processing errors but still return 200 so Stripe doesn't retry
    // indefinitely for transient errors. Persistent failures should be
    // investigated via the Stripe dashboard event log.
    console.error("[Webhook] Error processing event", {
      event_type: event.type,
      event_id: event.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return c.json({ received: true });
});

// ─── POST /webhooks/twilio/whatsapp-inbound ───────────────────────────────────
//
// Twilio posts application/x-www-form-urlencoded with (at minimum):
//   From       - e.g. "whatsapp:+6591234567"
//   Body       - the reply text
//   MessageSid - unique Twilio message id
//
// We validate the signature against the auth token, normalize the phone,
// attribute to the merchant whose last outbound we sent this number, and
// insert into whatsapp_inbound_log. Response is an empty TwiML body so
// Twilio doesn't auto-reply on our behalf.
//
// Signature algorithm (Twilio docs): HMAC-SHA1 of url + sorted(POST params)
// with the account auth token as key, base64-encoded. The twilio SDK wraps
// that as `validateRequest`.

const ATTRIBUTION_WINDOW_HOURS = 72;

webhooksRouter.post("/twilio/whatsapp-inbound", async (c) => {
  // Body parsing — Twilio sends form-urlencoded.
  const body = await c.req.parseBody();
  const params: Record<string, string> = {};
  for (const [k, v] of Object.entries(body)) {
    if (typeof v === "string") params[k] = v;
  }

  // Signature validation. In dev we may not have Twilio configured — skip
  // validation cleanly rather than 403'ing local test requests.
  if (config.twilioAuthToken && config.nodeEnv === "production") {
    const signature = c.req.header("x-twilio-signature") ?? "";
    // Build the public URL Twilio signed against. We honor x-forwarded-proto
    // because the API sits behind Vercel/Neon-edge.
    const proto = c.req.header("x-forwarded-proto") ?? "https";
    const host = c.req.header("x-forwarded-host") ?? c.req.header("host") ?? "";
    const url = `${proto}://${host}${c.req.path}`;

    const valid = twilioPkg.validateRequest(
      config.twilioAuthToken,
      signature,
      url,
      params,
    );
    if (!valid) {
      console.warn("[Webhook] Twilio signature invalid", { url });
      return c.text("Invalid signature", 403);
    }
  }

  const rawFrom = params.From ?? "";
  const sid = params.MessageSid ?? "";
  const text = params.Body ?? "";

  // Strip "whatsapp:" prefix. Everything else should be E.164.
  const fromPhone = normalizePhone(rawFrom.replace(/^whatsapp:/i, ""));
  if (!fromPhone || !sid) {
    // Twilio expects a 2xx so it doesn't retry; log and swallow.
    console.warn("[Webhook] whatsapp-inbound missing From/MessageSid", { rawFrom, sid });
    return c.text("<Response/>", 200, { "content-type": "text/xml" });
  }

  // Idempotency — if Twilio retries we'd otherwise double-insert. The
  // twilio_message_sid column is UNIQUE; catching the duplicate and returning
  // early is cheaper than a SELECT first.
  const existing = await db
    .select({ id: whatsappInboundLog.id })
    .from(whatsappInboundLog)
    .where(eq(whatsappInboundLog.twilioMessageSid, sid))
    .limit(1);
  if (existing.length > 0) {
    return c.text("<Response/>", 200, { "content-type": "text/xml" });
  }

  // Attribute the inbound to the merchant whose most recent outbound WhatsApp
  // we sent to this phone within ATTRIBUTION_WINDOW_HOURS. Outside the window,
  // attribution is ambiguous and we store merchant_id = null.
  const windowStart = new Date(
    Date.now() - ATTRIBUTION_WINDOW_HOURS * 60 * 60 * 1000,
  );
  const [lastOutbound] = await db
    .select({
      merchantId: notificationLog.merchantId,
      clientId: notificationLog.clientId,
    })
    .from(notificationLog)
    .where(
      and(
        eq(notificationLog.channel, "whatsapp"),
        eq(notificationLog.recipient, fromPhone),
        gt(notificationLog.sentAt, windowStart),
      ),
    )
    .orderBy(desc(notificationLog.sentAt))
    .limit(1);

  let matchedClientId: string | null = lastOutbound?.clientId ?? null;
  const merchantId: string | null = lastOutbound?.merchantId ?? null;

  // Fallback: if attribution didn't surface a client_id on the outbound log
  // row, look up the client by phone. The clients table has a global unique
  // phone, so this is a direct lookup — one client per E.164 number.
  if (!matchedClientId) {
    const [clientMatch] = await db
      .select({ id: clients.id })
      .from(clients)
      .where(eq(clients.phone, fromPhone))
      .limit(1);
    matchedClientId = clientMatch?.id ?? null;
  }

  await db.insert(whatsappInboundLog).values({
    merchantId,
    fromPhone,
    body: text,
    matchedClientId,
    twilioMessageSid: sid,
  });

  return c.text("<Response/>", 200, { "content-type": "text/xml" });
});

export { webhooksRouter };
