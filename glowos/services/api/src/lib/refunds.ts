import { eq } from "drizzle-orm";
import { db, bookings } from "@glowos/db";
import { stripe } from "./stripe.js";
import { invalidateAvailabilityCacheByMerchantId } from "./availability.js";

// ─── processRefund ─────────────────────────────────────────────────────────────

/**
 * Processes a refund for a booking.
 * - Cash bookings: marks as cancelled + payment_status 'waived' immediately.
 * - Card bookings: issues Stripe refund, then marks cancelled.
 * The actual booking payment_status/refund fields are updated here;
 * the Stripe charge.refunded webhook will confirm asynchronously.
 */
export async function processRefund(
  bookingId: string,
  refundType: "full" | "partial" | "none"
): Promise<void> {
  // 1. Load the booking
  const [booking] = await db
    .select()
    .from(bookings)
    .where(eq(bookings.id, bookingId))
    .limit(1);

  if (!booking) {
    throw new Error(`Booking ${bookingId} not found`);
  }

  // 2. Cash booking — just cancel, no Stripe involved
  if (booking.paymentMethod === "cash" || !booking.stripeChargeId) {
    await db
      .update(bookings)
      .set({
        status: "cancelled",
        paymentStatus: "waived",
        cancelledAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(bookings.id, bookingId));

    await invalidateAvailabilityCacheByMerchantId(booking.merchantId);
    return;
  }

  // 3. Stripe-backed booking — calculate refund amount in cents
  const priceSgd = parseFloat(String(booking.priceSgd));

  let refundAmountCents = 0;
  if (refundType === "full") {
    refundAmountCents = Math.round(priceSgd * 100);
  } else if (refundType === "partial") {
    // Default partial = 50%; merchants can configure this in cancellationPolicy,
    // but here we apply a straightforward 50% server-side rule.
    refundAmountCents = Math.round(priceSgd * 0.5 * 100);
  }
  // refundType === 'none' → refundAmountCents stays 0

  // 4. Issue Stripe refund if amount > 0
  if (refundAmountCents > 0) {
    const refund = await stripe.refunds.create({
      charge: booking.stripeChargeId,
      amount: refundAmountCents,
      // Reverse the application fee and transfer only on full refunds
      refund_application_fee: refundType === "full",
      reverse_transfer: refundType === "full",
    });

    const refundAmountSgd = (refundAmountCents / 100).toFixed(2);

    await db
      .update(bookings)
      .set({
        status: "cancelled",
        paymentStatus: refundType === "full" ? "refunded" : "partially_refunded",
        refundAmountSgd,
        stripeRefundId: refund.id,
        // Reverse commission on full refunds
        ...(refundType === "full" ? { commissionSgd: "0" } : {}),
        cancelledAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(bookings.id, bookingId));
  } else {
    // No refund — simply cancel
    await db
      .update(bookings)
      .set({
        status: "cancelled",
        cancelledAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(bookings.id, bookingId));
  }

  // 5. Invalidate availability cache so freed slot becomes bookable
  await invalidateAvailabilityCacheByMerchantId(booking.merchantId);
}
