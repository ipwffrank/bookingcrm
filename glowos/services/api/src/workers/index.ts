import type { Worker } from "bullmq";
import { createNotificationWorker } from "./notification.worker.js";
import { createCrmWorker } from "./crm.worker.js";
import { createVipWorker } from "./vip.worker.js";
import { addJob } from "../lib/queue.js";

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
