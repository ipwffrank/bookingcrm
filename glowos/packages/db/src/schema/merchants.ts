import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  jsonb,
} from "drizzle-orm/pg-core";

export const merchants = pgTable("merchants", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: varchar("slug", { length: 100 }).notNull().unique(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  addressLine1: varchar("address_line1", { length: 255 }),
  addressLine2: varchar("address_line2", { length: 255 }),
  postalCode: varchar("postal_code", { length: 10 }),
  phone: varchar("phone", { length: 20 }),
  email: varchar("email", { length: 255 }),
  category: varchar("category", { length: 50 })
    .$type<"hair_salon" | "nail_studio" | "spa" | "massage" | "beauty_centre" | "restaurant" | "beauty_clinic" | "medical_clinic" | "other">(),
  logoUrl: text("logo_url"),
  coverPhotoUrl: text("cover_photo_url"),
  timezone: varchar("timezone", { length: 50 }).notNull().default("Asia/Singapore"),
  gbpPlaceId: varchar("gbp_place_id", { length: 255 }),
  stripeAccountId: varchar("stripe_account_id", { length: 255 }),
  hitpayMerchantId: varchar("hitpay_merchant_id", { length: 255 }),
  subscriptionTier: varchar("subscription_tier", { length: 50 }).notNull().default("starter"),
  subscriptionStatus: varchar("subscription_status", { length: 50 }).notNull().default("trial"),
  subscriptionExpiresAt: timestamp("subscription_expires_at", { withTimezone: true }),
  payoutFrequency: varchar("payout_frequency", { length: 20 }).notNull().default("weekly"),
  googleActionsStatus: varchar("google_actions_status", { length: 50 }).notNull().default("pending"),
  cancellationPolicy: jsonb("cancellation_policy"),
  operatingHours: jsonb("operating_hours").$type<Record<string, { open: string; close: string; closed: boolean }>>(),
  // Intentionally bare UUID (no .references()) — adding a FK to groups.id would create
  // a circular import: merchants.ts ← groups.ts ← merchants.ts (via staffMerchants).
  // The application layer enforces referential integrity via resolveClientVisibility().
  groupId: uuid("group_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
