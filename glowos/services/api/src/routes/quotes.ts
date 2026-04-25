import { Hono } from "hono";
import { and, desc, eq, lt } from "drizzle-orm";
import { randomBytes } from "crypto";
import { z } from "zod";
import {
  db,
  merchants,
  treatmentQuotes,
  services,
  clients,
  clientProfiles,
  bookings,
  merchantUsers,
} from "@glowos/db";
import { requireMerchant } from "../middleware/auth.js";
import { zValidator } from "../middleware/validate.js";
import { addJob } from "../lib/queue.js";
import { stripe } from "../lib/stripe.js";
import { generateConfirmationToken } from "../lib/confirmation-token.js";
import type { AppVariables } from "../lib/types.js";

// ─── Merchant-facing router ───────────────────────────────────────────────────

export const merchantQuotesRouter = new Hono<{ Variables: AppVariables }>();
merchantQuotesRouter.use("*", requireMerchant);

const issueSchema = z.object({
  client_id: z.string().uuid(),
  service_id: z.string().uuid(),
  price_sgd: z.number().positive(),
  valid_for_days: z.number().int().min(1).max(365),
  consult_booking_id: z.string().uuid().optional(),
  notes: z.string().optional(),
});

// POST /merchant/quotes — issue a new treatment quote for a client
merchantQuotesRouter.post("/", zValidator(issueSchema), async (c) => {
  const merchantId = c.get("merchantId")!;
  const issuedByUserId = c.get("userId");
  const body = c.get("body") as z.infer<typeof issueSchema>;

  // Verify client belongs to this merchant (via clientProfiles)
  const [profile] = await db
    .select({ id: clientProfiles.id })
    .from(clientProfiles)
    .where(
      and(
        eq(clientProfiles.clientId, body.client_id),
        eq(clientProfiles.merchantId, merchantId),
      ),
    )
    .limit(1);
  if (!profile) {
    return c.json({ error: "Not Found", message: "Client not found for this merchant" }, 404);
  }

  // Verify service belongs to this merchant
  const [svc] = await db
    .select({ id: services.id, name: services.name })
    .from(services)
    .where(and(eq(services.id, body.service_id), eq(services.merchantId, merchantId)))
    .limit(1);
  if (!svc) {
    return c.json({ error: "Not Found", message: "Service not found" }, 404);
  }

  const validUntil = new Date();
  validUntil.setDate(validUntil.getDate() + body.valid_for_days);

  const acceptToken = randomBytes(24).toString("base64url");

  const [quote] = await db
    .insert(treatmentQuotes)
    .values({
      merchantId,
      clientId: body.client_id,
      consultBookingId: body.consult_booking_id ?? null,
      serviceId: svc.id,
      serviceName: svc.name,
      priceSgd: body.price_sgd.toFixed(2),
      notes: body.notes ?? null,
      issuedByStaffId: issuedByUserId,
      validUntil,
      acceptToken,
      status: "pending",
    })
    .returning();

  if (!quote) {
    return c.json({ error: "Internal Server Error", message: "Failed to create quote" }, 500);
  }

  // Fire notification job — worker handler is optional (logs + WhatsApp/email)
  await addJob("notifications", "treatment_quote_issued", { quote_id: quote.id })
    .catch((err: unknown) => {
      console.error("[quotes] failed to enqueue treatment_quote_issued", err);
    });

  return c.json({ quote }, 201);
});

// GET /merchant/quotes/client/:clientId — list quotes for a client
merchantQuotesRouter.get("/client/:clientId", async (c) => {
  const merchantId = c.get("merchantId")!;
  const clientId = c.req.param("clientId")!;

  const rows = await db
    .select({
      id: treatmentQuotes.id,
      serviceId: treatmentQuotes.serviceId,
      serviceName: treatmentQuotes.serviceName,
      priceSgd: treatmentQuotes.priceSgd,
      notes: treatmentQuotes.notes,
      status: treatmentQuotes.status,
      validUntil: treatmentQuotes.validUntil,
      issuedAt: treatmentQuotes.issuedAt,
      acceptedAt: treatmentQuotes.acceptedAt,
      paidAt: treatmentQuotes.paidAt,
      acceptToken: treatmentQuotes.acceptToken,
      issuedByName: merchantUsers.name,
    })
    .from(treatmentQuotes)
    .leftJoin(merchantUsers, eq(treatmentQuotes.issuedByStaffId, merchantUsers.id))
    .where(
      and(
        eq(treatmentQuotes.merchantId, merchantId),
        eq(treatmentQuotes.clientId, clientId),
      ),
    )
    .orderBy(desc(treatmentQuotes.issuedAt));

  return c.json({ quotes: rows });
});

// POST /merchant/quotes/:id/cancel — void a pending quote
const cancelSchema = z.object({ reason: z.string().optional() });
merchantQuotesRouter.post("/:id/cancel", zValidator(cancelSchema), async (c) => {
  const merchantId = c.get("merchantId")!;
  const id = c.req.param("id")!;
  const body = c.get("body") as z.infer<typeof cancelSchema>;

  const [existing] = await db
    .select({ status: treatmentQuotes.status })
    .from(treatmentQuotes)
    .where(and(eq(treatmentQuotes.id, id), eq(treatmentQuotes.merchantId, merchantId)))
    .limit(1);
  if (!existing) {
    return c.json({ error: "Not Found" }, 404);
  }
  if (existing.status !== "pending" && existing.status !== "accepted") {
    return c.json(
      { error: "Conflict", message: `Cannot cancel quote in ${existing.status} state` },
      409,
    );
  }

  await db
    .update(treatmentQuotes)
    .set({
      status: "cancelled",
      cancelledAt: new Date(),
      cancelledReason: body.reason ?? null,
      updatedAt: new Date(),
    })
    .where(eq(treatmentQuotes.id, id));

  return c.json({ success: true });
});

// ─── Public router ────────────────────────────────────────────────────────────

export const publicQuotesRouter = new Hono<{ Variables: AppVariables }>();

// GET /quote/:token — fetch quote details for the client-facing accept page.
// Auto-flips stale pending quotes to 'expired' so the client sees accurate state.
publicQuotesRouter.get("/:token", async (c) => {
  const token = c.req.param("token")!;

  const [row] = await db
    .select({
      quote: treatmentQuotes,
      merchant: {
        slug: merchants.slug,
        name: merchants.name,
        logoUrl: merchants.logoUrl,
        country: merchants.country,
      },
      client: {
        name: clients.name,
        phone: clients.phone,
        email: clients.email,
      },
    })
    .from(treatmentQuotes)
    .innerJoin(merchants, eq(treatmentQuotes.merchantId, merchants.id))
    .innerJoin(clients, eq(treatmentQuotes.clientId, clients.id))
    .where(eq(treatmentQuotes.acceptToken, token))
    .limit(1);

  if (!row) {
    return c.json({ error: "Not Found", message: "Quote not found" }, 404);
  }

  // Lazy-expire: if the quote is still pending but past its validity, flip it.
  let status = row.quote.status;
  if (status === "pending" && row.quote.validUntil < new Date()) {
    await db
      .update(treatmentQuotes)
      .set({ status: "expired", updatedAt: new Date() })
      .where(eq(treatmentQuotes.id, row.quote.id));
    status = "expired";
  }

  return c.json({
    quote: {
      id: row.quote.id,
      serviceId: row.quote.serviceId,
      serviceName: row.quote.serviceName,
      priceSgd: row.quote.priceSgd,
      notes: row.quote.notes,
      status,
      validUntil: row.quote.validUntil,
      issuedAt: row.quote.issuedAt,
    },
    merchant: row.merchant,
    client: {
      // Mask name for privacy — the client knows their own name already.
      name: row.client.name ? `${row.client.name.slice(0, 1)}***` : null,
    },
  });
});

// POST /quote/:token/accept — client accepts the quote. Requires a booking
// start_time; creates a pending-payment booking and transitions quote →
// accepted. Subsequent payment step flips to 'paid'.
const acceptSchema = z.object({
  start_time: z.string(), // ISO timestamp
  staff_id: z.string().uuid().optional(),
});

publicQuotesRouter.post("/:token/accept", zValidator(acceptSchema), async (c) => {
  const token = c.req.param("token")!;
  const body = c.get("body") as z.infer<typeof acceptSchema>;

  const [row] = await db
    .select()
    .from(treatmentQuotes)
    .where(eq(treatmentQuotes.acceptToken, token))
    .limit(1);
  if (!row) {
    return c.json({ error: "Not Found" }, 404);
  }
  if (row.status !== "pending") {
    return c.json(
      { error: "Conflict", message: `Quote is ${row.status}` },
      409,
    );
  }
  if (row.validUntil < new Date()) {
    await db
      .update(treatmentQuotes)
      .set({ status: "expired", updatedAt: new Date() })
      .where(eq(treatmentQuotes.id, row.id));
    return c.json({ error: "Gone", message: "This quote has expired." }, 410);
  }

  const startTime = new Date(body.start_time);
  if (Number.isNaN(startTime.getTime())) {
    return c.json({ error: "Bad Request", message: "Invalid start_time" }, 400);
  }

  // Load service for duration
  const [svc] = await db
    .select()
    .from(services)
    .where(eq(services.id, row.serviceId))
    .limit(1);
  if (!svc) {
    return c.json({ error: "Not Found", message: "Service no longer available" }, 404);
  }

  const endTime = new Date(
    startTime.getTime() + (svc.durationMinutes + svc.bufferMinutes) * 60_000,
  );

  // Load merchant for Stripe account
  const [merchant] = await db
    .select({ stripeAccountId: merchants.stripeAccountId })
    .from(merchants)
    .where(eq(merchants.id, row.merchantId))
    .limit(1);
  if (!merchant?.stripeAccountId) {
    return c.json(
      {
        error: "Bad Request",
        message: "This clinic has not completed online-payment setup. Please contact them directly.",
      },
      400,
    );
  }

  // Create the booking (payment_status = pending; flips to paid once the
  // customer completes the Stripe Payment Element on the accept page).
  const [booking] = await db
    .insert(bookings)
    .values({
      merchantId: row.merchantId,
      clientId: row.clientId,
      serviceId: row.serviceId,
      staffId: body.staff_id ?? null,
      startTime,
      endTime,
      status: "pending",
      confirmationToken: generateConfirmationToken(),
      priceSgd: row.priceSgd,
      paymentMethod: "card",
      paymentStatus: "pending",
      bookingSource: "treatment_quote",
    } as never)
    .returning();

  if (!booking) {
    return c.json({ error: "Internal Server Error" }, 500);
  }

  await db
    .update(treatmentQuotes)
    .set({
      status: "accepted",
      acceptedAt: new Date(),
      convertedBookingId: booking.id,
      updatedAt: new Date(),
    })
    .where(eq(treatmentQuotes.id, row.id));

  // Mint a Stripe PaymentIntent for the accept page to drive the Payment
  // Element. amount is in cents (Stripe convention). Metadata carries the
  // quote_id + booking_id so the mark-paid endpoint + webhook can reconcile.
  const amountCents = Math.round(parseFloat(String(row.priceSgd)) * 100);
  let clientSecret: string | null = null;
  try {
    const intent = await stripe.paymentIntents.create(
      {
        amount: amountCents,
        currency: "sgd",
        automatic_payment_methods: { enabled: true },
        metadata: {
          quote_id: row.id,
          booking_id: booking.id,
          merchant_id: row.merchantId,
        },
      },
      { stripeAccount: merchant.stripeAccountId },
    );
    clientSecret = intent.client_secret;
  } catch (err) {
    console.error("[quotes] PaymentIntent create failed", err);
    // Booking + quote state stay as-is — customer can retry via pay endpoint.
  }

  return c.json(
    {
      quote: { id: row.id, status: "accepted" },
      booking: { id: booking.id, startTime: booking.startTime },
      payment: clientSecret
        ? { clientSecret, stripeAccountId: merchant.stripeAccountId }
        : null,
    },
    201,
  );
});

// POST /quote/:token/mark-paid — called by the frontend when Stripe reports
// successful payment client-side. Verifies with Stripe, then flips quote →
// paid + booking.paymentStatus → paid. Idempotent.
const markPaidSchema = z.object({
  payment_intent_id: z.string().min(1),
});
publicQuotesRouter.post("/:token/mark-paid", zValidator(markPaidSchema), async (c) => {
  const token = c.req.param("token")!;
  const body = c.get("body") as z.infer<typeof markPaidSchema>;

  const [row] = await db
    .select()
    .from(treatmentQuotes)
    .where(eq(treatmentQuotes.acceptToken, token))
    .limit(1);
  if (!row) return c.json({ error: "Not Found" }, 404);
  if (row.status === "paid") {
    return c.json({ quote: { id: row.id, status: "paid" } });
  }
  if (row.status !== "accepted") {
    return c.json(
      { error: "Conflict", message: `Quote is ${row.status} — cannot mark paid` },
      409,
    );
  }

  // Verify with Stripe that the PaymentIntent actually succeeded.
  const [merchant] = await db
    .select({ stripeAccountId: merchants.stripeAccountId })
    .from(merchants)
    .where(eq(merchants.id, row.merchantId))
    .limit(1);
  if (!merchant?.stripeAccountId) {
    return c.json({ error: "Bad Request", message: "Stripe not configured" }, 400);
  }

  try {
    const intent = await stripe.paymentIntents.retrieve(body.payment_intent_id, {
      stripeAccount: merchant.stripeAccountId,
    });
    if (intent.status !== "succeeded") {
      return c.json(
        {
          error: "Payment Required",
          message: `PaymentIntent status: ${intent.status}`,
        },
        402,
      );
    }
    if (intent.metadata?.quote_id !== row.id) {
      // Payment intent belongs to a different quote — reject.
      return c.json({ error: "Forbidden", message: "PaymentIntent mismatch" }, 403);
    }
  } catch (err) {
    console.error("[quotes] mark-paid: Stripe retrieve failed", err);
    return c.json({ error: "Internal Server Error" }, 500);
  }

  const now = new Date();
  await db
    .update(treatmentQuotes)
    .set({ status: "paid", paidAt: now, updatedAt: now })
    .where(eq(treatmentQuotes.id, row.id));
  if (row.convertedBookingId) {
    await db
      .update(bookings)
      .set({ paymentStatus: "paid", updatedAt: now })
      .where(eq(bookings.id, row.convertedBookingId));
    // Fire booking_confirmation so client + merchant get the usual notification.
    await addJob("notifications", "booking_confirmation", {
      booking_id: row.convertedBookingId,
    }).catch((err: unknown) => {
      console.error("[quotes] failed to enqueue booking_confirmation", err);
    });
  }

  return c.json({ quote: { id: row.id, status: "paid" } });
});

// ─── Expired quote sweeper (exported for cron) ────────────────────────────────

export async function sweepExpiredQuotes(): Promise<number> {
  const now = new Date();
  const updated = await db
    .update(treatmentQuotes)
    .set({ status: "expired", updatedAt: now })
    .where(
      and(
        eq(treatmentQuotes.status, "pending"),
        lt(treatmentQuotes.validUntil, now),
      ),
    )
    .returning({ id: treatmentQuotes.id });
  return updated.length;
}
