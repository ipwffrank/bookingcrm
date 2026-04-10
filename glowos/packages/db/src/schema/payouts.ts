import {
  pgTable,
  uuid,
  varchar,
  numeric,
  date,
  timestamp,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { merchants } from "./merchants";

export const payouts = pgTable("payouts", {
  id: uuid("id").primaryKey().defaultRandom(),
  merchantId: uuid("merchant_id")
    .notNull()
    .references(() => merchants.id, { onDelete: "restrict" }),
  amountSgd: numeric("amount_sgd", { precision: 10, scale: 2 }).notNull(),
  bookingIds: uuid("booking_ids").array().notNull().default(sql`'{}'`),
  stripeTransferId: varchar("stripe_transfer_id", { length: 255 }),
  status: varchar("status", { length: 20 }).notNull().default("pending"),
  payoutDate: date("payout_date"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
