import {
  pgTable,
  uuid,
  varchar,
  text,
  integer,
  numeric,
  boolean,
  timestamp,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { merchants } from "./merchants";

export const services = pgTable(
  "services",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    merchantId: uuid("merchant_id")
      .notNull()
      .references(() => merchants.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
    description: text("description").notNull(),
    category: varchar("category", { length: 100 }),
    durationMinutes: integer("duration_minutes").notNull(),
    bufferMinutes: integer("buffer_minutes").notNull().default(0),
    // Pre/post buffers split out of the legacy `bufferMinutes`. When a
    // booking has a `secondary_staff_id`, the secondary owns these windows
    // (so the primary is free during them). When secondary is null, the
    // primary is blocked for the entire pre+service+post span — matching
    // the legacy `bufferMinutes` behavior. The legacy column is kept as a
    // "shared/extra" buffer that always blocks the primary.
    preBufferMinutes: integer("pre_buffer_minutes").notNull().default(0),
    postBufferMinutes: integer("post_buffer_minutes").notNull().default(0),
    priceSgd: numeric("price_sgd", { precision: 10, scale: 2 }).notNull(),
    isActive: boolean("is_active").notNull().default(true),
    slotType: varchar("slot_type", { length: 20 })
      .notNull()
      .default("standard")
      .$type<"standard" | "consult" | "treatment">(),
    requiresConsultFirst: boolean("requires_consult_first").notNull().default(false),
    consultServiceId: uuid("consult_service_id"),
    // When false the service is not listed on the public booking widget.
    // Useful for package-only add-ons (e.g. "Nail art per nail") that only
    // make sense bundled with another service, never sold standalone.
    visibleOnBookingPage: boolean("visible_on_booking_page").notNull().default(true),
    displayOrder: integer("display_order").notNull().default(0),
    discountPct: integer("discount_pct"), // e.g. 10 = 10% off, null = no discount
    discountShowOnline: boolean("discount_show_online").notNull().default(false), // show on public booking page
    firstTimerDiscountPct: integer("first_timer_discount_pct"), // null = no first-timer discount
    firstTimerDiscountEnabled: boolean("first_timer_discount_enabled").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    pricePositive: check("price_sgd_positive", sql`${table.priceSgd} > 0`),
  })
);
