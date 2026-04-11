import { Worker } from "bullmq";
import type { Job } from "bullmq";
import { eq, and } from "drizzle-orm";
import { format } from "date-fns";
import {
  db,
  bookings,
  merchants,
  services,
  staff,
  clients,
  notificationLog,
} from "@glowos/db";
import { sendWhatsApp } from "../lib/twilio.js";
import { config } from "../lib/config.js";

// ─── Types ─────────────────────────────────────────────────────────────────────

interface BookingConfirmationData {
  booking_id: string;
}

interface AppointmentReminderData {
  booking_id: string;
}

interface CancellationNotificationData {
  booking_id: string;
}

interface RefundConfirmationData {
  booking_id: string;
}

interface ReviewRequestData {
  booking_id: string;
}

interface NoShowReengagementData {
  booking_id: string;
}

interface RebookingPromptData {
  booking_id: string;
  booking_url?: string;
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Load a booking with all related data needed for notifications.
 */
async function loadBookingWithDetails(bookingId: string) {
  const [row] = await db
    .select({
      booking: bookings,
      merchant: merchants,
      service: services,
      staffMember: staff,
      client: clients,
    })
    .from(bookings)
    .innerJoin(merchants, eq(bookings.merchantId, merchants.id))
    .innerJoin(services, eq(bookings.serviceId, services.id))
    .innerJoin(staff, eq(bookings.staffId, staff.id))
    .innerJoin(clients, eq(bookings.clientId, clients.id))
    .where(eq(bookings.id, bookingId))
    .limit(1);

  return row ?? null;
}

/**
 * Log a notification to the notification_log table.
 */
async function logNotification(params: {
  merchantId: string;
  clientId: string | null;
  bookingId: string;
  type: string;
  channel: string;
  recipient: string;
  messageBody: string;
  status: string;
  twilioSid?: string;
}): Promise<void> {
  try {
    await db.insert(notificationLog).values({
      merchantId: params.merchantId,
      clientId: params.clientId ?? undefined,
      bookingId: params.bookingId,
      type: params.type,
      channel: params.channel,
      recipient: params.recipient,
      messageBody: params.messageBody,
      status: params.status,
      twilioSid: params.twilioSid,
    });
  } catch (err) {
    console.error("[NotificationWorker] Failed to log notification", {
      type: params.type,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Format a booking date for display.
 */
function formatDate(date: Date): string {
  return format(date, "d MMM yyyy");
}

/**
 * Format a booking time for display.
 */
function formatTime(date: Date): string {
  return format(date, "h:mm a");
}

// ─── Job handlers ──────────────────────────────────────────────────────────────

async function handleBookingConfirmation(bookingId: string): Promise<void> {
  const row = await loadBookingWithDetails(bookingId);
  if (!row) {
    console.warn("[NotificationWorker] booking_confirmation: booking not found", { bookingId });
    return;
  }

  const { booking, merchant, service, staffMember, client } = row;

  if (!client.phone) {
    console.warn("[NotificationWorker] booking_confirmation: client has no phone", { bookingId });
    return;
  }

  const bookingToken = Buffer.from(JSON.stringify({ bookingId: booking.id })).toString("base64url");
  const cancelUrl = `${config.frontendUrl}/cancel/${bookingToken}`;
  const dateStr = formatDate(booking.startTime);
  const timeStr = formatTime(booking.startTime);
  const price = parseFloat(String(booking.priceSgd)).toFixed(2);

  // Client confirmation
  const clientMessage = [
    `Hi ${client.name ?? "there"}! Your booking at ${merchant.name} is confirmed.`,
    `📅 ${dateStr} at ${timeStr}`,
    `✂️ ${service.name} with ${staffMember.name}`,
    `💳 SGD ${price} paid`,
    `Need to cancel? → ${cancelUrl}`,
  ].join("\n");

  const clientSid = await sendWhatsApp(client.phone, clientMessage);

  await logNotification({
    merchantId: merchant.id,
    clientId: client.id,
    bookingId: booking.id,
    type: "booking_confirmation",
    channel: "whatsapp",
    recipient: client.phone,
    messageBody: clientMessage,
    status: clientSid ? "sent" : "failed",
    twilioSid: clientSid || undefined,
  });

  // Merchant alert
  if (merchant.phone) {
    const source = booking.bookingSource ?? "direct_widget";
    const merchantMessage = [
      `New booking! ${client.name ?? client.phone} — ${service.name}`,
      `📅 ${dateStr} at ${timeStr}`,
      `💳 SGD ${price} (${source})`,
    ].join("\n");

    const merchantSid = await sendWhatsApp(merchant.phone, merchantMessage);

    await logNotification({
      merchantId: merchant.id,
      clientId: null,
      bookingId: booking.id,
      type: "booking_confirmation_merchant",
      channel: "whatsapp",
      recipient: merchant.phone,
      messageBody: merchantMessage,
      status: merchantSid ? "sent" : "failed",
      twilioSid: merchantSid || undefined,
    });
  }

  console.log("[NotificationWorker] booking_confirmation handled", { bookingId });
}

async function handleAppointmentReminder(bookingId: string): Promise<void> {
  const row = await loadBookingWithDetails(bookingId);
  if (!row) {
    console.warn("[NotificationWorker] appointment_reminder: booking not found", { bookingId });
    return;
  }

  const { booking, merchant, service, staffMember, client } = row;

  // Skip cancelled bookings
  if (booking.status === "cancelled") {
    console.log("[NotificationWorker] appointment_reminder: booking cancelled, skipping", {
      bookingId,
    });
    return;
  }

  if (!client.phone) {
    console.warn("[NotificationWorker] appointment_reminder: client has no phone", { bookingId });
    return;
  }

  const dateStr = formatDate(booking.startTime);
  const timeStr = formatTime(booking.startTime);

  const message = [
    `Reminder: You have an appointment tomorrow at ${merchant.name}`,
    `📅 ${dateStr} at ${timeStr}`,
    `✂️ ${service.name} with ${staffMember.name}`,
    `See you there! 😊`,
  ].join("\n");

  const sid = await sendWhatsApp(client.phone, message);

  await logNotification({
    merchantId: merchant.id,
    clientId: client.id,
    bookingId: booking.id,
    type: "appointment_reminder",
    channel: "whatsapp",
    recipient: client.phone,
    messageBody: message,
    status: sid ? "sent" : "failed",
    twilioSid: sid || undefined,
  });

  console.log("[NotificationWorker] appointment_reminder handled", { bookingId });
}

async function handleCancellationNotification(bookingId: string): Promise<void> {
  const row = await loadBookingWithDetails(bookingId);
  if (!row) {
    console.warn("[NotificationWorker] cancellation_notification: booking not found", {
      bookingId,
    });
    return;
  }

  const { booking, merchant, service, staffMember, client } = row;

  const dateStr = formatDate(booking.startTime);
  const timeStr = formatTime(booking.startTime);
  const refundAmount = parseFloat(String(booking.refundAmountSgd ?? "0"));

  let refundMessage: string;
  if (refundAmount > 0) {
    refundMessage = `A refund of SGD ${refundAmount.toFixed(2)} will be processed within 5-10 business days.`;
  } else {
    refundMessage = `No refund applies per our cancellation policy.`;
  }

  // Client notification
  if (client.phone) {
    const clientMessage = [
      `Your booking at ${merchant.name} has been cancelled.`,
      refundMessage,
    ].join("\n");

    const clientSid = await sendWhatsApp(client.phone, clientMessage);

    await logNotification({
      merchantId: merchant.id,
      clientId: client.id,
      bookingId: booking.id,
      type: "cancellation_notification",
      channel: "whatsapp",
      recipient: client.phone,
      messageBody: clientMessage,
      status: clientSid ? "sent" : "failed",
      twilioSid: clientSid || undefined,
    });
  }

  // Merchant notification
  if (merchant.phone) {
    const merchantMessage = [
      `Booking cancelled: ${client.name ?? client.phone} (${dateStr} at ${timeStr})`,
      `Slot is now available.`,
    ].join("\n");

    const merchantSid = await sendWhatsApp(merchant.phone, merchantMessage);

    await logNotification({
      merchantId: merchant.id,
      clientId: null,
      bookingId: booking.id,
      type: "cancellation_notification_merchant",
      channel: "whatsapp",
      recipient: merchant.phone,
      messageBody: merchantMessage,
      status: merchantSid ? "sent" : "failed",
      twilioSid: merchantSid || undefined,
    });
  }

  console.log("[NotificationWorker] cancellation_notification handled", { bookingId });
}

async function handleRefundConfirmation(bookingId: string): Promise<void> {
  const row = await loadBookingWithDetails(bookingId);
  if (!row) {
    console.warn("[NotificationWorker] refund_confirmation: booking not found", { bookingId });
    return;
  }

  const { booking, merchant, client } = row;

  if (!client.phone) {
    console.warn("[NotificationWorker] refund_confirmation: client has no phone", { bookingId });
    return;
  }

  const refundAmount = parseFloat(String(booking.refundAmountSgd ?? "0")).toFixed(2);

  const message = [
    `Refund processed: SGD ${refundAmount} for your booking at ${merchant.name}.`,
    `Expect it in 5-10 business days.`,
  ].join("\n");

  const sid = await sendWhatsApp(client.phone, message);

  await logNotification({
    merchantId: merchant.id,
    clientId: client.id,
    bookingId: booking.id,
    type: "refund_confirmation",
    channel: "whatsapp",
    recipient: client.phone,
    messageBody: message,
    status: sid ? "sent" : "failed",
    twilioSid: sid || undefined,
  });

  console.log("[NotificationWorker] refund_confirmation handled", { bookingId });
}

async function handleReviewRequest(bookingId: string): Promise<void> {
  const row = await loadBookingWithDetails(bookingId);
  if (!row) {
    console.warn("[NotificationWorker] review_request: booking not found", { bookingId });
    return;
  }

  const { booking, merchant, service, client } = row;

  if (booking.status !== "completed") {
    console.log("[NotificationWorker] review_request: booking not completed, skipping", {
      bookingId,
      status: booking.status,
    });
    return;
  }

  if (!client.phone) {
    console.warn("[NotificationWorker] review_request: client has no phone", { bookingId });
    return;
  }

  const reviewUrl = `${config.frontendUrl}/review/${booking.id}`;

  const message = [
    `Thanks for visiting ${merchant.name}!`,
    `How was your ${service.name}?`,
    `We'd love your feedback: ${reviewUrl}`,
  ].join("\n");

  const sid = await sendWhatsApp(client.phone, message);

  await logNotification({
    merchantId: merchant.id,
    clientId: client.id,
    bookingId: booking.id,
    type: "review_request",
    channel: "whatsapp",
    recipient: client.phone,
    messageBody: message,
    status: sid ? "sent" : "failed",
    twilioSid: sid || undefined,
  });

  console.log("[NotificationWorker] review_request handled", { bookingId });
}

async function handleNoShowReengagement(bookingId: string): Promise<void> {
  const row = await loadBookingWithDetails(bookingId);
  if (!row) {
    console.warn("[NotificationWorker] no_show_reengagement: booking not found", { bookingId });
    return;
  }

  const { booking, merchant, client } = row;

  if (!client.phone) {
    console.warn("[NotificationWorker] no_show_reengagement: client has no phone", { bookingId });
    return;
  }

  const bookingUrl = `${config.frontendUrl}/${merchant.slug}`;

  const message = [
    `We missed you at ${merchant.name} today!`,
    `No worries — want to rebook?`,
    `→ ${bookingUrl}`,
  ].join("\n");

  const sid = await sendWhatsApp(client.phone, message);

  await logNotification({
    merchantId: merchant.id,
    clientId: client.id,
    bookingId: booking.id,
    type: "no_show_reengagement",
    channel: "whatsapp",
    recipient: client.phone,
    messageBody: message,
    status: sid ? "sent" : "failed",
    twilioSid: sid || undefined,
  });

  console.log("[NotificationWorker] no_show_reengagement handled", { bookingId });
}

async function handleRebookingPrompt(
  bookingId: string,
  bookingUrl?: string
): Promise<void> {
  const row = await loadBookingWithDetails(bookingId);
  if (!row) {
    console.warn("[NotificationWorker] rebooking_prompt: booking not found", { bookingId });
    return;
  }

  const { booking, merchant, client } = row;

  if (!client.phone) {
    console.warn("[NotificationWorker] rebooking_prompt: client has no phone", { bookingId });
    return;
  }

  const url = bookingUrl ?? `${config.frontendUrl}/${merchant.slug}`;

  const message = `Want to rebook at a different time? → ${url}`;

  const sid = await sendWhatsApp(client.phone, message);

  await logNotification({
    merchantId: merchant.id,
    clientId: client.id,
    bookingId: booking.id,
    type: "rebooking_prompt",
    channel: "whatsapp",
    recipient: client.phone,
    messageBody: message,
    status: sid ? "sent" : "failed",
    twilioSid: sid || undefined,
  });

  console.log("[NotificationWorker] rebooking_prompt handled", { bookingId });
}

// ─── Worker ────────────────────────────────────────────────────────────────────

export function createNotificationWorker(): Worker {
  const worker = new Worker(
    "notifications",
    async (job: Job) => {
      console.log("[NotificationWorker] Processing job", {
        id: job.id,
        name: job.name,
        data: job.data,
      });

      switch (job.name) {
        case "booking_confirmation": {
          const data = job.data as BookingConfirmationData;
          await handleBookingConfirmation(data.booking_id);
          break;
        }
        case "appointment_reminder": {
          const data = job.data as AppointmentReminderData;
          await handleAppointmentReminder(data.booking_id);
          break;
        }
        case "cancellation_notification": {
          const data = job.data as CancellationNotificationData;
          await handleCancellationNotification(data.booking_id);
          break;
        }
        case "refund_confirmation": {
          const data = job.data as RefundConfirmationData;
          await handleRefundConfirmation(data.booking_id);
          break;
        }
        case "review_request": {
          const data = job.data as ReviewRequestData;
          await handleReviewRequest(data.booking_id);
          break;
        }
        case "no_show_reengagement": {
          const data = job.data as NoShowReengagementData;
          await handleNoShowReengagement(data.booking_id);
          break;
        }
        case "rebooking_prompt": {
          const data = job.data as RebookingPromptData;
          await handleRebookingPrompt(data.booking_id, data.booking_url);
          break;
        }
        default:
          console.warn("[NotificationWorker] Unknown job name", { name: job.name });
      }
    },
    {
      connection: { url: config.redisUrl },
      concurrency: 5,
    }
  );

  worker.on("completed", (job: Job) => {
    console.log("[NotificationWorker] Job completed", { id: job.id, name: job.name });
  });

  worker.on("failed", (job: Job | undefined, err: Error) => {
    console.error("[NotificationWorker] Job failed", {
      id: job?.id,
      name: job?.name,
      error: err.message,
    });
  });

  worker.on("error", (err: Error) => {
    console.error("[NotificationWorker] Worker error (Redis connection issue?)", err.message);
  });

  return worker;
}
