import { Queue } from "bullmq";
import type { JobsOptions } from "bullmq";
import { config } from "./config.js";

// ─── Redis connection options for BullMQ ──────────────────────────────────────

// BullMQ accepts an ioredis-compatible connection object or a URL string.
// We pass the URL directly so it creates its own managed connection (separate
// from the shared ioredis client used for caching).
const connection = { url: config.redisUrl };

// Prefix isolates dev/prod queues within one Redis instance. Workers only see
// jobs that were enqueued with the matching prefix. See config.ts for why.
export const QUEUE_PREFIX = config.queuePrefix;

// ─── Named queues ──────────────────────────────────────────────────────────────

export const notificationQueue = new Queue("notifications", { connection, prefix: QUEUE_PREFIX });

export const crmQueue = new Queue("crm", { connection, prefix: QUEUE_PREFIX });

export const vipQueue = new Queue("vip", { connection, prefix: QUEUE_PREFIX });

export const churnQueue = new Queue("churn", { connection, prefix: QUEUE_PREFIX });

// ─── Queue registry for addJob ─────────────────────────────────────────────────

const queues: Record<string, Queue> = {
  notifications: notificationQueue,
  crm: crmQueue,
  vip: vipQueue,
  churn: churnQueue,
};

// ─── Default retry options ─────────────────────────────────────────────────────

const defaultJobOptions: JobsOptions = {
  attempts: 3,
  backoff: {
    type: "exponential",
    delay: 5000,
  },
};

// ─── addJob helper ─────────────────────────────────────────────────────────────

/**
 * Add a job to a named queue with default retry options.
 * Extra options (e.g. delay) are merged on top of the defaults.
 */
export async function addJob(
  queueName: string,
  jobName: string,
  data: Record<string, unknown>,
  options?: JobsOptions
): Promise<void> {
  const queue = queues[queueName];
  if (!queue) {
    console.error("[Queue] Unknown queue name", { queueName });
    return;
  }

  try {
    await queue.add(jobName, data, { ...defaultJobOptions, ...options });
    console.log("[Queue] Job added", { queue: queueName, job: jobName, data });
  } catch (err) {
    console.error("[Queue] Failed to add job", {
      queue: queueName,
      job: jobName,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
