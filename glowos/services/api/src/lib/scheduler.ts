import { addJob } from "./queue.js";
import { config } from "./config.js";

// ─── scheduleReminder ──────────────────────────────────────────────────────────

/**
 * Schedule the full confirmation-reminder cascade for a booking:
 *   T−24h  appointment_reminder              — primary confirm prompt
 *   T−12h  appointment_reminder_followup_12h — second nudge if still pending
 *   T−2h   appointment_reminder_final_2h     — last call if still pending
 *
 * Each handler short-circuits if the booking is no longer pending (i.e. the
 * customer has already confirmed) so the followups are silent for confirmed
 * bookings. Walk-ins land as 'confirmed' from the start, so they never fire
 * the followups regardless.
 *
 * Reminders whose send-time has already passed at scheduling time are
 * silently skipped — useful for last-minute bookings ("walk-in scheduled
 * for an hour from now").
 */
export async function scheduleReminder(
  bookingId: string,
  bookingStartTime: Date
): Promise<void> {
  const now = Date.now();
  const start = bookingStartTime.getTime();

  const tiers: Array<{ jobName: string; offsetMs: number; label: string }> = [
    { jobName: "appointment_reminder",              offsetMs: 24 * 60 * 60 * 1000, label: "T-24h" },
    { jobName: "appointment_reminder_followup_12h", offsetMs: 12 * 60 * 60 * 1000, label: "T-12h" },
    { jobName: "appointment_reminder_final_2h",     offsetMs:  2 * 60 * 60 * 1000, label: "T-2h"  },
  ];

  for (const tier of tiers) {
    const sendAt = start - tier.offsetMs;
    const delay = sendAt - now;
    if (delay <= 0) {
      console.log(`[Scheduler] ${tier.label} reminder skipped — already past send time`, {
        bookingId,
      });
      continue;
    }
    await addJob("notifications", tier.jobName, { booking_id: bookingId }, { delay });
    console.log(`[Scheduler] ${tier.label} reminder scheduled`, {
      bookingId,
      jobName: tier.jobName,
      sendAt: new Date(sendAt).toISOString(),
    });
  }
}

// ─── scheduleReviewRequest ─────────────────────────────────────────────────────

/**
 * Queue a review request 24 hours after completion.
 */
export async function scheduleReviewRequest(bookingId: string): Promise<void> {
  const delay = 24 * 60 * 60 * 1000; // 24 hours
  await addJob("notifications", "review_request", { booking_id: bookingId }, { delay });
  console.log("[Scheduler] Review request scheduled", { bookingId, delayMs: delay });
}

// ─── scheduleNoShowReengagement ────────────────────────────────────────────────

/**
 * Queue a no-show re-engagement message 24 hours after the no-show is recorded.
 */
export async function scheduleNoShowReengagement(bookingId: string): Promise<void> {
  const delay = 24 * 60 * 60 * 1000; // 24 hours
  await addJob(
    "notifications",
    "no_show_reengagement",
    { booking_id: bookingId },
    { delay }
  );
  console.log("[Scheduler] No-show re-engagement scheduled", { bookingId, delayMs: delay });
}

// ─── scheduleRebookingPrompt ───────────────────────────────────────────────────

/**
 * Queue a rebooking prompt 30 minutes after cancellation.
 */
export async function scheduleRebookingPrompt(bookingId: string): Promise<void> {
  const delay = 30 * 60 * 1000; // 30 minutes
  const bookingUrl = config.frontendUrl;
  await addJob(
    "notifications",
    "rebooking_prompt",
    { booking_id: bookingId, booking_url: bookingUrl },
    { delay }
  );
  console.log("[Scheduler] Rebooking prompt scheduled", { bookingId, delayMs: delay });
}

// ─── schedulePostServiceSequence ───────────────────────────────────────────────

/**
 * Queue the post-service receipt immediately, and the rebook CTA after 48 hours.
 */
export async function schedulePostServiceSequence(bookingId: string): Promise<void> {
  // Receipt: send immediately (1 second delay to let the DB commit settle)
  await addJob(
    "notifications",
    "post_service_receipt",
    { booking_id: bookingId },
    { delay: 1000 }
  );

  // Rebook CTA: send 48 hours later
  const rebookDelay = 48 * 60 * 60 * 1000;
  await addJob(
    "notifications",
    "post_service_rebook",
    { booking_id: bookingId },
    { delay: rebookDelay }
  );

  console.log("[Scheduler] Post-service sequence scheduled", {
    bookingId,
    rebookCTAAt: new Date(Date.now() + rebookDelay).toISOString(),
  });
}
