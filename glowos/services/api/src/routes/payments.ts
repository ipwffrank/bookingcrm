import { Hono } from "hono";
import { and, eq, desc, count, gte } from "drizzle-orm";
import { z } from "zod";
import { db, merchants, services, slotLeases, payouts, bookings, clients } from "@glowos/db";
import { requireMerchant, requireRole } from "../middleware/auth.js";
import { zValidator } from "../middleware/validate.js";
import { stripe } from "../lib/stripe.js";
import { config } from "../lib/config.js";
import { processRefund } from "../lib/refunds.js";
import { normalizePhone, normalizeEmail } from "../lib/normalize.js";
import { isFirstTimerAtMerchant } from "../lib/firstTimerCheck.js";
import { verifyVerificationToken } from "../lib/jwt.js";
import type { AppVariables } from "../lib/types.js";

const paymentsRouter = new Hono<{ Variables: AppVariables }>();

// ─── Schemas ───────────────────────────────────────────────────────────────────

const connectAccountSchema = z.object({
  business_type: z.enum(["individual", "company"]).default("individual"),
});

const createPaymentIntentSchema = z.object({
  lease_id: z.string().uuid(),
  service_id: z.string().uuid(),
  client_name: z.string().optional(),
  client_email: z.string().email().optional(),
  client_phone: z.string().optional(),
  client_id: z.string().uuid().optional(),
  verification_token: z.string().optional(),
  booking_source: z
    .enum([
      "google_reserve",
      "google_gbp_link",
      "direct_widget",
      "instagram",
      "qr_walkin",
      "walkin_manual",
      "embedded_widget",
    ])
    .default("direct_widget"),
});

const refundSchema = z.object({
  refund_type: z.enum(["full", "partial"]),
});

// ─── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Returns the GlowOS platform commission rate for a given booking source.
 * google_reserve: 10%, google_gbp_link: 7.5%, all direct/organic: 0%
 */
function getCommissionRate(bookingSource: string): number {
  switch (bookingSource) {
    case "google_reserve":
      return 0.1;
    case "google_gbp_link":
      return 0.075;
    default:
      return 0;
  }
}

// ─── POST /merchant/payments/connect-account ──────────────────────────────────

paymentsRouter.post(
  "/connect-account",
  requireMerchant,
  requireRole("owner"),
  zValidator(connectAccountSchema),
  async (c) => {
    const merchantId = c.get("merchantId")!;
    const body = c.get("body") as z.infer<typeof connectAccountSchema>;

    // Load merchant
    const [merchant] = await db
      .select({
        id: merchants.id,
        email: merchants.email,
        stripeAccountId: merchants.stripeAccountId,
      })
      .from(merchants)
      .where(eq(merchants.id, merchantId))
      .limit(1);

    if (!merchant) {
      return c.json({ error: "Not Found", message: "Merchant not found" }, 404);
    }

    let stripeAccountId = merchant.stripeAccountId;

    // 1. Create a new Connect Express account if one doesn't exist
    if (!stripeAccountId) {
      const account = await stripe.accounts.create({
        type: "express",
        country: "SG",
        email: merchant.email ?? undefined,
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true },
        },
        business_type: body.business_type,
      });

      stripeAccountId = account.id;

      // Persist the account ID immediately
      await db
        .update(merchants)
        .set({ stripeAccountId, updatedAt: new Date() })
        .where(eq(merchants.id, merchantId));
    }

    // 2. Create an Account Link for the onboarding flow
    const accountLink = await stripe.accountLinks.create({
      account: stripeAccountId,
      refresh_url: `${config.frontendUrl}/dashboard/settings?tab=payments&refresh=true`,
      return_url: `${config.frontendUrl}/dashboard/settings?tab=payments&setup=complete`,
      type: "account_onboarding",
    });

    return c.json(
      {
        account_id: stripeAccountId,
        onboarding_url: accountLink.url,
      },
      201
    );
  }
);

// ─── GET /merchant/payments/connect-status ────────────────────────────────────

paymentsRouter.get(
  "/connect-status",
  requireMerchant,
  requireRole("owner"),
  async (c) => {
    const merchantId = c.get("merchantId")!;

    const [merchant] = await db
      .select({ stripeAccountId: merchants.stripeAccountId })
      .from(merchants)
      .where(eq(merchants.id, merchantId))
      .limit(1);

    if (!merchant) {
      return c.json({ error: "Not Found", message: "Merchant not found" }, 404);
    }

    if (!merchant.stripeAccountId) {
      return c.json({
        connected: false,
        charges_enabled: false,
        payouts_enabled: false,
        details_submitted: false,
        requirements: null,
      });
    }

    const account = await stripe.accounts.retrieve(merchant.stripeAccountId);

    return c.json({
      connected: true,
      charges_enabled: account.charges_enabled,
      payouts_enabled: account.payouts_enabled,
      details_submitted: account.details_submitted,
      requirements: account.requirements,
    });
  }
);

// ─── POST /merchant/payments/connect-dashboard-link ───────────────────────────

paymentsRouter.post(
  "/connect-dashboard-link",
  requireMerchant,
  requireRole("owner"),
  async (c) => {
    const merchantId = c.get("merchantId")!;

    const [merchant] = await db
      .select({ stripeAccountId: merchants.stripeAccountId })
      .from(merchants)
      .where(eq(merchants.id, merchantId))
      .limit(1);

    if (!merchant) {
      return c.json({ error: "Not Found", message: "Merchant not found" }, 404);
    }

    if (!merchant.stripeAccountId) {
      return c.json(
        { error: "Bad Request", message: "No Stripe account connected. Complete onboarding first." },
        400
      );
    }

    const loginLink = await stripe.accounts.createLoginLink(merchant.stripeAccountId);

    return c.json({ url: loginLink.url });
  }
);

// ─── GET /merchant/payouts ────────────────────────────────────────────────────

paymentsRouter.get("/payouts", requireMerchant, requireRole("owner"), async (c) => {
  const merchantId = c.get("merchantId")!;
  const statusParam = c.req.query("status");
  const limit = Math.min(parseInt(c.req.query("limit") ?? "20", 10), 100);
  const offset = parseInt(c.req.query("offset") ?? "0", 10);

  const conditions = [eq(payouts.merchantId, merchantId)];

  if (statusParam) {
    conditions.push(
      eq(
        payouts.status,
        statusParam as "pending" | "paid" | "failed"
      )
    );
  }

  const [rows, [totalRow]] = await Promise.all([
    db
      .select()
      .from(payouts)
      .where(and(...conditions))
      .orderBy(desc(payouts.payoutDate))
      .limit(limit)
      .offset(offset),
    db.select({ total: count() }).from(payouts).where(and(...conditions)),
  ]);

  return c.json({
    payouts: rows,
    total: totalRow?.total ?? 0,
    limit,
    offset,
  });
});

// ─── GET /merchant/payouts/:id ────────────────────────────────────────────────

paymentsRouter.get("/payouts/:id", requireMerchant, requireRole("owner"), async (c) => {
  const merchantId = c.get("merchantId")!;
  const payoutId = c.req.param("id")!;

  const [payout] = await db
    .select()
    .from(payouts)
    .where(and(eq(payouts.id, payoutId), eq(payouts.merchantId, merchantId)))
    .limit(1);

  if (!payout) {
    return c.json({ error: "Not Found", message: "Payout not found" }, 404);
  }

  // Load associated bookings if any
  let payoutBookings: typeof bookings.$inferSelect[] = [];
  if (payout.bookingIds && payout.bookingIds.length > 0) {
    payoutBookings = await db
      .select()
      .from(bookings)
      .where(and(eq(bookings.merchantId, merchantId)));
    // Filter in memory to the payout's booking IDs (avoids inArray type issues
    // with the uuid[] column from Drizzle)
    payoutBookings = payoutBookings.filter((b) =>
      (payout.bookingIds as string[]).includes(b.id)
    );
  }

  return c.json({ payout, bookings: payoutBookings });
});

// ─── POST /booking/:slug/create-payment-intent ────────────────────────────────
// Public — called from booking widget after lease is obtained.
// Decision: payment_intent.succeeded webhook creates the booking record.
// POST /booking/:slug/confirm remains for cash/manual bookings only.

paymentsRouter.post("/:slug/create-payment-intent", zValidator(createPaymentIntentSchema), async (c) => {
  const slug = c.req.param("slug")!;
  const body = c.get("body") as z.infer<typeof createPaymentIntentSchema>;

  // 1. Resolve merchant
  const [merchant] = await db
    .select({
      id: merchants.id,
      name: merchants.name,
      stripeAccountId: merchants.stripeAccountId,
    })
    .from(merchants)
    .where(eq(merchants.slug, slug))
    .limit(1);

  if (!merchant) {
    return c.json({ error: "Not Found", message: "Salon not found" }, 404);
  }

  if (!merchant.stripeAccountId) {
    return c.json(
      { error: "Bad Request", message: "This salon has not completed payment setup yet." },
      400
    );
  }

  // 2. Load and validate the lease
  const now = new Date();
  const [lease] = await db
    .select()
    .from(slotLeases)
    .where(
      and(
        eq(slotLeases.id, body.lease_id),
        eq(slotLeases.merchantId, merchant.id),
        gte(slotLeases.expiresAt, now)
      )
    )
    .limit(1);

  if (!lease) {
    return c.json(
      { error: "Gone", message: "Lease not found or has expired. Please select a new slot." },
      410
    );
  }

  // 3. Load service for price + discount
  const [service] = await db
    .select({
      id: services.id,
      name: services.name,
      priceSgd: services.priceSgd,
      discountPct: services.discountPct,
      firstTimerDiscountPct: services.firstTimerDiscountPct,
      firstTimerDiscountEnabled: services.firstTimerDiscountEnabled,
    })
    .from(services)
    .where(and(eq(services.id, body.service_id), eq(services.merchantId, merchant.id)))
    .limit(1);

  if (!service) {
    return c.json({ error: "Not Found", message: "Service not found" }, 404);
  }

  // 4. Calculate amounts (apply discounts)
  const basePrice = parseFloat(String(service.priceSgd));
  let priceSgd = basePrice;

  if (service.discountPct) {
    priceSgd = basePrice * (1 - service.discountPct / 100);
  }

  // Server-side first-timer: default-deny unless a valid verification token matches.
  if (
    service.firstTimerDiscountEnabled &&
    service.firstTimerDiscountPct &&
    body.verification_token
  ) {
    const token = verifyVerificationToken(body.verification_token);
    if (token) {
      const defaultCountry: "SG" | "MY" = "SG";
      const normalizedPhone = normalizePhone(body.client_phone, defaultCountry);
      const normalizedEmail = normalizeEmail(body.client_email);

      let identityMatches = false;
      switch (token.purpose) {
        case "google_verify": {
          if (body.client_id && token.google_id) {
            const [existing] = await db
              .select({ googleId: clients.googleId })
              .from(clients)
              .where(eq(clients.id, body.client_id))
              .limit(1);
            if (existing?.googleId && existing.googleId === token.google_id) {
              identityMatches = true;
            }
          }
          break;
        }
        case "first_timer_verify": {
          if (token.phone && normalizedPhone && token.phone === normalizedPhone) {
            identityMatches = true;
          }
          break;
        }
        default: {
          // Any other purpose (e.g., "login") is explicitly rejected for discount eligibility.
          console.warn("[first-timer] rejected token with unsupported purpose", {
            purpose: token.purpose,
          });
          break;
        }
      }

      if (identityMatches) {
        const eligible = await isFirstTimerAtMerchant({
          merchantId: merchant.id,
          normalizedPhone,
          normalizedEmail,
          googleId: token.google_id ?? null,
        });
        if (eligible) {
          const firstTimerPrice = basePrice * (1 - service.firstTimerDiscountPct / 100);
          if (firstTimerPrice < priceSgd) {
            priceSgd = firstTimerPrice;
          }
        }
      }
    }
  }

  // Observability: log the discount decision for this payment intent
  console.log("[Payments] discount_applied", {
    phone: normalizePhone(body.client_phone ?? null) ?? null,
    path: body.verification_token ? "token" : "none",
    regular_pct: service.discountPct ?? 0,
    first_timer_pct: service.firstTimerDiscountPct ?? 0,
    final_price: priceSgd,
  });

  const amountCents = Math.round(priceSgd * 100);
  const commissionRate = getCommissionRate(body.booking_source);
  const commissionCents = Math.round(amountCents * commissionRate);

  // 5. Resolve or create a Stripe Customer so saved cards are scoped per-client
  let stripeCustomerId: string | undefined;

  if (body.client_id) {
    const [client] = await db
      .select({ id: clients.id, stripeCustomerId: clients.stripeCustomerId, email: clients.email, name: clients.name })
      .from(clients)
      .where(eq(clients.id, body.client_id))
      .limit(1);

    if (client?.stripeCustomerId) {
      stripeCustomerId = client.stripeCustomerId;
    } else if (client) {
      const stripeCustomer = await stripe.customers.create({
        email: body.client_email ?? client.email ?? undefined,
        name: body.client_name ?? client.name ?? undefined,
        phone: body.client_phone ?? undefined,
        metadata: { glowos_client_id: client.id },
      });
      stripeCustomerId = stripeCustomer.id;
      await db
        .update(clients)
        .set({ stripeCustomerId: stripeCustomer.id })
        .where(eq(clients.id, client.id));
    }
  } else if (body.client_email || body.client_phone) {
    // Guest checkout — create Stripe Customer for card isolation
    const stripeCustomer = await stripe.customers.create({
      email: body.client_email ?? undefined,
      name: body.client_name ?? undefined,
      phone: body.client_phone ?? undefined,
    });
    stripeCustomerId = stripeCustomer.id;
  }

  // 6. Create Stripe PaymentIntent with Connect destination charges
  const paymentIntent = await stripe.paymentIntents.create({
    amount: amountCents,
    currency: "sgd",
    customer: stripeCustomerId,
    description: `${service.name} at ${merchant.name}`,
    statement_descriptor_suffix: merchant.name.slice(0, 22),
    application_fee_amount: commissionCents > 0 ? commissionCents : undefined,
    transfer_data: {
      destination: merchant.stripeAccountId,
    },
    payment_method_types: ["card", "paynow", "grabpay"],
    metadata: {
      booking_source: body.booking_source,
      merchant_id: merchant.id,
      service_id: body.service_id,
      lease_id: body.lease_id,
      client_name: body.client_name ?? "",
      client_email: body.client_email ?? "",
      client_phone: body.client_phone ?? "",
      client_id: body.client_id ?? "",
    },
  });

  return c.json(
    {
      client_secret: paymentIntent.client_secret,
      payment_intent_id: paymentIntent.id,
    },
    201
  );
});

// ─── POST /merchant/bookings/:id/refund ───────────────────────────────────────

paymentsRouter.post(
  "/bookings/:id/refund",
  requireMerchant,
  requireRole("owner", "manager"),
  zValidator(refundSchema),
  async (c) => {
    const merchantId = c.get("merchantId")!;
    const bookingId = c.req.param("id")!;
    const body = c.get("body") as z.infer<typeof refundSchema>;

    // 1. Load booking and verify tenant ownership
    const [booking] = await db
      .select()
      .from(bookings)
      .where(and(eq(bookings.id, bookingId), eq(bookings.merchantId, merchantId)))
      .limit(1);

    if (!booking) {
      return c.json({ error: "Not Found", message: "Booking not found" }, 404);
    }

    // 2. Verify booking is in a refundable state
    if (booking.status === "cancelled") {
      return c.json({ error: "Conflict", message: "Booking is already cancelled" }, 409);
    }

    if (booking.status === "no_show") {
      return c.json(
        { error: "Conflict", message: "Cannot refund a no-show booking" },
        409
      );
    }

    if (
      booking.status !== "confirmed" &&
      booking.status !== "completed" &&
      booking.status !== "in_progress"
    ) {
      return c.json(
        { error: "Conflict", message: `Booking status '${booking.status}' is not refundable` },
        409
      );
    }

    if (booking.paymentStatus !== "paid" && booking.paymentMethod !== "cash") {
      return c.json(
        { error: "Conflict", message: "Booking has not been paid and cannot be refunded" },
        409
      );
    }

    if (booking.paymentStatus === "refunded") {
      return c.json(
        { error: "Conflict", message: "Booking has already been fully refunded" },
        409
      );
    }

    // 3. Process the refund
    await processRefund(bookingId, body.refund_type);

    // 4. Return updated booking
    const [updated] = await db
      .select()
      .from(bookings)
      .where(eq(bookings.id, bookingId))
      .limit(1);

    return c.json({
      success: true,
      message: `Booking cancelled with ${body.refund_type} refund`,
      booking: updated,
    });
  }
);

export { paymentsRouter };
