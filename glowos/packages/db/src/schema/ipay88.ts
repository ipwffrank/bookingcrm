import {
  pgTable,
  uuid,
  varchar,
  text,
  numeric,
  jsonb,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { merchants } from "./merchants";
import { bookings } from "./bookings";
import { bookingGroups } from "./booking-groups";

// Payment flow bookkeeping for iPay88 (legacy OPSG gateway — entry.asp +
// SHA-256 field-concat signature). Separate from stripe/hitpay because the
// lifecycle is different: iPay88's backend-post can arrive before, after, or
// instead of the browser response, so we key everything off ref_no.
//
// Status values:
//   pending      — we've generated the form + signature, user has not yet paid
//   paid         — BackendURL confirmed Status=1
//   failed       — BackendURL confirmed non-1 status
//   pending_fpx  — Status=6 (FPX async); reconcile via Requery
//   cancelled    — user cancelled on the iPay88 page (no callback)
//
// Idempotency guarantee: ref_no is unique — BackendURL retries from iPay88
// collide on upsert and the second one becomes a no-op.
export const ipay88Transactions = pgTable(
  "ipay88_transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    merchantId: uuid("merchant_id")
      .notNull()
      .references(() => merchants.id, { onDelete: "cascade" }),
    bookingId: uuid("booking_id").references(() => bookings.id, {
      onDelete: "set null",
    }),
    bookingGroupId: uuid("booking_group_id").references(() => bookingGroups.id, {
      onDelete: "set null",
    }),
    refNo: varchar("ref_no", { length: 20 }).notNull().unique(),
    amountMyr: numeric("amount_myr", { precision: 10, scale: 2 }).notNull(),
    currency: varchar("currency", { length: 5 }).notNull(),
    paymentId: varchar("payment_id", { length: 10 }),
    status: varchar("status", { length: 20 })
      .notNull()
      .default("pending")
      .$type<"pending" | "paid" | "failed" | "pending_fpx" | "cancelled">(),
    ipay88TransId: varchar("ipay88_trans_id", { length: 50 }),
    ipay88AuthCode: varchar("ipay88_auth_code", { length: 50 }),
    ipay88ErrDesc: text("ipay88_err_desc"),
    // Raw BackendURL POST body for audit + debugging.
    lastCallbackPayload: jsonb("last_callback_payload"),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    merchantIdx: index("ipay88_tx_merchant_idx").on(t.merchantId, t.createdAt),
    bookingIdx: index("ipay88_tx_booking_idx").on(t.bookingId),
  }),
);
