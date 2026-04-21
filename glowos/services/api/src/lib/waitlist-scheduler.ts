import { addJob } from "./queue.js";

export interface WaitlistMatchJobPayload {
  merchant_id: string;
  staff_id: string;
  service_id: string;
  freed_start: string; // ISO
  freed_end: string;   // ISO
  notified_booking_slot_id: string;
}

export async function scheduleWaitlistMatchJob(
  payload: WaitlistMatchJobPayload
): Promise<void> {
  await addJob("notifications", "waitlist_match", payload as unknown as Record<string, unknown>);
}

export async function scheduleWaitlistHoldExpire(
  waitlistId: string,
  delayMs: number
): Promise<void> {
  await addJob("notifications", "waitlist_hold_expire", { waitlist_id: waitlistId }, { delay: delayMs });
}
