import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { merchants } from "./merchants";
import { clients } from "./clients";
import { bookings } from "./bookings";

export const notificationLog = pgTable("notification_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  merchantId: uuid("merchant_id")
    .notNull()
    .references(() => merchants.id, { onDelete: "cascade" }),
  clientId: uuid("client_id").references(() => clients.id, { onDelete: "set null" }),
  bookingId: uuid("booking_id").references(() => bookings.id, { onDelete: "set null" }),
  type: varchar("type", { length: 50 }).notNull(),
  channel: varchar("channel", { length: 20 }).notNull(),
  recipient: varchar("recipient", { length: 255 }).notNull(),
  messageBody: text("message_body").notNull(),
  status: varchar("status", { length: 20 }).notNull(),
  twilioSid: varchar("twilio_sid", { length: 255 }),
  sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
});
