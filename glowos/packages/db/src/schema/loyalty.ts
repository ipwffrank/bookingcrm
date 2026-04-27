import {
  pgTable,
  uuid,
  varchar,
  integer,
  numeric,
  boolean,
  text,
  timestamp,
  index,
  unique,
} from "drizzle-orm/pg-core";
import { merchants } from "./merchants";
import { clients } from "./clients";
import { merchantUsers } from "./merchant-users";
import { bookings } from "./bookings";

export const loyaltyTransactionKind = ["earn", "redeem", "adjust", "expire"] as const;
export type LoyaltyTransactionKind = (typeof loyaltyTransactionKind)[number];

// One row per merchant. Toggle the program off and existing balances are preserved
// but no new earn or redeem can happen.
export const loyaltyPrograms = pgTable(
  "loyalty_programs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    merchantId: uuid("merchant_id")
      .notNull()
      .references(() => merchants.id, { onDelete: "cascade" }),
    enabled: boolean("enabled").notNull().default(false),
    // Earn rules: points = pointsPerDollar * priceSgd + pointsPerVisit
    pointsPerDollar: integer("points_per_dollar").notNull().default(1),
    pointsPerVisit: integer("points_per_visit").notNull().default(0),
    // Redeem rules: pointsPerDollarRedeem points = SGD 1 off
    pointsPerDollarRedeem: integer("points_per_dollar_redeem").notNull().default(100),
    minRedeemPoints: integer("min_redeem_points").notNull().default(100),
    // Optional: expiry months from earn (0 = never expire)
    earnExpiryMonths: integer("earn_expiry_months").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    merchantIdx: unique("loyalty_programs_merchant_unique").on(t.merchantId),
  }),
);

// Append-only ledger. Balance = SUM(amount) WHERE merchantId, clientId.
// `kind` is informational; the math is in `amount` (positive for earn/adjust+,
// negative for redeem/adjust-/expire).
export const loyaltyTransactions = pgTable(
  "loyalty_transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    merchantId: uuid("merchant_id")
      .notNull()
      .references(() => merchants.id, { onDelete: "cascade" }),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    kind: varchar("kind", { length: 20 })
      .notNull()
      .$type<LoyaltyTransactionKind>(),
    amount: integer("amount").notNull(), // signed
    // For earn: original SGD amount that earned the points (denormalized for audit)
    earnedFromSgd: numeric("earned_from_sgd", { precision: 10, scale: 2 }),
    // For redeem: SGD value the points were converted to
    redeemedSgd: numeric("redeemed_sgd", { precision: 10, scale: 2 }),
    bookingId: uuid("booking_id").references(() => bookings.id, { onDelete: "set null" }),
    reason: text("reason"), // human-readable context, esp. for adjust
    actorUserId: uuid("actor_user_id").references(() => merchantUsers.id, { onDelete: "set null" }),
    actorName: varchar("actor_name", { length: 255 }), // denormalized for display
    expiresAt: timestamp("expires_at", { withTimezone: true }), // for earn transactions when earnExpiryMonths > 0
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    clientIdx: index("loyalty_transactions_client_idx").on(t.merchantId, t.clientId, t.createdAt),
    bookingIdx: index("loyalty_transactions_booking_idx").on(t.bookingId),
  }),
);
