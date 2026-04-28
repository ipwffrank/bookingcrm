/**
 * automation.worker.ts
 *
 * Processes the `automation_daily_sweep` BullMQ job.
 * Runs once per day (registered in workers/index.ts at 01:05 UTC).
 *
 * Iterates every enabled `automations` row and fires matching notifications
 * per automation kind:
 *   - birthday  — client whose birthday MM-DD matches today
 *   - winback   — client whose last completed booking is >= afterDays ago
 *   - rebook    — booking completed exactly defaultAfterDays ago
 *
 * All sends are deduplicated via `automation_sends.dedupe_key` with an ON
 * CONFLICT DO NOTHING insert so the sweep is safe to re-run.
 */

import { Worker } from "bullmq";
import type { Job } from "bullmq";
import { eq, and, lt, gte, sql } from "drizzle-orm";
import {
  db,
  automations,
  automationSends,
  clients,
  clientProfiles,
  bookings,
  merchants,
  notificationLog,
} from "@glowos/db";
import type { AutomationKind } from "@glowos/db";
import { sendWhatsApp } from "../lib/twilio.js";
import { sendEmail } from "../lib/email.js";
import { config } from "../lib/config.js";

// ─── Template substitution ────────────────────────────────────────────────────

function renderTemplate(
  template: string,
  vars: { name: string; merchantName: string; promoCode: string }
): string {
  return template
    .replace(/\{\{name\}\}/g, vars.name)
    .replace(/\{\{merchantName\}\}/g, vars.merchantName)
    .replace(/\{\{promoCode\}\}/g, vars.promoCode);
}

// ─── Send helpers ─────────────────────────────────────────────────────────────

async function sendAutomationMessage(params: {
  merchantId: string;
  clientId: string;
  bookingId: string | null;
  automationKind: AutomationKind;
  messageBody: string;
  phone: string | null;
  email: string | null;
  clientName: string;
  merchantName: string;
}): Promise<{ whatsappSid: string; emailOk: boolean }> {
  let whatsappSid = "";
  let emailOk = false;

  const { merchantId, clientId, bookingId, automationKind, messageBody, phone, email } = params;

  // WhatsApp
  if (phone) {
    const whatsappResult = await sendWhatsApp(phone, messageBody);
    whatsappSid = whatsappResult.sid ?? "";
    try {
      await db.insert(notificationLog).values({
        merchantId,
        clientId,
        bookingId: bookingId ?? undefined,
        type: `automation_${automationKind}`,
        channel: "whatsapp",
        recipient: phone,
        messageBody,
        status: whatsappResult.ok ? "sent" : "failed",
        twilioSid: whatsappResult.sid,
        errorMessage: whatsappResult.error,
      });
    } catch (err) {
      console.error("[AutomationWorker] Failed to log WhatsApp notification", err);
    }
  }

  // Email
  if (email) {
    const emailResult = await sendEmail({
      to: email,
      subject: `A message from ${params.merchantName}`,
      html: `<p>${messageBody.replace(/\n/g, "<br>")}</p>`,
    });
    emailOk = emailResult.ok;
    try {
      await db.insert(notificationLog).values({
        merchantId,
        clientId,
        bookingId: bookingId ?? undefined,
        type: `automation_${automationKind}`,
        channel: "email",
        recipient: email,
        messageBody,
        status: emailResult.ok ? "sent" : "failed",
        errorMessage: emailResult.error,
      });
    } catch (err) {
      console.error("[AutomationWorker] Failed to log email notification", err);
    }
  }

  return { whatsappSid, emailOk };
}

// ─── Kind-specific sweep handlers ─────────────────────────────────────────────

/**
 * Birthday sweep: find clients where birthday MM-DD = today's MM-DD,
 * who haven't been sent a birthday message this calendar year.
 */
export async function handleBirthday(automation: typeof automations.$inferSelect): Promise<number> {
  // Load merchant first — we need their timezone to compute "today's" MM-DD
  // correctly. The cron may run at any UTC hour but a SE-Asian merchant
  // (e.g., Asia/Singapore +08, Asia/Bangkok +07) sees a different calendar
  // date for ~16 hours of each UTC day.
  const [merchant] = await db
    .select({ name: merchants.name, timezone: merchants.timezone })
    .from(merchants)
    .where(eq(merchants.id, automation.merchantId))
    .limit(1);

  const tz = merchant?.timezone ?? "UTC";
  // en-CA gives ISO-style YYYY-MM-DD which is unambiguous to split.
  const dateStr = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const [year, mm, dd] = dateStr.split("-");

  // Find clients of this merchant whose birthday month-day matches today
  const rows = await db
    .select({
      clientId: clientProfiles.clientId,
      birthday: clientProfiles.birthday,
      marketingOptIn: clientProfiles.marketingOptIn,
    })
    .from(clientProfiles)
    .where(
      and(
        eq(clientProfiles.merchantId, automation.merchantId),
        eq(clientProfiles.marketingOptIn, true),
        // birthday is stored as a date string; extract MM-DD portion
        sql`TO_CHAR(${clientProfiles.birthday}::date, 'MM-DD') = ${`${mm}-${dd}`}`
      )
    );

  if (rows.length === 0) return 0;

  const merchantName = merchant?.name ?? "";
  const promoCode = automation.promoCode ?? "";
  let sent = 0;

  for (const row of rows) {
    const dedupeKey = `client-${row.clientId}-year-${year}`;

    // Check if already sent
    const [existing] = await db
      .select({ id: automationSends.id })
      .from(automationSends)
      .where(
        and(
          eq(automationSends.automationId, automation.id),
          eq(automationSends.dedupeKey, dedupeKey)
        )
      )
      .limit(1);

    if (existing) continue;

    // Load client contact details
    const [client] = await db
      .select({ id: clients.id, name: clients.name, phone: clients.phone, email: clients.email })
      .from(clients)
      .where(eq(clients.id, row.clientId))
      .limit(1);

    if (!client) continue;

    const clientName = client.name ?? "there";
    const messageBody = renderTemplate(automation.messageTemplate, {
      name: clientName,
      merchantName,
      promoCode,
    });

    const { whatsappSid } = await sendAutomationMessage({
      merchantId: automation.merchantId,
      clientId: client.id,
      bookingId: null,
      automationKind: "birthday",
      messageBody,
      phone: client.phone,
      email: client.email ?? null,
      clientName,
      merchantName,
    });

    // Record send — ON CONFLICT DO NOTHING for idempotency
    const channel = whatsappSid ? "whatsapp" : "email";
    await db
      .insert(automationSends)
      .values({
        automationId: automation.id,
        merchantId: automation.merchantId,
        clientId: client.id,
        bookingId: null,
        dedupeKey,
        channel,
        sentAt: new Date(),
      })
      .onConflictDoNothing();

    sent++;
  }

  return sent;
}

/**
 * Win-back sweep: find clients whose last completed booking is >= afterDays ago,
 * and who haven't received a win-back within the cooldown window (afterDays * 1.5).
 */
export async function handleWinback(automation: typeof automations.$inferSelect): Promise<number> {
  const cfg = automation.config as { afterDays?: number };
  const afterDays = cfg.afterDays ?? 90;
  const cooldownDays = Math.round(afterDays * 1.5);

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - afterDays);

  const cooldownDate = new Date();
  cooldownDate.setDate(cooldownDate.getDate() - cooldownDays);

  // Find clients whose lastVisitDate is <= cutoffDate (overdue for a visit)
  const rows = await db
    .select({
      clientId: clientProfiles.clientId,
      lastVisitDate: clientProfiles.lastVisitDate,
    })
    .from(clientProfiles)
    .where(
      and(
        eq(clientProfiles.merchantId, automation.merchantId),
        eq(clientProfiles.marketingOptIn, true),
        // lastVisitDate <= cutoffDate
        lt(clientProfiles.lastVisitDate, cutoffDate.toISOString().slice(0, 10))
      )
    );

  if (rows.length === 0) return 0;

  const [merchant] = await db
    .select({ name: merchants.name })
    .from(merchants)
    .where(eq(merchants.id, automation.merchantId))
    .limit(1);

  const merchantName = merchant?.name ?? "";
  const promoCode = automation.promoCode ?? "";
  let sent = 0;

  // Compute the ISO week start (Monday) for cooldown deduplication
  const now = new Date();
  const dayOfWeek = now.getUTCDay(); // 0=Sun
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const weekStart = new Date(now);
  weekStart.setUTCDate(now.getUTCDate() + mondayOffset);
  const weekStartStr = weekStart.toISOString().slice(0, 10);

  for (const row of rows) {
    const dedupeKey = `client-${row.clientId}-window-${weekStartStr}`;

    // Check if already sent in this cooldown window
    const [existing] = await db
      .select({ id: automationSends.id })
      .from(automationSends)
      .where(
        and(
          eq(automationSends.automationId, automation.id),
          eq(automationSends.dedupeKey, dedupeKey)
        )
      )
      .limit(1);

    if (existing) continue;

    // Also check no send within the actual cooldown period
    const recentSends = await db
      .select({ id: automationSends.id })
      .from(automationSends)
      .where(
        and(
          eq(automationSends.automationId, automation.id),
          eq(automationSends.clientId, row.clientId),
          gte(automationSends.sentAt, cooldownDate)
        )
      )
      .limit(1);

    if (recentSends.length > 0) continue;

    const [client] = await db
      .select({ id: clients.id, name: clients.name, phone: clients.phone, email: clients.email })
      .from(clients)
      .where(eq(clients.id, row.clientId))
      .limit(1);

    if (!client) continue;

    const clientName = client.name ?? "there";
    const messageBody = renderTemplate(automation.messageTemplate, {
      name: clientName,
      merchantName,
      promoCode,
    });

    const { whatsappSid } = await sendAutomationMessage({
      merchantId: automation.merchantId,
      clientId: client.id,
      bookingId: null,
      automationKind: "winback",
      messageBody,
      phone: client.phone,
      email: client.email ?? null,
      clientName,
      merchantName,
    });

    const channel = whatsappSid ? "whatsapp" : "email";
    await db
      .insert(automationSends)
      .values({
        automationId: automation.id,
        merchantId: automation.merchantId,
        clientId: client.id,
        bookingId: null,
        dedupeKey,
        channel,
        sentAt: new Date(),
      })
      .onConflictDoNothing();

    sent++;
  }

  return sent;
}

/**
 * Re-booking sweep: find completed bookings whose endTime was exactly
 * defaultAfterDays (or per-service days) ago, and no rebook send exists yet.
 */
export async function handleRebook(automation: typeof automations.$inferSelect): Promise<number> {
  const cfg = automation.config as {
    defaultAfterDays?: number;
    perService?: Record<string, number>;
  };
  const defaultAfterDays = cfg.defaultAfterDays ?? 30;

  // Compute the window: completed bookings whose endTime was in the 24h window
  // starting exactly defaultAfterDays ago (i.e. between 00:00 and 23:59 that day)
  const targetDate = new Date();
  targetDate.setDate(targetDate.getDate() - defaultAfterDays);
  const targetDayStart = new Date(targetDate);
  targetDayStart.setUTCHours(0, 0, 0, 0);
  const targetDayEnd = new Date(targetDate);
  targetDayEnd.setUTCHours(23, 59, 59, 999);

  const rows = await db
    .select({
      bookingId: bookings.id,
      clientId: bookings.clientId,
      serviceId: bookings.serviceId,
      endTime: bookings.endTime,
    })
    .from(bookings)
    .where(
      and(
        eq(bookings.merchantId, automation.merchantId),
        eq(bookings.status, "completed"),
        gte(bookings.endTime, targetDayStart),
        lt(bookings.endTime, targetDayEnd)
      )
    );

  if (rows.length === 0) return 0;

  const [merchant] = await db
    .select({ name: merchants.name })
    .from(merchants)
    .where(eq(merchants.id, automation.merchantId))
    .limit(1);

  const merchantName = merchant?.name ?? "";
  const promoCode = automation.promoCode ?? "";
  let sent = 0;

  for (const row of rows) {
    // Per-service override if configured
    const serviceAfterDays = cfg.perService?.[row.serviceId] ?? defaultAfterDays;
    if (serviceAfterDays !== defaultAfterDays) {
      // Re-check timing for per-service overrides — skip if this booking's
      // service has a different window and today isn't the right day
      const serviceTargetDate = new Date();
      serviceTargetDate.setDate(serviceTargetDate.getDate() - serviceAfterDays);
      const serviceTargetStart = new Date(serviceTargetDate);
      serviceTargetStart.setUTCHours(0, 0, 0, 0);
      const serviceTargetEnd = new Date(serviceTargetDate);
      serviceTargetEnd.setUTCHours(23, 59, 59, 999);
      if (row.endTime < serviceTargetStart || row.endTime >= serviceTargetEnd) {
        continue;
      }
    }

    const dedupeKey = `booking-${row.bookingId}`;

    // Check if already sent for this booking
    const [existing] = await db
      .select({ id: automationSends.id })
      .from(automationSends)
      .where(
        and(
          eq(automationSends.automationId, automation.id),
          eq(automationSends.dedupeKey, dedupeKey)
        )
      )
      .limit(1);

    if (existing) continue;

    // Check client marketing opt-in
    const [profile] = await db
      .select({ marketingOptIn: clientProfiles.marketingOptIn })
      .from(clientProfiles)
      .where(
        and(
          eq(clientProfiles.merchantId, automation.merchantId),
          eq(clientProfiles.clientId, row.clientId)
        )
      )
      .limit(1);

    if (profile && !profile.marketingOptIn) continue;

    const [client] = await db
      .select({ id: clients.id, name: clients.name, phone: clients.phone, email: clients.email })
      .from(clients)
      .where(eq(clients.id, row.clientId))
      .limit(1);

    if (!client) continue;

    const clientName = client.name ?? "there";
    const messageBody = renderTemplate(automation.messageTemplate, {
      name: clientName,
      merchantName,
      promoCode,
    });

    const { whatsappSid } = await sendAutomationMessage({
      merchantId: automation.merchantId,
      clientId: client.id,
      bookingId: row.bookingId,
      automationKind: "rebook",
      messageBody,
      phone: client.phone,
      email: client.email ?? null,
      clientName,
      merchantName,
    });

    const channel = whatsappSid ? "whatsapp" : "email";
    await db
      .insert(automationSends)
      .values({
        automationId: automation.id,
        merchantId: automation.merchantId,
        clientId: client.id,
        bookingId: row.bookingId,
        dedupeKey,
        channel,
        sentAt: new Date(),
      })
      .onConflictDoNothing();

    sent++;
  }

  return sent;
}

// ─── Main sweep handler ───────────────────────────────────────────────────────

async function handleAutomationDailySweep(): Promise<void> {
  console.log("[AutomationWorker] Starting daily sweep");

  // Load all enabled automations
  const enabledAutomations = await db
    .select()
    .from(automations)
    .where(eq(automations.enabled, true));

  console.log("[AutomationWorker] Enabled automations", { count: enabledAutomations.length });

  for (const automation of enabledAutomations) {
    try {
      let sent = 0;

      switch (automation.kind as AutomationKind) {
        case "birthday":
          sent = await handleBirthday(automation);
          break;
        case "winback":
          sent = await handleWinback(automation);
          break;
        case "rebook":
          sent = await handleRebook(automation);
          break;
        default:
          console.warn("[AutomationWorker] Unknown kind", { kind: automation.kind });
          continue;
      }

      // Update lastRunAt
      await db
        .update(automations)
        .set({ lastRunAt: new Date() })
        .where(eq(automations.id, automation.id));

      console.log("[AutomationWorker] Automation processed", {
        id: automation.id,
        merchantId: automation.merchantId,
        kind: automation.kind,
        sent,
      });
    } catch (err) {
      console.error("[AutomationWorker] Failed to process automation", {
        id: automation.id,
        kind: automation.kind,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  console.log("[AutomationWorker] Daily sweep complete");
}

// ─── Worker ───────────────────────────────────────────────────────────────────

export function createAutomationWorker(): Worker {
  const worker = new Worker(
    "automations",
    async (job: Job) => {
      console.log("[AutomationWorker] Processing job", {
        id: job.id,
        name: job.name,
        data: job.data,
      });

      switch (job.name) {
        case "automation_daily_sweep":
          await handleAutomationDailySweep();
          break;
        default:
          console.warn("[AutomationWorker] Unknown job name", { name: job.name });
      }
    },
    {
      connection: {
        url: config.redisUrl,
        retryStrategy: (times: number) => Math.min(times * 2000, 30000),
      },
      prefix: config.queuePrefix,
      concurrency: 1, // single-threaded: daily sweep is not parallelisable
    }
  );

  worker.on("completed", (job: Job) => {
    console.log("[AutomationWorker] Job completed", { id: job.id, name: job.name });
  });

  worker.on("failed", (job: Job | undefined, err: Error) => {
    console.error("[AutomationWorker] Job failed", {
      id: job?.id,
      name: job?.name,
      error: err.message,
    });
  });

  worker.on("error", (err: Error) => {
    console.error("[AutomationWorker] Worker error (Redis connection issue?)", err.message);
  });

  return worker;
}
