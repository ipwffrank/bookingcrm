import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  date,
  integer,
  numeric,
  timestamp,
  unique,
  index,
} from "drizzle-orm/pg-core";
import { merchants } from "./merchants";
import { staff } from "./staff";

export const clients = pgTable("clients", {
  id: uuid("id").primaryKey().defaultRandom(),
  phone: varchar("phone", { length: 20 }).notNull().unique(),
  email: varchar("email", { length: 255 }),
  name: varchar("name", { length: 255 }),
  googleId: varchar("google_id", { length: 255 }).unique(),
  avatarUrl: varchar("avatar_url", { length: 500 }),
  acquisitionSource: varchar("acquisition_source", { length: 30 })
    .notNull()
    .default("online_booking")
    .$type<"online_booking" | "walkin" | "import" | "social">(),
  preferredContactChannel: varchar("preferred_contact_channel", { length: 20 })
    .notNull()
    .default("whatsapp")
    .$type<"email" | "whatsapp">(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const clientProfiles = pgTable(
  "client_profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    merchantId: uuid("merchant_id")
      .notNull()
      .references(() => merchants.id, { onDelete: "cascade" }),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    notes: text("notes"),
    birthday: date("birthday"),
    preferredStaffId: uuid("preferred_staff_id").references(() => staff.id, {
      onDelete: "set null",
    }),
    vipTier: varchar("vip_tier", { length: 20 }).notNull().default("bronze"),
    vipScore: numeric("vip_score", { precision: 8, scale: 2 }).notNull().default("0"),
    rfmRecency: integer("rfm_recency"),
    rfmFrequency: integer("rfm_frequency"),
    rfmMonetary: numeric("rfm_monetary", { precision: 10, scale: 2 }),
    avgVisitCadenceDays: numeric("avg_visit_cadence_days", { precision: 6, scale: 2 }),
    lastVisitDate: date("last_visit_date"),
    nextPredictedVisit: date("next_predicted_visit"),
    churnRisk: varchar("churn_risk", { length: 20 }).notNull().default("low"),
    marketingOptIn: boolean("marketing_opt_in").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    merchantClientUnique: unique("merchant_client_unique").on(
      table.merchantId,
      table.clientId
    ),
    merchantIdx: index("client_profiles_merchant_idx").on(table.merchantId),
    merchantVipTierIdx: index("client_profiles_merchant_vip_tier_idx").on(
      table.merchantId,
      table.vipTier
    ),
    merchantChurnRiskIdx: index("client_profiles_merchant_churn_risk_idx").on(
      table.merchantId,
      table.churnRisk
    ),
  })
);
