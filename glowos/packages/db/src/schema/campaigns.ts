import {
  pgTable,
  uuid,
  varchar,
  text,
  integer,
  numeric,
  timestamp,
  jsonb,
} from "drizzle-orm/pg-core";
import { merchants } from "./merchants";
import { clients } from "./clients";
import { bookings } from "./bookings";

export const campaigns = pgTable("campaigns", {
  id: uuid("id").primaryKey().defaultRandom(),
  merchantId: uuid("merchant_id")
    .notNull()
    .references(() => merchants.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 255 }).notNull(),
  type: varchar("type", { length: 50 }).notNull(),
  status: varchar("status", { length: 20 }).notNull().default("draft"),
  audienceFilter: jsonb("audience_filter"),
  messageTemplate: text("message_template"),
  promoCode: varchar("promo_code", { length: 50 }),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  recipientsCount: integer("recipients_count"),
  deliveredCount: integer("delivered_count"),
  clickedCount: integer("clicked_count"),
  convertedCount: integer("converted_count"),
  revenueAttributedSgd: numeric("revenue_attributed_sgd", { precision: 10, scale: 2 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const campaignMessages = pgTable("campaign_messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  campaignId: uuid("campaign_id")
    .notNull()
    .references(() => campaigns.id, { onDelete: "cascade" }),
  clientId: uuid("client_id")
    .notNull()
    .references(() => clients.id, { onDelete: "restrict" }),
  messageBody: text("message_body").notNull(),
  status: varchar("status", { length: 20 }).notNull().default("pending"),
  twilioSid: varchar("twilio_sid", { length: 255 }),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  clickedAt: timestamp("clicked_at", { withTimezone: true }),
  convertedAt: timestamp("converted_at", { withTimezone: true }),
  convertedBookingId: uuid("converted_booking_id").references(() => bookings.id, {
    onDelete: "set null",
  }),
});
