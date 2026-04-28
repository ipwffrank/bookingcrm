-- ─── Analytics Digest (PR 1) ──────────────────────────────────────────────────
-- Per-merchant scheduled email reports. Numeric content only in PR 1; AI
-- prose suggestions land in PR 2 (ai_output_md / ai_input_hash columns are
-- pre-provisioned so we don't need a follow-up migration). Group-scope
-- rollup reports land in PR 3 (the configs table already supports a 'group'
-- scope value to avoid re-shaping later).

CREATE TABLE "analytics_digest_configs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "merchant_id" uuid NOT NULL REFERENCES "merchants"("id") ON DELETE CASCADE,
  "group_id" uuid REFERENCES "groups"("id") ON DELETE CASCADE,
  -- 'branch' = report for one merchant; 'group' = aggregated rollup across
  -- a group's branches. group_id MUST be set when scope = 'group'.
  "scope" varchar(10) NOT NULL DEFAULT 'branch',
  -- Cadence + when to fire. send_hour_local is 0–23 in merchant.timezone.
  -- weekday: 0=Sun..6=Sat, used only when frequency='weekly'.
  -- day_of_month: 1–28 (capped to avoid Feb 29/30/31 edge), used for monthly.
  -- year_month + year_day are NOT stored; yearly fires on Jan 1 by convention.
  "frequency" varchar(10) NOT NULL,
  "send_hour_local" smallint NOT NULL DEFAULT 8,
  "weekday" smallint,
  "day_of_month" smallint,
  "is_active" boolean NOT NULL DEFAULT true,
  "last_fired_at" timestamp with time zone,
  "created_by_user_id" uuid REFERENCES "merchant_users"("id"),
  "updated_by_user_id" uuid REFERENCES "merchant_users"("id"),
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "analytics_digest_configs_frequency_check"
    CHECK ("frequency" IN ('weekly', 'monthly', 'yearly')),
  CONSTRAINT "analytics_digest_configs_scope_check"
    CHECK ("scope" IN ('branch', 'group')),
  CONSTRAINT "analytics_digest_configs_group_scope_requires_group_id"
    CHECK (("scope" = 'branch' AND "group_id" IS NULL)
        OR ("scope" = 'group' AND "group_id" IS NOT NULL))
);

-- One config per (merchant, group, scope). For branch scope group_id is null
-- — and Postgres unique treats nulls as distinct, so we use a partial unique
-- index per scope to enforce "one branch config per merchant" and "one group
-- config per group" cleanly.
CREATE UNIQUE INDEX "analytics_digest_configs_branch_unique"
  ON "analytics_digest_configs" ("merchant_id")
  WHERE "scope" = 'branch';
CREATE UNIQUE INDEX "analytics_digest_configs_group_unique"
  ON "analytics_digest_configs" ("group_id")
  WHERE "scope" = 'group';

CREATE INDEX "analytics_digest_configs_active_idx"
  ON "analytics_digest_configs" ("is_active", "frequency");

-- ─── Recipients ──────────────────────────────────────────────────────────────
-- Soft-deleted via removed_at to preserve audit trail (PDPA — these emails
-- contained client revenue / staff revenue data). Email is snapshotted at
-- insert AND re-verified live at send time against the current
-- merchant_users.email value, so renaming staff or rotating their email
-- breaks the link cleanly without sending stale addresses.

CREATE TABLE "analytics_digest_recipients" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "config_id" uuid NOT NULL
    REFERENCES "analytics_digest_configs"("id") ON DELETE CASCADE,
  "merchant_user_id" uuid NOT NULL
    REFERENCES "merchant_users"("id") ON DELETE RESTRICT,
  "email_snapshot" varchar(255) NOT NULL,
  "added_by_user_id" uuid REFERENCES "merchant_users"("id"),
  "added_at" timestamp with time zone NOT NULL DEFAULT now(),
  "removed_at" timestamp with time zone,
  "removed_by_user_id" uuid REFERENCES "merchant_users"("id")
);

CREATE UNIQUE INDEX "analytics_digest_recipients_active_unique"
  ON "analytics_digest_recipients" ("config_id", "merchant_user_id")
  WHERE "removed_at" IS NULL;

CREATE INDEX "analytics_digest_recipients_config_idx"
  ON "analytics_digest_recipients" ("config_id")
  WHERE "removed_at" IS NULL;

-- ─── Runs ────────────────────────────────────────────────────────────────────
-- One row per scheduled fire. The (config_id, period_start, period_end) UNIQUE
-- constraint is the idempotency key — workers race on INSERT ON CONFLICT
-- DO NOTHING and only the winner generates the report. ai_* columns are
-- pre-provisioned for PR 2; they're nullable and ignored in PR 1.

CREATE TABLE "analytics_digest_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "config_id" uuid NOT NULL
    REFERENCES "analytics_digest_configs"("id") ON DELETE CASCADE,
  "period_start" timestamp with time zone NOT NULL,
  "period_end" timestamp with time zone NOT NULL,
  "scheduled_for" timestamp with time zone NOT NULL,
  "frequency_snapshot" varchar(10) NOT NULL,
  "status" varchar(20) NOT NULL DEFAULT 'queued',
  "ai_provider" varchar(40),
  "ai_prompt_version" varchar(40),
  "ai_input_hash" char(64),
  "ai_output_md" text,
  "numeric_payload" jsonb,
  "error_message" text,
  "started_at" timestamp with time zone,
  "completed_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "analytics_digest_runs_status_check"
    CHECK ("status" IN ('queued', 'generating', 'sent', 'partial', 'failed', 'skipped'))
);

CREATE UNIQUE INDEX "analytics_digest_runs_idempotency_unique"
  ON "analytics_digest_runs" ("config_id", "period_start", "period_end");

CREATE INDEX "analytics_digest_runs_config_recent_idx"
  ON "analytics_digest_runs" ("config_id", "scheduled_for" DESC);

-- ─── Deliveries ──────────────────────────────────────────────────────────────
-- One row per recipient per run. Status flips async via SendGrid webhook for
-- bounce tracking. The recipient_id ON DELETE SET NULL preserves the
-- delivery row even if a recipient is hard-deleted later (shouldn't happen
-- given our soft-delete pattern, but defence in depth for the audit log).

CREATE TABLE "analytics_digest_deliveries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "run_id" uuid NOT NULL
    REFERENCES "analytics_digest_runs"("id") ON DELETE CASCADE,
  "recipient_id" uuid
    REFERENCES "analytics_digest_recipients"("id") ON DELETE SET NULL,
  "email" varchar(255) NOT NULL,
  "sendgrid_message_id" varchar(255),
  "status" varchar(20) NOT NULL DEFAULT 'pending',
  "error_message" text,
  "sent_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "analytics_digest_deliveries_status_check"
    CHECK ("status" IN ('pending', 'sent', 'bounced', 'skipped', 'failed'))
);

CREATE UNIQUE INDEX "analytics_digest_deliveries_run_recipient_unique"
  ON "analytics_digest_deliveries" ("run_id", "recipient_id")
  WHERE "recipient_id" IS NOT NULL;

CREATE INDEX "analytics_digest_deliveries_run_idx"
  ON "analytics_digest_deliveries" ("run_id");
