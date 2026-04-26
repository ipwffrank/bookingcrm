import type { Worker } from "bullmq";
import { createNotificationWorker } from "./notification.worker.js";
import { createCrmWorker } from "./crm.worker.js";
import { createVipWorker } from "./vip.worker.js";
import { createAutomationWorker } from "./automation.worker.js";
import { addJob } from "../lib/queue.js";
import { sweepExpiredQuotes } from "../routes/quotes.js";

// ─── Worker registry ───────────────────────────────────────────────────────────

let workers: Worker[] = [];

// ─── startWorkers ──────────────────────────────────────────────────────────────

/**
 * Initialise and start all BullMQ workers.
 * Safe to call multiple times — subsequent calls are no-ops if workers are
 * already running.
 */
export function startWorkers(): void {
  if (workers.length > 0) {
    console.log("[Workers] Already running, skipping re-initialisation");
    return;
  }

  console.log("[Workers] Starting all workers...");

  workers = [
    createNotificationWorker(),
    createCrmWorker(),
    createVipWorker(),
    createAutomationWorker(),
  ];

  console.log("[Workers] All workers started", { count: workers.length });

  // Register repeating cron jobs. Fire-and-forget — queue registration is idempotent
  // (BullMQ de-dupes repeating jobs by jobId + pattern).
  void addJob(
    "notifications",
    "waitlist_expire_stale",
    {},
    { repeat: { pattern: "5 0 * * *" } } // 00:05 daily, server time
  );

  // Marketing automation daily sweep: birthday / win-back / re-booking.
  void addJob(
    "automations",
    "automation_daily_sweep",
    {},
    { repeat: { pattern: "5 1 * * *" } } // 01:05 UTC daily
  );

  // Treatment-quote daily cron: expire past-validUntil pending quotes, then
  // nudge quotes that expire within 3 days. Uses a wrapper job so the worker
  // owns the work (keeps logs in one place).
  void addJob(
    "notifications",
    "treatment_quote_reminder_sweep",
    {},
    { repeat: { pattern: "10 0 * * *" } } // 00:10 daily, server time
  );

  // Expired-quote sweeper runs directly in the API process (not a queue job) —
  // it's a single UPDATE + idempotent, no need to round-trip through the worker.
  setInterval(async () => {
    try {
      const n = await sweepExpiredQuotes();
      if (n > 0) console.log("[QuoteExpirySweep] expired", { count: n });
    } catch (err) {
      console.error("[QuoteExpirySweep] failed", err);
    }
  }, 60 * 60 * 1000); // hourly
}

// ─── stopWorkers ───────────────────────────────────────────────────────────────

/**
 * Gracefully close all running workers.
 * Waits for in-flight jobs to finish before resolving.
 */
export async function stopWorkers(): Promise<void> {
  if (workers.length === 0) return;

  console.log("[Workers] Stopping all workers...");
  await Promise.all(workers.map((w) => w.close()));
  workers = [];
  console.log("[Workers] All workers stopped");
}
