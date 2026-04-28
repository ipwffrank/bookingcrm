import {
  pgTable,
  uuid,
  varchar,
  text,
  smallint,
  boolean,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { merchants } from "./merchants.js";
import { groups } from "./groups.js";
import { merchantUsers } from "./merchant-users.js";

/**
 * Per-merchant scheduled email reports. PR 1 ships numeric content only;
 * AI prose suggestions land in PR 2 and reuse the `aiOutputMd` /
 * `aiInputHash` columns on `analytics_digest_runs` so we don't re-migrate.
 *
 * Group-scope rollup reports land in PR 3. The `scope` column already
 * supports 'group' to avoid reshaping later — but no UI surfaces it yet.
 */
export const analyticsDigestConfigs = pgTable(
  "analytics_digest_configs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    merchantId: uuid("merchant_id")
      .notNull()
      .references(() => merchants.id, { onDelete: "cascade" }),
    // Non-null only when scope='group'. The CHECK constraint at the SQL
    // level enforces this — Drizzle doesn't emit conditional FKs.
    groupId: uuid("group_id").references(() => groups.id, {
      onDelete: "cascade",
    }),
    scope: varchar("scope", { length: 10 }).notNull().default("branch"),
    frequency: varchar("frequency", { length: 10 }).notNull(),
    sendHourLocal: smallint("send_hour_local").notNull().default(8),
    weekday: smallint("weekday"),
    dayOfMonth: smallint("day_of_month"),
    isActive: boolean("is_active").notNull().default(true),
    lastFiredAt: timestamp("last_fired_at", { withTimezone: true }),
    createdByUserId: uuid("created_by_user_id").references(() => merchantUsers.id),
    updatedByUserId: uuid("updated_by_user_id").references(() => merchantUsers.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    branchUnique: uniqueIndex("analytics_digest_configs_branch_unique")
      .on(t.merchantId)
      .where(sql`${t.scope} = 'branch'`),
    groupUnique: uniqueIndex("analytics_digest_configs_group_unique")
      .on(t.groupId)
      .where(sql`${t.scope} = 'group'`),
    activeIdx: index("analytics_digest_configs_active_idx").on(
      t.isActive,
      t.frequency,
    ),
    frequencyCheck: check(
      "analytics_digest_configs_frequency_check",
      sql`${t.frequency} IN ('weekly', 'monthly', 'yearly')`,
    ),
    scopeCheck: check(
      "analytics_digest_configs_scope_check",
      sql`${t.scope} IN ('branch', 'group')`,
    ),
    groupScopeCheck: check(
      "analytics_digest_configs_group_scope_requires_group_id",
      sql`(${t.scope} = 'branch' AND ${t.groupId} IS NULL)
       OR (${t.scope} = 'group' AND ${t.groupId} IS NOT NULL)`,
    ),
  }),
);

export const analyticsDigestRecipients = pgTable(
  "analytics_digest_recipients",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    configId: uuid("config_id")
      .notNull()
      .references(() => analyticsDigestConfigs.id, { onDelete: "cascade" }),
    merchantUserId: uuid("merchant_user_id")
      .notNull()
      .references(() => merchantUsers.id, { onDelete: "restrict" }),
    // Snapshotted at insert AND re-verified live against
    // merchant_users.email at send time. If the user updates their email
    // mid-cycle the live value wins.
    emailSnapshot: varchar("email_snapshot", { length: 255 }).notNull(),
    addedByUserId: uuid("added_by_user_id").references(() => merchantUsers.id),
    addedAt: timestamp("added_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    removedAt: timestamp("removed_at", { withTimezone: true }),
    removedByUserId: uuid("removed_by_user_id").references(() => merchantUsers.id),
  },
  (t) => ({
    activeUnique: uniqueIndex("analytics_digest_recipients_active_unique")
      .on(t.configId, t.merchantUserId)
      .where(sql`${t.removedAt} IS NULL`),
    configIdx: index("analytics_digest_recipients_config_idx")
      .on(t.configId)
      .where(sql`${t.removedAt} IS NULL`),
  }),
);

/**
 * One row per scheduled fire. The (config_id, period_start, period_end)
 * unique index is the idempotency key — workers race on
 * INSERT ... ON CONFLICT DO NOTHING and only the winner generates the
 * report.
 */
export const analyticsDigestRuns = pgTable(
  "analytics_digest_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    configId: uuid("config_id")
      .notNull()
      .references(() => analyticsDigestConfigs.id, { onDelete: "cascade" }),
    periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
    periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }).notNull(),
    frequencySnapshot: varchar("frequency_snapshot", { length: 10 }).notNull(),
    status: varchar("status", { length: 20 }).notNull().default("queued"),
    aiProvider: varchar("ai_provider", { length: 40 }),
    aiPromptVersion: varchar("ai_prompt_version", { length: 40 }),
    aiInputHash: varchar("ai_input_hash", { length: 64 }),
    aiOutputMd: text("ai_output_md"),
    numericPayload: jsonb("numeric_payload"),
    errorMessage: text("error_message"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    idempotency: uniqueIndex("analytics_digest_runs_idempotency_unique").on(
      t.configId,
      t.periodStart,
      t.periodEnd,
    ),
    recentByConfigIdx: index("analytics_digest_runs_config_recent_idx").on(
      t.configId,
      t.scheduledFor,
    ),
    statusCheck: check(
      "analytics_digest_runs_status_check",
      sql`${t.status} IN ('queued', 'generating', 'sent', 'partial', 'failed', 'skipped')`,
    ),
  }),
);

export const analyticsDigestDeliveries = pgTable(
  "analytics_digest_deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id")
      .notNull()
      .references(() => analyticsDigestRuns.id, { onDelete: "cascade" }),
    recipientId: uuid("recipient_id").references(
      () => analyticsDigestRecipients.id,
      { onDelete: "set null" },
    ),
    email: varchar("email", { length: 255 }).notNull(),
    sendgridMessageId: varchar("sendgrid_message_id", { length: 255 }),
    status: varchar("status", { length: 20 }).notNull().default("pending"),
    errorMessage: text("error_message"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    runRecipientUnique: uniqueIndex(
      "analytics_digest_deliveries_run_recipient_unique",
    )
      .on(t.runId, t.recipientId)
      .where(sql`${t.recipientId} IS NOT NULL`),
    runIdx: index("analytics_digest_deliveries_run_idx").on(t.runId),
    statusCheck: check(
      "analytics_digest_deliveries_status_check",
      sql`${t.status} IN ('pending', 'sent', 'bounced', 'skipped', 'failed')`,
    ),
  }),
);
