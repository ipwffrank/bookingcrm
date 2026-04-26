import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  jsonb,
  timestamp,
  index,
  unique,
} from "drizzle-orm/pg-core";
import { merchants } from "./merchants";

export const automationKind = ["birthday", "winback", "rebook"] as const;
export type AutomationKind = (typeof automationKind)[number];

// One row per (merchant, kind) — there's only ever one birthday rule per
// merchant, etc. Toggle on/off via `enabled`. The messageTemplate supports
// {{name}}, {{merchantName}}, {{promoCode}} placeholders that the worker
// substitutes at send time.
//
// Configuration per kind lives in `config` JSONB:
//   - birthday:  { sendDaysBefore?: 0 } — currently send on birthday day only
//   - winback:   { afterDays: 90 } — trigger N days since last completed booking
//   - rebook:    { defaultAfterDays: 30, perService?: { [serviceId]: days } }
//
// `lastRunAt` tracks the last successful daily run so we can show ops health.
export const automations = pgTable(
  "automations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    merchantId: uuid("merchant_id")
      .notNull()
      .references(() => merchants.id, { onDelete: "cascade" }),
    kind: varchar("kind", { length: 20 })
      .notNull()
      .$type<AutomationKind>(),
    enabled: boolean("enabled").notNull().default(false),
    messageTemplate: text("message_template").notNull().default(""),
    promoCode: varchar("promo_code", { length: 50 }),
    config: jsonb("config").notNull().default({}),
    lastRunAt: timestamp("last_run_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    merchantKindIdx: index("automations_merchant_kind_idx").on(t.merchantId, t.kind),
    merchantKindUnique: unique("automations_merchant_kind_unique").on(t.merchantId, t.kind),
  }),
);

// Per-client per-automation send log. Used to ensure we don't re-send the same
// automation to the same client more than once per natural cadence:
//   - birthday: once per (clientId, year)
//   - winback: once per "winback cooldown window" (use sentAt to dedupe within
//     the merchant-configured afterDays * 1.5)
//   - rebook: one per (clientId, bookingId)
export const automationSends = pgTable(
  "automation_sends",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    automationId: uuid("automation_id")
      .notNull()
      .references(() => automations.id, { onDelete: "cascade" }),
    merchantId: uuid("merchant_id").notNull(),
    clientId: uuid("client_id").notNull(),
    bookingId: uuid("booking_id"),
    dedupeKey: varchar("dedupe_key", { length: 255 }).notNull(),
    channel: varchar("channel", { length: 20 }).notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    dedupeIdx: unique("automation_sends_dedupe_unique").on(t.automationId, t.dedupeKey),
    clientIdx: index("automation_sends_client_idx").on(t.merchantId, t.clientId, t.sentAt),
  }),
);
