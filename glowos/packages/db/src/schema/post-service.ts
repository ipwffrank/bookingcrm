// glowos/packages/db/src/schema/post-service.ts
import {
  pgTable,
  uuid,
  varchar,
  timestamp,
} from "drizzle-orm/pg-core";
import { bookings } from "./bookings";

export const postServiceSequences = pgTable("post_service_sequences", {
  id: uuid("id").primaryKey().defaultRandom(),
  bookingId: uuid("booking_id")
    .notNull()
    .unique()
    .references(() => bookings.id, { onDelete: "cascade" }),
  status: varchar("status", { length: 20 })
    .notNull()
    .default("pending")
    .$type<"pending" | "sent" | "completed">(),
  receiptSentAt: timestamp("receipt_sent_at", { withTimezone: true }),
  balanceNotifSentAt: timestamp("balance_notif_sent_at", { withTimezone: true }),
  rebookCtaSentAt: timestamp("rebook_cta_sent_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
