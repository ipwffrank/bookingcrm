import { Worker } from "bullmq";
import { and, eq, isNull, sql } from "drizzle-orm";
import {
  db,
  analyticsDigestConfigs,
  analyticsDigestRecipients,
  analyticsDigestRuns,
  analyticsDigestDeliveries,
  merchants,
  merchantUsers,
} from "@glowos/db";
import { config } from "../lib/config.js";
import {
  computeDigestMetrics,
  resolvePeriodForFrequency,
  getMerchantTimezone,
} from "../lib/analytics-aggregator.js";
import {
  formatPeriodLabel,
  renderDigestEmail,
  type DigestFrequency,
} from "../lib/analytics-digest-email.js";
import { sendEmail } from "../lib/email.js";
import { QUEUE_PREFIX, addJob } from "../lib/queue.js";

// Connection options match the other workers (notification, crm, vip,
// automation): explicit retryStrategy keeps reconnects predictable when
// Redis blips, instead of relying on ioredis defaults that other workers
// don't share.
const connection = {
  url: config.redisUrl,
  retryStrategy: (times: number) => Math.min(times * 2000, 30000),
};

/**
 * Returns the local hour 0–23 in the given IANA timezone right now.
 * Used by the dispatch tick to decide which configs are due to fire.
 */
function localHourIn(tz: string, when: Date): number {
  return parseInt(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: tz,
      hour: "numeric",
      hour12: false,
    }).format(when),
    10,
  );
}

/**
 * Returns the local day-of-week (0=Sun..6=Sat) and day-of-month at the
 * given timezone right now. Both are needed by the dispatch tick to
 * match a config's `weekday` / `day_of_month` settings.
 */
function localDateParts(tz: string, when: Date): { dow: number; dom: number; dayKey: string } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    weekday: "short",
    day: "numeric",
    month: "numeric",
    year: "numeric",
  }).formatToParts(when);
  const weekdayMap: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };
  const wd = parts.find((p) => p.type === "weekday")?.value ?? "Mon";
  const dom = parseInt(parts.find((p) => p.type === "day")?.value ?? "1", 10);
  const dayKey = `${parts.find((p) => p.type === "year")?.value}-${parts.find((p) => p.type === "month")?.value}-${parts.find((p) => p.type === "day")?.value}`;
  return { dow: weekdayMap[wd] ?? 1, dom, dayKey };
}

/**
 * Tick processor — runs every 15 minutes via a BullMQ repeatable job.
 * Walks all active configs, evaluates "is this config due to fire NOW
 * in its merchant's local timezone?", and enqueues a `generate` job
 * for each due config. Idempotency comes from the unique constraint
 * on analytics_digest_runs(config_id, period_start, period_end).
 */
async function processTick(): Promise<void> {
  const now = new Date();
  const configs = await db
    .select({
      id: analyticsDigestConfigs.id,
      merchantId: analyticsDigestConfigs.merchantId,
      frequency: analyticsDigestConfigs.frequency,
      sendHourLocal: analyticsDigestConfigs.sendHourLocal,
      weekday: analyticsDigestConfigs.weekday,
      dayOfMonth: analyticsDigestConfigs.dayOfMonth,
      lastFiredAt: analyticsDigestConfigs.lastFiredAt,
    })
    .from(analyticsDigestConfigs)
    .where(eq(analyticsDigestConfigs.isActive, true));

  for (const cfg of configs) {
    try {
      const tz = await getMerchantTimezone(cfg.merchantId);
      const hour = localHourIn(tz, now);
      const { dow, dom, dayKey } = localDateParts(tz, now);

      // Hour gate: only fire within the configured hour.
      if (hour !== cfg.sendHourLocal) continue;

      // Cadence gate.
      if (cfg.frequency === "weekly") {
        if (cfg.weekday === null || dow !== cfg.weekday) continue;
      } else if (cfg.frequency === "monthly") {
        if (cfg.dayOfMonth === null || dom !== cfg.dayOfMonth) continue;
      } else if (cfg.frequency === "yearly") {
        // Yearly fires Jan 1 only.
        if (dom !== 1 || dow >= 0 /* always true */) {
          // We need month too — re-derive.
          const month = parseInt(
            new Intl.DateTimeFormat("en-GB", { timeZone: tz, month: "numeric" }).format(now),
            10,
          );
          if (month !== 1 || dom !== 1) continue;
        }
      }

      // Same-day debounce: if we already fired in this local day, skip.
      // (Hour gate already narrows to one hour, but a worker restart
      // mid-tick could otherwise re-fire — the run-table unique constraint
      // is the ultimate guard but this saves a cycle.)
      if (cfg.lastFiredAt) {
        const lastDayKey = (() => {
          const parts = new Intl.DateTimeFormat("en-GB", {
            timeZone: tz, day: "numeric", month: "numeric", year: "numeric",
          }).formatToParts(cfg.lastFiredAt);
          return `${parts.find((p) => p.type === "year")?.value}-${parts.find((p) => p.type === "month")?.value}-${parts.find((p) => p.type === "day")?.value}`;
        })();
        if (lastDayKey === dayKey) continue;
      }

      // Compute the period this fire covers and enqueue.
      const { periodStart, periodEnd } = resolvePeriodForFrequency({
        frequency: cfg.frequency as DigestFrequency,
        fireAt: now,
      });

      await addJob(
        "reports",
        "generate",
        {
          config_id: cfg.id,
          period_start: periodStart.toISOString(),
          period_end: periodEnd.toISOString(),
        },
      );

      // Optimistic last_fired_at — the unique-constraint race below means
      // even if two ticks both reach this line, only one generate-job
      // produces an actual run row. Keeping last_fired_at advisory.
      await db
        .update(analyticsDigestConfigs)
        .set({ lastFiredAt: now })
        .where(eq(analyticsDigestConfigs.id, cfg.id));
    } catch (err) {
      console.error("[ReportWorker:tick] config evaluation failed", {
        configId: cfg.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

/**
 * Generate processor — produces the digest for one config + period.
 * Idempotent via INSERT ... ON CONFLICT DO NOTHING on the runs table.
 */
async function processGenerate(data: {
  config_id: string;
  period_start: string;
  period_end: string;
}): Promise<void> {
  const periodStart = new Date(data.period_start);
  const periodEnd = new Date(data.period_end);

  const [cfg] = await db
    .select()
    .from(analyticsDigestConfigs)
    .where(eq(analyticsDigestConfigs.id, data.config_id))
    .limit(1);
  if (!cfg) {
    console.warn("[ReportWorker:generate] config gone", { configId: data.config_id });
    return;
  }

  // Idempotent claim: try to insert the run row. If a unique-violation
  // happens, another worker already owns this period — exit silently.
  const inserted = await db
    .insert(analyticsDigestRuns)
    .values({
      configId: cfg.id,
      periodStart,
      periodEnd,
      scheduledFor: new Date(),
      frequencySnapshot: cfg.frequency,
      status: "generating",
      startedAt: new Date(),
    })
    .onConflictDoNothing({
      target: [
        analyticsDigestRuns.configId,
        analyticsDigestRuns.periodStart,
        analyticsDigestRuns.periodEnd,
      ],
    })
    .returning();

  if (inserted.length === 0) {
    console.log("[ReportWorker:generate] another worker owns this run", {
      configId: cfg.id,
      periodStart: data.period_start,
    });
    return;
  }
  const run = inserted[0]!;

  try {
    const [merchant] = await db
      .select({ name: merchants.name, slug: merchants.slug })
      .from(merchants)
      .where(eq(merchants.id, cfg.merchantId))
      .limit(1);
    if (!merchant) {
      throw new Error(`Merchant ${cfg.merchantId} not found`);
    }

    const recipients = await db
      .select({
        id: analyticsDigestRecipients.id,
        email: merchantUsers.email,
      })
      .from(analyticsDigestRecipients)
      .innerJoin(merchantUsers, eq(analyticsDigestRecipients.merchantUserId, merchantUsers.id))
      .where(
        and(
          eq(analyticsDigestRecipients.configId, cfg.id),
          isNull(analyticsDigestRecipients.removedAt),
          eq(merchantUsers.isActive, true),
        ),
      );

    if (recipients.length === 0) {
      await db
        .update(analyticsDigestRuns)
        .set({
          status: "skipped",
          errorMessage: "no_active_recipients",
          completedAt: new Date(),
        })
        .where(eq(analyticsDigestRuns.id, run.id));
      console.log("[ReportWorker:generate] no recipients, skipping", { configId: cfg.id });
      return;
    }

    const frequency = cfg.frequency as DigestFrequency;
    const metrics = await computeDigestMetrics({
      merchantId: cfg.merchantId,
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

    let okCount = 0;
    let failCount = 0;
    for (const r of recipients) {
      const result = await sendEmail({ to: r.email, subject, html });
      await db.insert(analyticsDigestDeliveries).values({
        runId: run.id,
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
        numericPayload: metrics as unknown as Record<string, unknown>,
      })
      .where(eq(analyticsDigestRuns.id, run.id));

    console.log("[ReportWorker:generate] complete", {
      configId: cfg.id,
      sent: okCount,
      failed: failCount,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await db
      .update(analyticsDigestRuns)
      .set({ status: "failed", errorMessage: msg, completedAt: new Date() })
      .where(eq(analyticsDigestRuns.id, run.id));
    console.error("[ReportWorker:generate] failed", { configId: cfg.id, error: msg });
    throw err; // let BullMQ retry per default options
  }
}

export function createReportWorker(): Worker {
  const worker = new Worker(
    "reports",
    async (job) => {
      if (job.name === "tick") {
        await processTick();
      } else if (job.name === "generate") {
        await processGenerate(
          job.data as { config_id: string; period_start: string; period_end: string },
        );
      } else {
        console.warn("[ReportWorker] unknown job name", { name: job.name });
      }
    },
    { connection, prefix: QUEUE_PREFIX, concurrency: 4 },
  );

  worker.on("failed", (job, err) => {
    console.error("[ReportWorker] job failed", {
      job: job?.name,
      error: err.message,
    });
  });

  console.log("[ReportWorker] started");
  return worker;
}

// Suppress unused import warning — sql is used inside Drizzle helpers above.
void sql;
