import { Worker } from "bullmq";
import type { Job } from "bullmq";
import { eq, and } from "drizzle-orm";
import { differenceInDays } from "date-fns";
import { db, bookings, clientProfiles } from "@glowos/db";
import { config } from "../lib/config.js";

// ─── Types ─────────────────────────────────────────────────────────────────────

interface RescoreClientData {
  merchant_id: string;
  client_id: string;
}

// ─── VIP tier thresholds ───────────────────────────────────────────────────────

const VIP_THRESHOLDS = {
  PLATINUM: 4.2,
  GOLD: 3.5,
  SILVER: 2.5,
} as const;

type VipTier = "platinum" | "gold" | "silver" | "bronze";

function assignTier(score: number): VipTier {
  if (score >= VIP_THRESHOLDS.PLATINUM) return "platinum";
  if (score >= VIP_THRESHOLDS.GOLD) return "gold";
  if (score >= VIP_THRESHOLDS.SILVER) return "silver";
  return "bronze";
}

// ─── Normalisation helper ──────────────────────────────────────────────────────

/**
 * Normalise a raw value to a 1-5 scale relative to the min/max across all peers.
 * If all peers have the same value (min === max), return the midpoint (3).
 * For recency, a lower value is better so we invert the scale.
 */
function normalise(
  value: number,
  min: number,
  max: number,
  invert = false
): number {
  if (max === min) return 3;
  const raw = ((value - min) / (max - min)) * 4 + 1; // maps to 1-5
  return invert ? 6 - raw : raw;
}

// ─── Job handlers ──────────────────────────────────────────────────────────────

async function handleRescoreClient(merchantId: string, clientId: string): Promise<void> {
  // Load completed + paid bookings for this client at this merchant
  const clientBookings = await db
    .select({
      startTime: bookings.startTime,
      priceSgd: bookings.priceSgd,
    })
    .from(bookings)
    .where(
      and(
        eq(bookings.merchantId, merchantId),
        eq(bookings.clientId, clientId),
        eq(bookings.status, "completed")
      )
    );

  if (clientBookings.length === 0) {
    console.log("[VipWorker] rescore_client: no completed bookings, skipping", {
      merchantId,
      clientId,
    });
    return;
  }

  const now = new Date();
  const sortedBookings = [...clientBookings].sort(
    (a, b) => a.startTime.getTime() - b.startTime.getTime()
  );
  const lastVisit = sortedBookings[sortedBookings.length - 1]!.startTime;

  const rawRecency = differenceInDays(now, lastVisit); // lower = better
  const rawFrequency = clientBookings.length;
  const rawMonetary = clientBookings.reduce(
    (sum, b) => sum + parseFloat(String(b.priceSgd ?? "0")),
    0
  );

  // Load all client profiles for this merchant to get peer stats for normalisation
  const allProfiles = await db
    .select({
      clientId: clientProfiles.clientId,
      rfmRecency: clientProfiles.rfmRecency,
      rfmFrequency: clientProfiles.rfmFrequency,
      rfmMonetary: clientProfiles.rfmMonetary,
    })
    .from(clientProfiles)
    .where(eq(clientProfiles.merchantId, merchantId));

  // Collect peer values — include the current client's raw values too so
  // normalisation covers the full distribution even if the profile hasn't been
  // persisted yet from the CRM worker.
  const peerRecencies = allProfiles
    .map((p) => p.rfmRecency ?? rawRecency)
    .concat([rawRecency]);
  const peerFrequencies = allProfiles
    .map((p) => p.rfmFrequency ?? rawFrequency)
    .concat([rawFrequency]);
  const peerMonetaries = allProfiles
    .map((p) => parseFloat(String(p.rfmMonetary ?? rawMonetary)))
    .concat([rawMonetary]);

  const recencyMin = Math.min(...peerRecencies);
  const recencyMax = Math.max(...peerRecencies);
  const frequencyMin = Math.min(...peerFrequencies);
  const frequencyMax = Math.max(...peerFrequencies);
  const monetaryMin = Math.min(...peerMonetaries);
  const monetaryMax = Math.max(...peerMonetaries);

  // Normalise to 1-5; recency is inverted (fewer days since last visit = higher score)
  const rScore = normalise(rawRecency, recencyMin, recencyMax, true);
  const fScore = normalise(rawFrequency, frequencyMin, frequencyMax);
  const mScore = normalise(rawMonetary, monetaryMin, monetaryMax);

  // Weighted VIP score: R*0.3 + F*0.35 + M*0.35
  const vipScore = rScore * 0.3 + fScore * 0.35 + mScore * 0.35;
  const vipTier = assignTier(vipScore);

  // Find existing profile and update
  const [existing] = await db
    .select({ id: clientProfiles.id })
    .from(clientProfiles)
    .where(
      and(
        eq(clientProfiles.merchantId, merchantId),
        eq(clientProfiles.clientId, clientId)
      )
    )
    .limit(1);

  const profileValues = {
    vipTier,
    vipScore: vipScore.toFixed(2),
    rfmRecency: rawRecency,
    rfmFrequency: rawFrequency,
    rfmMonetary: rawMonetary.toFixed(2),
    updatedAt: new Date(),
  };

  if (existing) {
    await db
      .update(clientProfiles)
      .set(profileValues)
      .where(eq(clientProfiles.id, existing.id));
  } else {
    await db.insert(clientProfiles).values({
      merchantId,
      clientId,
      ...profileValues,
    });
  }

  console.log("[VipWorker] rescore_client handled", {
    merchantId,
    clientId,
    rawRecency,
    rawFrequency,
    rawMonetary,
    rScore: rScore.toFixed(2),
    fScore: fScore.toFixed(2),
    mScore: mScore.toFixed(2),
    vipScore: vipScore.toFixed(2),
    vipTier,
  });
}

// ─── Worker ────────────────────────────────────────────────────────────────────

export function createVipWorker(): Worker {
  const worker = new Worker(
    "vip",
    async (job: Job) => {
      console.log("[VipWorker] Processing job", {
        id: job.id,
        name: job.name,
        data: job.data,
      });

      switch (job.name) {
        case "rescore_client": {
          const data = job.data as RescoreClientData;
          await handleRescoreClient(data.merchant_id, data.client_id);
          break;
        }
        default:
          console.warn("[VipWorker] Unknown job name", { name: job.name });
      }
    },
    {
      connection: {
        url: config.redisUrl,
        retryStrategy: (times: number) => Math.min(times * 2000, 30000),
      },
      concurrency: 3,
    }
  );

  worker.on("completed", (job: Job) => {
    console.log("[VipWorker] Job completed", { id: job.id, name: job.name });
  });

  worker.on("failed", (job: Job | undefined, err: Error) => {
    console.error("[VipWorker] Job failed", {
      id: job?.id,
      name: job?.name,
      error: err.message,
    });
  });

  worker.on("error", (err: Error) => {
    console.error("[VipWorker] Worker error (Redis connection issue?)", err.message);
  });

  return worker;
}
