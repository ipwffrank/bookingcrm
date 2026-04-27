import {
  pgTable,
  uuid,
  varchar,
  integer,
  numeric,
  boolean,
  timestamp,
  text,
  index,
} from "drizzle-orm/pg-core";
import { merchants } from "./merchants";
import { clients } from "./clients";
import { services } from "./services";
import { staff } from "./staff";

export const bookings = pgTable(
  "bookings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    merchantId: uuid("merchant_id")
      .notNull()
      .references(() => merchants.id, { onDelete: "restrict" }),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "restrict" }),
    serviceId: uuid("service_id")
      .notNull()
      .references(() => services.id, { onDelete: "restrict" }),
    staffId: uuid("staff_id")
      .notNull()
      .references(() => staff.id, { onDelete: "restrict" }),
    groupId: uuid("group_id"),
    startTime: timestamp("start_time", { withTimezone: true }).notNull(),
    endTime: timestamp("end_time", { withTimezone: true }).notNull(),
    durationMinutes: integer("duration_minutes").notNull(),
    // 'pending'   = booking created but customer hasn't yet clicked the
    //               WhatsApp/email confirm link. Cascade reminders fire at
    //               T-24h / T-12h / T-2h until confirmed or appointment passes.
    // 'confirmed' = customer has confirmed (or this is a walk-in / staff-side
    //               booking where confirmation is implicit).
    // The remaining statuses are unchanged.
    status: varchar("status", { length: 20 })
      .notNull()
      .default("pending")
      .$type<"pending" | "confirmed" | "in_progress" | "completed" | "cancelled" | "no_show">(),
    // Signed token used by the public /confirm/:token endpoint. Generated at
    // booking creation; null for legacy rows pre-migration.
    confirmationToken: varchar("confirmation_token", { length: 64 }),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    priceSgd: numeric("price_sgd", { precision: 10, scale: 2 }).notNull(),
    paymentStatus: varchar("payment_status", { length: 20 }).notNull().default("pending"),
    paymentMethod: varchar("payment_method", { length: 50 }),
    bookingSource: varchar("booking_source", { length: 50 }).notNull(),
    firstTimerDiscountApplied: boolean("first_timer_discount_applied")
      .notNull()
      .default(false),
    // Phase 2 loyalty redemption — see services/api/src/routes/bookings.ts
    // (apply-loyalty-redemption / remove-loyalty-redemption). On cancel the
    // pointer is left as-is so we keep an audit trail of what was redeemed;
    // the offsetting `adjust` row in loyalty_transactions is the source of
    // truth for the current balance.
    discountSgd: numeric("discount_sgd", { precision: 10, scale: 2 })
      .notNull()
      .default("0"),
    loyaltyPointsRedeemed: integer("loyalty_points_redeemed").notNull().default(0),
    loyaltyRedemptionTxId: uuid("loyalty_redemption_tx_id"),
    commissionRate: numeric("commission_rate", { precision: 5, scale: 4 }).notNull().default("0"),
    commissionSgd: numeric("commission_sgd", { precision: 10, scale: 2 }).notNull().default("0"),
    merchantPayoutSgd: numeric("merchant_payout_sgd", { precision: 10, scale: 2 }),
    payoutStatus: varchar("payout_status", { length: 20 }).notNull().default("pending"),
    stripePaymentIntentId: varchar("stripe_payment_intent_id", { length: 255 }),
    stripeChargeId: varchar("stripe_charge_id", { length: 255 }),
    hitpayPaymentId: varchar("hitpay_payment_id", { length: 255 }),
    googleBookingId: varchar("google_booking_id", { length: 255 }),
    googleLeaseId: varchar("google_lease_id", { length: 255 }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelledBy: varchar("cancelled_by", { length: 50 }),
    cancellationReason: text("cancellation_reason"),
    refundAmountSgd: numeric("refund_amount_sgd", { precision: 10, scale: 2 }).notNull().default("0"),
    stripeRefundId: varchar("stripe_refund_id", { length: 255 }),
    checkedInAt: timestamp("checked_in_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    noShowAt: timestamp("no_show_at", { withTimezone: true }),
    clientNotes: text("client_notes"),
    staffNotes: text("staff_notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    merchantStartTimeIdx: index("bookings_merchant_start_time_idx").on(
      table.merchantId,
      table.startTime
    ),
    clientIdx: index("bookings_client_idx").on(table.clientId),
    staffStartTimeIdx: index("bookings_staff_start_time_idx").on(
      table.staffId,
      table.startTime
    ),
    groupIdx: index("bookings_group_idx").on(table.groupId),
  })
);

export const slotLeases = pgTable(
  "slot_leases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    merchantId: uuid("merchant_id")
      .notNull()
      .references(() => merchants.id, { onDelete: "cascade" }),
    staffId: uuid("staff_id")
      .notNull()
      .references(() => staff.id, { onDelete: "cascade" }),
    serviceId: uuid("service_id")
      .notNull()
      .references(() => services.id, { onDelete: "cascade" }),
    startTime: timestamp("start_time", { withTimezone: true }).notNull(),
    endTime: timestamp("end_time", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    sessionToken: varchar("session_token", { length: 255 }).notNull(),
    googleLeaseId: varchar("google_lease_id", { length: 255 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    expiresAtIdx: index("slot_leases_expires_at_idx").on(table.expiresAt),
  })
);
