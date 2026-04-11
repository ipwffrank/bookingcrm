import { Worker } from "bullmq";
import type { Job } from "bullmq";
import { eq, and } from "drizzle-orm";
import { differenceInDays, parseISO } from "date-fns";
import { db, bookings, clients, clientProfiles } from "@glowos/db";
import { config } from "../lib/config.js";

// ─── Types ─────────────────────────────────────────────────────────────────────

interface UpdateClientProfileData {
  booking_id: string;
}

// ─── Job handlers ──────────────────────────────────────────────────────────────

async function handleUpdateClientProfile(bookingId: string): Promise<void> {
  // Load the triggering booking
  const [row] = await db
    .select({
      booking: bookings,
      client: clients,
    })
    .from(bookings)
    .innerJoin(clients, eq(bookings.clientId, clients.id))
    .where(eq(bookings.id, bookingId))
    .limit(1);

  if (!row) {
    console.warn("[CrmWorker] update_client_profile: booking not found", { bookingId });
    return;
  }

  const { booking, client } = row;
  const merchantId = booking.merchantId;
  const clientId = client.id;

  // Load all completed bookings for this merchant+client to compute RFM
  const completedBookings = await db
    .select({
      id: bookings.id,
      startTime: bookings.startTime,
      priceSgd: bookings.priceSgd,
      status: bookings.status,
      paymentStatus: bookings.paymentStatus,
    })
    .from(bookings)
    .where(
      and(
        eq(bookings.merchantId, merchantId),
        eq(bookings.clientId, clientId),
        eq(bookings.status, "completed")
      )
    );

  const now = new Date();
  const frequency = completedBookings.length;

  const monetary = completedBookings.reduce((sum, b) => {
    return sum + parseFloat(String(b.priceSgd ?? "0"));
  }, 0);

  // Sort by startTime ascending for cadence calculation
  const sortedBookings = [...completedBookings].sort(
    (a, b) => a.startTime.getTime() - b.startTime.getTime()
  );

  const lastVisit =
    sortedBookings.length > 0
      ? sortedBookings[sortedBookings.length - 1]!.startTime
      : booking.startTime;

  const recency = differenceInDays(now, lastVisit);

  // Compute average visit cadence
  let avgCadence: number | null = null;
  if (sortedBookings.length >= 2) {
    let totalGap = 0;
    for (let i = 1; i < sortedBookings.length; i++) {
      const prev = sortedBookings[i - 1]!;
      const curr = sortedBookings[i]!;
      totalGap += differenceInDays(curr.startTime, prev.startTime);
    }
    avgCadence = totalGap / (sortedBookings.length - 1);
  }

  // Predict next visit
  let nextPredictedVisit: string | null = null;
  if (avgCadence !== null && avgCadence > 0) {
    const nextDate = new Date(lastVisit.getTime() + avgCadence * 24 * 60 * 60 * 1000);
    nextPredictedVisit = nextDate.toISOString().slice(0, 10); // YYYY-MM-DD
  }

  const lastVisitDateStr = lastVisit.toISOString().slice(0, 10);

  // Find or create the client profile
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
    lastVisitDate: lastVisitDateStr,
    rfmFrequency: frequency,
    rfmMonetary: monetary.toFixed(2),
    rfmRecency: recency,
    avgVisitCadenceDays: avgCadence !== null ? avgCadence.toFixed(2) : undefined,
    nextPredictedVisit: nextPredictedVisit ?? undefined,
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

  console.log("[CrmWorker] update_client_profile handled", {
    bookingId,
    merchantId,
    clientId,
    frequency,
    monetary,
    recency,
    avgCadence,
  });
}

// ─── Worker ────────────────────────────────────────────────────────────────────

export function createCrmWorker(): Worker {
  const worker = new Worker(
    "crm",
    async (job: Job) => {
      console.log("[CrmWorker] Processing job", {
        id: job.id,
        name: job.name,
        data: job.data,
      });

      switch (job.name) {
        case "update_client_profile": {
          const data = job.data as UpdateClientProfileData;
          await handleUpdateClientProfile(data.booking_id);
          break;
        }
        default:
          console.warn("[CrmWorker] Unknown job name", { name: job.name });
      }
    },
    {
      connection: { url: config.redisUrl },
      concurrency: 3,
    }
  );

  worker.on("completed", (job: Job) => {
    console.log("[CrmWorker] Job completed", { id: job.id, name: job.name });
  });

  worker.on("failed", (job: Job | undefined, err: Error) => {
    console.error("[CrmWorker] Job failed", {
      id: job?.id,
      name: job?.name,
      error: err.message,
    });
  });

  worker.on("error", (err: Error) => {
    console.error("[CrmWorker] Worker error (Redis connection issue?)", err.message);
  });

  return worker;
}
