import { addJob } from "./queue.js";
import { config } from "./config.js";

// ─── scheduleReminder ──────────────────────────────────────────────────────────

/**
 * Queue an appointment reminder 24 hours before the booking start time.
 * If the booking is less than 24 hours away the reminder is skipped — it
 * would arrive after (or too close to) the appointment.
 */
export async function scheduleReminder(
  bookingId: string,
  bookingStartTime: Date
): Promise<void> {
  const now = Date.now();
  const reminderAt = bookingStartTime.getTime() - 24 * 60 * 60 * 1000; // start - 24h
  const delay = reminderAt - now;

  if (delay <= 0) {
    console.log("[Scheduler] Reminder skipped — booking is less than 24h away", {
      bookingId,
    });
    return;
  }

  await addJob("notifications", "appointment_reminder", { booking_id: bookingId }, { delay });
  console.log("[Scheduler] Reminder scheduled", {
    bookingId,
    delayMs: delay,
    sendAt: new Date(reminderAt).toISOString(),
  });
}

// ─── scheduleReviewRequest ─────────────────────────────────────────────────────

/**
 * Queue a review request 30 minutes after completion.
 */
export async function scheduleReviewRequest(bookingId: string): Promise<void> {
  const delay = 30 * 60 * 1000; // 30 minutes
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
