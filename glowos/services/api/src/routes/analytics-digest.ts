import { Hono } from "hono";
import { and, eq, isNull, desc, sql } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  analyticsDigestConfigs,
  analyticsDigestRecipients,
  analyticsDigestRuns,
  analyticsDigestDeliveries,
  merchants,
  merchantUsers,
} from "@glowos/db";
import { requireMerchant, requireRole } from "../middleware/auth.js";
import { zValidator } from "../middleware/validate.js";
import {
  computeDigestMetrics,
  resolvePeriodForFrequency,
} from "../lib/analytics-aggregator.js";
import {
  formatPeriodLabel,
  renderDigestEmail,
  type DigestFrequency,
} from "../lib/analytics-digest-email.js";
import { sendEmail } from "../lib/email.js";
import { config } from "../lib/config.js";
import type { AppVariables } from "../lib/types.js";

const analyticsDigestRouter = new Hono<{ Variables: AppVariables }>();

// ─── Tier gate ───────────────────────────────────────────────────────────────
// Analytics Digest is a paid-tier feature. Starter merchants get a
// feature-locked response with a clear upgrade pointer. We check inside
// the handlers (not as middleware) so GET /config can still 200 with
// `feature_locked: true` — letting the frontend render the upsell card
// without an error toast.
//
// Unlock rules (any one is sufficient):
//   - merchants.subscription_tier = 'multibranch'  (the actual paid tier
//     name in this codebase — original draft used 'multi' / 'brand'
//     which don't exist as values, so every merchant looked locked)
//   - merchants.group_id IS NOT NULL               (member of a group →
//     effectively multi-branch even if the per-branch tier wasn't bumped;
//     covers brand-invite legacy paths)

async function loadMerchantTierContext(
  merchantId: string,
): Promise<{ tier: string; inGroup: boolean }> {
  const [m] = await db
    .select({
      tier: merchants.subscriptionTier,
      groupId: merchants.groupId,
    })
    .from(merchants)
    .where(eq(merchants.id, merchantId))
    .limit(1);
  return { tier: m?.tier ?? "starter", inGroup: m?.groupId != null };
}

function isFeatureUnlocked(ctx: { tier: string; inGroup: boolean }): boolean {
  return ctx.tier === "multibranch" || ctx.inGroup;
}

// ─── Schemas ─────────────────────────────────────────────────────────────────

const upsertConfigSchema = z
  .object({
    frequency: z.enum(["weekly", "monthly", "yearly"]),
    send_hour_local: z.number().int().min(0).max(23).default(8),
    weekday: z.number().int().min(0).max(6).optional(),
    day_of_month: z.number().int().min(1).max(28).optional(),
    is_active: z.boolean().default(true),
  })
  .refine(
    (v) => v.frequency !== "weekly" || v.weekday !== undefined,
    { message: "weekday is required for weekly frequency" },
  )
  .refine(
    (v) => v.frequency !== "monthly" || v.day_of_month !== undefined,
    { message: "day_of_month is required for monthly frequency" },
  );

const addRecipientSchema = z.object({
  merchant_user_id: z.string().uuid(),
});

// ─── GET /merchant/analytics-digest/config ───────────────────────────────────
// Available to anyone with merchant context — non-owners see the read-only
// view. Returns the branch-scope config (PR 1 only supports branch scope).

analyticsDigestRouter.get("/config", requireMerchant, async (c) => {
  const merchantId = c.get("merchantId")!;
  const ctx = await loadMerchantTierContext(merchantId);

  const [cfg] = await db
    .select()
    .from(analyticsDigestConfigs)
    .where(
      and(
        eq(analyticsDigestConfigs.merchantId, merchantId),
        eq(analyticsDigestConfigs.scope, "branch"),
      ),
    )
    .limit(1);

  return c.json({
    feature_locked: !isFeatureUnlocked(ctx),
    tier: ctx.tier,
    in_group: ctx.inGroup,
    config: cfg ?? null,
  });
});

// ─── PUT /merchant/analytics-digest/config ───────────────────────────────────
// Owner-only. Upserts the single branch-scope config row.

analyticsDigestRouter.put(
  "/config",
  requireMerchant,
  requireRole("owner"),
  zValidator(upsertConfigSchema),
  async (c) => {
    const merchantId = c.get("merchantId")!;
    const userId = c.get("userId")!;
    const body = c.get("body") as z.infer<typeof upsertConfigSchema>;

    const ctx = await loadMerchantTierContext(merchantId);
    if (!isFeatureUnlocked(ctx)) {
      return c.json(
        {
          error: "Forbidden",
          message: "Analytics Digest requires the Multibranch tier or group membership.",
        },
        403,
      );
    }

    const [existing] = await db
      .select({ id: analyticsDigestConfigs.id })
      .from(analyticsDigestConfigs)
      .where(
        and(
          eq(analyticsDigestConfigs.merchantId, merchantId),
          eq(analyticsDigestConfigs.scope, "branch"),
        ),
      )
      .limit(1);

    if (existing) {
      const [updated] = await db
        .update(analyticsDigestConfigs)
        .set({
          frequency: body.frequency,
          sendHourLocal: body.send_hour_local,
          weekday: body.weekday ?? null,
          dayOfMonth: body.day_of_month ?? null,
          isActive: body.is_active,
          updatedByUserId: userId,
          updatedAt: new Date(),
        })
        .where(eq(analyticsDigestConfigs.id, existing.id))
        .returning();
      return c.json({ config: updated });
    }

    const [created] = await db
      .insert(analyticsDigestConfigs)
      .values({
        merchantId,
        scope: "branch",
        frequency: body.frequency,
        sendHourLocal: body.send_hour_local,
        weekday: body.weekday ?? null,
        dayOfMonth: body.day_of_month ?? null,
        isActive: body.is_active,
        createdByUserId: userId,
        updatedByUserId: userId,
      })
      .returning();

    // Auto-seed: every owner under this merchant goes onto the recipient
    // list when the config is first created. Owners can be removed later
    // via the recipients UI (frontend warns when zero owners remain).
    const ownerRows = await db
      .select({ id: merchantUsers.id, email: merchantUsers.email })
      .from(merchantUsers)
      .where(
        and(
          eq(merchantUsers.merchantId, merchantId),
          eq(merchantUsers.role, "owner"),
          eq(merchantUsers.isActive, true),
        ),
      );

    if (ownerRows.length > 0) {
      await db.insert(analyticsDigestRecipients).values(
        ownerRows.map((o) => ({
          configId: created!.id,
          merchantUserId: o.id,
          emailSnapshot: o.email,
          addedByUserId: userId,
        })),
      );
    }

    return c.json({ config: created });
  },
);

// ─── GET /merchant/analytics-digest/recipients ───────────────────────────────
// Returns active recipients (joined to merchant_users for live name/role/email).
// Available to all merchant users — drives the read-only view too.

analyticsDigestRouter.get("/recipients", requireMerchant, async (c) => {
  const merchantId = c.get("merchantId")!;

  const rows = await db
    .select({
      id: analyticsDigestRecipients.id,
      merchantUserId: analyticsDigestRecipients.merchantUserId,
      addedAt: analyticsDigestRecipients.addedAt,
      name: merchantUsers.name,
      email: merchantUsers.email,
      role: merchantUsers.role,
    })
    .from(analyticsDigestRecipients)
    .innerJoin(
      analyticsDigestConfigs,
      eq(analyticsDigestRecipients.configId, analyticsDigestConfigs.id),
    )
    .innerJoin(
      merchantUsers,
      eq(analyticsDigestRecipients.merchantUserId, merchantUsers.id),
    )
    .where(
      and(
        eq(analyticsDigestConfigs.merchantId, merchantId),
        eq(analyticsDigestConfigs.scope, "branch"),
        isNull(analyticsDigestRecipients.removedAt),
      ),
    )
    .orderBy(merchantUsers.role, merchantUsers.name);

  return c.json({ recipients: rows });
});

// ─── POST /merchant/analytics-digest/recipients ──────────────────────────────
// Owner-only. Adds a registered merchant_user as a recipient.

analyticsDigestRouter.post(
  "/recipients",
  requireMerchant,
  requireRole("owner"),
  zValidator(addRecipientSchema),
  async (c) => {
    const merchantId = c.get("merchantId")!;
    const userId = c.get("userId")!;
    const body = c.get("body") as z.infer<typeof addRecipientSchema>;

    const [cfg] = await db
      .select({ id: analyticsDigestConfigs.id })
      .from(analyticsDigestConfigs)
      .where(
        and(
          eq(analyticsDigestConfigs.merchantId, merchantId),
          eq(analyticsDigestConfigs.scope, "branch"),
        ),
      )
      .limit(1);
    if (!cfg) {
      return c.json(
        { error: "Conflict", message: "Configure schedule first before adding recipients." },
        409,
      );
    }

    // Verify the target user belongs to this merchant — guards against an
    // owner crafting a request that adds a user from a sibling branch.
    const [target] = await db
      .select({
        id: merchantUsers.id,
        email: merchantUsers.email,
        isActive: merchantUsers.isActive,
      })
      .from(merchantUsers)
      .where(
        and(
          eq(merchantUsers.id, body.merchant_user_id),
          eq(merchantUsers.merchantId, merchantId),
        ),
      )
      .limit(1);
    if (!target || !target.isActive) {
      return c.json(
        { error: "Not Found", message: "User not found or inactive at this merchant." },
        404,
      );
    }

    // If a soft-deleted row exists for this user, resurrect it rather than
    // inserting a duplicate. Keeps the audit trail intact.
    const [existing] = await db
      .select({ id: analyticsDigestRecipients.id })
      .from(analyticsDigestRecipients)
      .where(
        and(
          eq(analyticsDigestRecipients.configId, cfg.id),
          eq(analyticsDigestRecipients.merchantUserId, body.merchant_user_id),
        ),
      )
      .limit(1);

    if (existing) {
      const [resurrected] = await db
        .update(analyticsDigestRecipients)
        .set({
          removedAt: null,
          removedByUserId: null,
          emailSnapshot: target.email,
          addedByUserId: userId,
          addedAt: new Date(),
        })
        .where(eq(analyticsDigestRecipients.id, existing.id))
        .returning();
      return c.json({ recipient: resurrected }, 200);
    }

    const [created] = await db
      .insert(analyticsDigestRecipients)
      .values({
        configId: cfg.id,
        merchantUserId: body.merchant_user_id,
        emailSnapshot: target.email,
        addedByUserId: userId,
      })
      .returning();

    return c.json({ recipient: created }, 201);
  },
);

// ─── DELETE /merchant/analytics-digest/recipients/:id ────────────────────────
// Owner-only. Soft-delete (PDPA — preserve who-saw-what audit).

analyticsDigestRouter.delete(
  "/recipients/:id",
  requireMerchant,
  requireRole("owner"),
  async (c) => {
    const merchantId = c.get("merchantId")!;
    const userId = c.get("userId")!;
    const recipientId = c.req.param("id")!;

    // Scope check via join — only allow removal of recipients tied to a
    // config owned by the caller's merchant.
    const [row] = await db
      .select({ id: analyticsDigestRecipients.id })
      .from(analyticsDigestRecipients)
      .innerJoin(
        analyticsDigestConfigs,
        eq(analyticsDigestRecipients.configId, analyticsDigestConfigs.id),
      )
      .where(
        and(
          eq(analyticsDigestRecipients.id, recipientId),
          eq(analyticsDigestConfigs.merchantId, merchantId),
          isNull(analyticsDigestRecipients.removedAt),
        ),
      )
      .limit(1);

    if (!row) {
      return c.json(
        { error: "Not Found", message: "Recipient not found." },
        404,
      );
    }

    await db
      .update(analyticsDigestRecipients)
      .set({ removedAt: new Date(), removedByUserId: userId })
      .where(eq(analyticsDigestRecipients.id, recipientId));

    return c.json({ success: true });
  },
);

// ─── GET /merchant/analytics-digest/runs ─────────────────────────────────────
// Returns the most recent runs (last 12) for the history widget.

analyticsDigestRouter.get("/runs", requireMerchant, async (c) => {
  const merchantId = c.get("merchantId")!;

  const rows = await db
    .select({
      id: analyticsDigestRuns.id,
      periodStart: analyticsDigestRuns.periodStart,
      periodEnd: analyticsDigestRuns.periodEnd,
      scheduledFor: analyticsDigestRuns.scheduledFor,
      frequencySnapshot: analyticsDigestRuns.frequencySnapshot,
      status: analyticsDigestRuns.status,
      errorMessage: analyticsDigestRuns.errorMessage,
      completedAt: analyticsDigestRuns.completedAt,
    })
    .from(analyticsDigestRuns)
    .innerJoin(
      analyticsDigestConfigs,
      eq(analyticsDigestRuns.configId, analyticsDigestConfigs.id),
    )
    .where(
      and(
        eq(analyticsDigestConfigs.merchantId, merchantId),
        eq(analyticsDigestConfigs.scope, "branch"),
      ),
    )
    .orderBy(desc(analyticsDigestRuns.scheduledFor))
    .limit(12);

  return c.json({ runs: rows });
});

// ─── POST /merchant/analytics-digest/test-send ───────────────────────────────
// Owner-only. Renders + sends the digest synchronously to all current
// recipients using the most recent COMPLETE period for the configured
// frequency. Rate-limited to 1 successful send per hour per config.

analyticsDigestRouter.post(
  "/test-send",
  requireMerchant,
  requireRole("owner"),
  async (c) => {
    const merchantId = c.get("merchantId")!;

    const ctx = await loadMerchantTierContext(merchantId);
    if (!isFeatureUnlocked(ctx)) {
      return c.json(
        {
          error: "Forbidden",
          message: "Analytics Digest requires the Multibranch tier or group membership.",
        },
        403,
      );
    }

    const [cfg] = await db
      .select()
      .from(analyticsDigestConfigs)
      .where(
        and(
          eq(analyticsDigestConfigs.merchantId, merchantId),
          eq(analyticsDigestConfigs.scope, "branch"),
        ),
      )
      .limit(1);

    if (!cfg) {
      return c.json(
        { error: "Conflict", message: "Configure schedule first." },
        409,
      );
    }

    // Rate-limit: 1 successful test-send per hour per config. We piggyback
    // on the runs table — a recent row with status='sent' AND a synthetic
    // 'test' marker in error_message blocks further test sends.
    const [recentTest] = await db
      .select({ id: analyticsDigestRuns.id, scheduledFor: analyticsDigestRuns.scheduledFor })
      .from(analyticsDigestRuns)
      .where(
        and(
          eq(analyticsDigestRuns.configId, cfg.id),
          sql`${analyticsDigestRuns.errorMessage} = 'TEST_SEND'`,
          sql`${analyticsDigestRuns.scheduledFor} > now() - interval '1 hour'`,
        ),
      )
      .limit(1);

    if (recentTest) {
      return c.json(
        {
          error: "Too Many Requests",
          message: "Test send already used this hour. Wait before retrying.",
        },
        429,
      );
    }

    const [merchant] = await db
      .select({ name: merchants.name, slug: merchants.slug })
      .from(merchants)
      .where(eq(merchants.id, merchantId))
      .limit(1);
    if (!merchant) {
      return c.json({ error: "Not Found", message: "Merchant not found" }, 404);
    }

    const recipients = await db
      .select({
        id: analyticsDigestRecipients.id,
        email: merchantUsers.email,
      })
      .from(analyticsDigestRecipients)
      .innerJoin(
        merchantUsers,
        eq(analyticsDigestRecipients.merchantUserId, merchantUsers.id),
      )
      .where(
        and(
          eq(analyticsDigestRecipients.configId, cfg.id),
          isNull(analyticsDigestRecipients.removedAt),
          eq(merchantUsers.isActive, true),
        ),
      );

    if (recipients.length === 0) {
      return c.json(
        {
          error: "Conflict",
          message: "No active recipients. Add at least one recipient first.",
        },
        409,
      );
    }

    const frequency = cfg.frequency as DigestFrequency;
    const { periodStart, periodEnd } = resolvePeriodForFrequency({
      frequency,
      fireAt: new Date(),
    });
    const metrics = await computeDigestMetrics({
      merchantId,
      periodStart,
      periodEnd,
    });
    const periodLabel = formatPeriodLabel({ frequency, periodStart, periodEnd });
    const dashboardUrl = `${config.frontendUrl}/dashboard/analytics`;
    const { subject, html } = renderDigestEmail({
      merchantName: merchant.name,
      frequency,
      metrics,
      dashboardUrl,
      periodLabel,
    });

    // Persist a run row marked as TEST_SEND for rate-limiting + audit.
    //
    // The (config_id, period_start, period_end) UNIQUE index exists for
    // scheduled-fire idempotency — a real worker should never produce two
    // runs for the same period. But test-sends repeatedly target the
    // SAME period (e.g. last full week) until the calendar advances, so
    // a second test-send within the same week would violate the
    // constraint with a raw INSERT (Postgres 23505).
    //
    // Use ON CONFLICT DO UPDATE: if a run already exists for this period
    // we refresh its `scheduled_for` / `status` / TEST_SEND marker and
    // continue. The 1-hour rate limit above already prevents test-spam,
    // so this path is reached only when the rate limit has already
    // expired but the calendar period hasn't rolled over yet.
    const [run] = await db
      .insert(analyticsDigestRuns)
      .values({
        configId: cfg.id,
        periodStart,
        periodEnd,
        scheduledFor: new Date(),
        frequencySnapshot: frequency,
        status: "generating",
        numericPayload: metrics as unknown as Record<string, unknown>,
        startedAt: new Date(),
        errorMessage: "TEST_SEND",
      })
      .onConflictDoUpdate({
        target: [
          analyticsDigestRuns.configId,
          analyticsDigestRuns.periodStart,
          analyticsDigestRuns.periodEnd,
        ],
        set: {
          scheduledFor: new Date(),
          frequencySnapshot: frequency,
          status: "generating",
          numericPayload: metrics as unknown as Record<string, unknown>,
          startedAt: new Date(),
          completedAt: null,
          errorMessage: "TEST_SEND",
        },
      })
      .returning();

    // Clear any delivery rows from a previous test send for THIS run.
    // PR #66 tried ON CONFLICT DO UPDATE here but the
    // analytics_digest_deliveries_run_recipient_unique index is PARTIAL
    // (`WHERE recipient_id IS NOT NULL`), and Postgres requires the
    // ON CONFLICT predicate to match the partial index — Drizzle's
    // raw target without a WHERE produced 42P10 ("no unique constraint
    // matching the ON CONFLICT specification"). Delete-then-insert is
    // the simpler, partial-index-safe alternative: each test send gets
    // a fresh slate of delivery rows tied to the same run id.
    await db
      .delete(analyticsDigestDeliveries)
      .where(eq(analyticsDigestDeliveries.runId, run!.id));

    let okCount = 0;
    let failCount = 0;
    for (const r of recipients) {
      const result = await sendEmail({ to: r.email, subject, html });
      await db.insert(analyticsDigestDeliveries).values({
        runId: run!.id,
        recipientId: r.id,
        email: r.email,
        status: result.ok ? "sent" : "failed",
        sentAt: result.ok ? new Date() : null,
        errorMessage: result.error ?? null,
      });
      if (result.ok) okCount += 1;
      else failCount += 1;
    }

    await db
      .update(analyticsDigestRuns)
      .set({
        status: failCount === 0 ? "sent" : okCount === 0 ? "failed" : "partial",
        completedAt: new Date(),
      })
      .where(eq(analyticsDigestRuns.id, run!.id));

    return c.json({
      success: true,
      recipients_count: recipients.length,
      sent: okCount,
      failed: failCount,
      preview_period: periodLabel,
    });
  },
);

// ─── GET /merchant/analytics-digest/eligible-users ───────────────────────────
// Returns all active merchant_users at this branch — used by the
// recipient picker so owners can choose who to add. Excludes anyone
// already on the (active) recipient list to keep the dropdown tidy.

analyticsDigestRouter.get("/eligible-users", requireMerchant, async (c) => {
  const merchantId = c.get("merchantId")!;

  const [cfg] = await db
    .select({ id: analyticsDigestConfigs.id })
    .from(analyticsDigestConfigs)
    .where(
      and(
        eq(analyticsDigestConfigs.merchantId, merchantId),
        eq(analyticsDigestConfigs.scope, "branch"),
      ),
    )
    .limit(1);

  // Subquery: ids already in the active recipient list.
  const alreadyRecipientIds = cfg
    ? (
        await db
          .select({ id: analyticsDigestRecipients.merchantUserId })
          .from(analyticsDigestRecipients)
          .where(
            and(
              eq(analyticsDigestRecipients.configId, cfg.id),
              isNull(analyticsDigestRecipients.removedAt),
            ),
          )
      ).map((r) => r.id)
    : [];

  const users = await db
    .select({
      id: merchantUsers.id,
      name: merchantUsers.name,
      email: merchantUsers.email,
      role: merchantUsers.role,
    })
    .from(merchantUsers)
    .where(
      and(
        eq(merchantUsers.merchantId, merchantId),
        eq(merchantUsers.isActive, true),
      ),
    )
    .orderBy(merchantUsers.role, merchantUsers.name);

  const filtered = users.filter((u) => !alreadyRecipientIds.includes(u.id));
  return c.json({ users: filtered });
});

export { analyticsDigestRouter };
