import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  merchants,
  bookings,
  ipay88Transactions,
} from "@glowos/db";
import { requireMerchant, requireAdmin } from "../middleware/auth.js";
import { zValidator } from "../middleware/validate.js";
import { config } from "../lib/config.js";
import {
  IPAY88_ENTRY_URL,
  buildInitiatePayload,
  generateRefNo,
  verifyCallbackSignature,
  type Ipay88CallbackPayload,
} from "../lib/ipay88.js";
import type { AppVariables } from "../lib/types.js";

// ─── Merchant-facing settings router ──────────────────────────────────────────
// Mounted at /merchant/payments/ipay88

export const merchantIpay88Router = new Hono<{ Variables: AppVariables }>();
merchantIpay88Router.use("*", requireMerchant, requireAdmin());

const connectSchema = z.object({
  merchant_code: z.string().min(1).max(20),
  merchant_key: z.string().min(1),
  currency: z.enum(["MYR", "SGD"]),
  environment: z.enum(["sandbox", "production"]).default("sandbox"),
});

merchantIpay88Router.post("/connect", zValidator(connectSchema), async (c) => {
  const body = c.get("body") as z.infer<typeof connectSchema>;
  const merchantId = c.get("merchantId")!;

  await db
    .update(merchants)
    .set({
      paymentGateway: "ipay88",
      ipay88MerchantCode: body.merchant_code.trim(),
      ipay88MerchantKey: body.merchant_key.trim(),
      ipay88Currency: body.currency,
      ipay88Environment: body.environment,
      updatedAt: new Date(),
    })
    .where(eq(merchants.id, merchantId));

  return c.json({ success: true });
});

merchantIpay88Router.post("/disconnect", async (c) => {
  const merchantId = c.get("merchantId")!;
  await db
    .update(merchants)
    .set({
      paymentGateway: "stripe",
      ipay88MerchantCode: null,
      ipay88MerchantKey: null,
      ipay88Currency: null,
      updatedAt: new Date(),
    })
    .where(eq(merchants.id, merchantId));
  return c.json({ success: true });
});

merchantIpay88Router.get("/status", async (c) => {
  const merchantId = c.get("merchantId")!;
  const [m] = await db
    .select({
      paymentGateway: merchants.paymentGateway,
      ipay88MerchantCode: merchants.ipay88MerchantCode,
      ipay88Currency: merchants.ipay88Currency,
      ipay88Environment: merchants.ipay88Environment,
    })
    .from(merchants)
    .where(eq(merchants.id, merchantId))
    .limit(1);
  if (!m) return c.json({ error: "Not Found" }, 404);

  return c.json({
    paymentGateway: m.paymentGateway,
    ipay88: m.ipay88MerchantCode
      ? {
          connected: true,
          merchantCode: m.ipay88MerchantCode,
          currency: m.ipay88Currency,
          environment: m.ipay88Environment,
        }
      : { connected: false },
  });
});

// ─── Public: POST /booking/:slug/ipay88/initiate ──────────────────────────────
// Called by the booking widget after the client has confirmed their slot. We
// create a pending ipay88_transactions row and return the signed form payload
// so the widget can auto-submit it to iPay88's entry.asp.

export const publicIpay88Router = new Hono<{ Variables: AppVariables }>();

const initiateSchema = z.object({
  booking_id: z.string().uuid(),
  payment_id: z.string().optional(), // Optional: omit to let iPay88 show picker
});

publicIpay88Router.post("/:slug/ipay88/initiate", zValidator(initiateSchema), async (c) => {
  const slug = c.req.param("slug")!;
  const body = c.get("body") as z.infer<typeof initiateSchema>;

  const [row] = await db
    .select({
      booking: bookings,
      merchant: merchants,
    })
    .from(bookings)
    .innerJoin(merchants, eq(bookings.merchantId, merchants.id))
    .where(and(eq(merchants.slug, slug), eq(bookings.id, body.booking_id)))
    .limit(1);

  if (!row) {
    return c.json({ error: "Not Found", message: "Booking not found" }, 404);
  }

  const { booking, merchant } = row;

  if (
    merchant.paymentGateway !== "ipay88" ||
    !merchant.ipay88MerchantCode ||
    !merchant.ipay88MerchantKey ||
    !merchant.ipay88Currency
  ) {
    return c.json(
      { error: "Conflict", message: "iPay88 is not configured for this merchant" },
      409,
    );
  }

  if (booking.paymentStatus === "paid") {
    return c.json({ error: "Conflict", message: "Booking is already paid" }, 409);
  }

  // Fresh RefNo per attempt — prevents the "retry within 30 min treated as
  // same transaction" gotcha from our research.
  const refNo = generateRefNo(booking.id);
  const amountDecimal = parseFloat(booking.priceSgd);

  await db.insert(ipay88Transactions).values({
    merchantId: merchant.id,
    bookingId: booking.id,
    refNo,
    amountMyr: amountDecimal.toFixed(2),
    currency: merchant.ipay88Currency,
    ...(body.payment_id ? { paymentId: body.payment_id } : {}),
    status: "pending",
  });

  // Look up the client contact for the UserEmail/Contact fields.
  // Falls back to merchant email + phone if not resolvable — iPay88 requires
  // non-empty values on these fields.
  const clientName = booking.clientNotes ?? "Customer";
  const clientEmail = merchant.email ?? "noreply@glowos.sg";
  const clientContact = merchant.phone ?? "0000000000";

  const payload = buildInitiatePayload({
    merchantCode: merchant.ipay88MerchantCode,
    merchantKey: merchant.ipay88MerchantKey,
    refNo,
    amountDecimal,
    currency: merchant.ipay88Currency,
    prodDesc: `Booking at ${merchant.name}`,
    userName: clientName,
    userEmail: clientEmail,
    userContact: clientContact,
    responseUrl: `${config.frontendUrl}/${slug}/confirm?ref=${refNo}`,
    backendUrl: `${config.appUrl}/webhooks/ipay88/backend`,
    paymentId: body.payment_id,
  });

  return c.json({
    action: IPAY88_ENTRY_URL,
    method: "POST",
    payload,
  });
});
