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
  reviews,
  merchantUsers,
  treatmentQuotes,
} from "@glowos/db";
import { sendWhatsApp, sendWhatsAppTemplate } from "../lib/twilio.js";
import { config } from "../lib/config.js";
import { generateBookingToken } from "../lib/jwt.js";
import { sendEmail, bookingConfirmationEmail, postServiceReceiptEmail, rebookCtaEmail } from "../lib/email.js";
import { addJob } from "../lib/queue.js";

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

interface PostServiceReceiptData {
  booking_id: string;
}

interface PostServiceRebookData {
  booking_id: string;
}

interface LowRatingAlertData {
  booking_id: string;
}

interface OtpSendData {
  channel: "whatsapp" | "email";
  destination: string; // E.164 phone for WhatsApp, email address for email
  code: string;
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
  bookingId: string | null;
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
      bookingId: params.bookingId ?? undefined,
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

  const bookingToken = generateBookingToken(booking.id);
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
    `Reschedule or cancel? → ${cancelUrl}`,
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

  // Email confirmation (if client has email)
  if (client.email) {
    const html = bookingConfirmationEmail({
      clientName: client.name ?? "there",
      merchantName: merchant.name,
      serviceName: service.name,
      staffName: staffMember.name,
      dateStr,
      timeStr,
      priceSgd: price,
      cancelUrl,
    });
    const emailSent = await sendEmail({
      to: client.email,
      subject: `Booking confirmed — ${service.name} at ${merchant.name}`,
      html,
    });
    await logNotification({
      merchantId: merchant.id,
      clientId: client.id,
      bookingId: booking.id,
      type: "booking_confirmation",
      channel: "email",
      recipient: client.email,
      messageBody: `Booking confirmation email for ${service.name}`,
      status: emailSent ? "sent" : "failed",
    });
  }

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

async function handleRescheduleConfirmation(bookingId: string): Promise<void> {
  const row = await loadBookingWithDetails(bookingId);
  if (!row) {
    console.warn("[NotificationWorker] reschedule_confirmation: booking not found", { bookingId });
    return;
  }

  const { booking, merchant, service, staffMember, client } = row;

  if (!client.phone) {
    console.warn("[NotificationWorker] reschedule_confirmation: client has no phone", { bookingId });
    return;
  }

  const bookingToken = generateBookingToken(booking.id);
  const cancelUrl = `${config.frontendUrl}/cancel/${bookingToken}`;
  const dateStr = formatDate(booking.startTime);
  const timeStr = formatTime(booking.startTime);

  const message = [
    `📅 Your appointment at ${merchant.name} has been rescheduled.`,
    `New date: ${dateStr} at ${timeStr}`,
    `✂️ ${service.name} with ${staffMember.name}`,
    `Need to change again? → ${cancelUrl}`,
  ].join("\n");

  const sid = await sendWhatsApp(client.phone, message);

  await logNotification({
    merchantId: merchant.id,
    clientId: client.id,
    bookingId: booking.id,
    type: "reschedule_confirmation",
    channel: "whatsapp",
    recipient: client.phone,
    messageBody: message,
    status: sid ? "sent" : "failed",
    twilioSid: sid || undefined,
  });

  // Also notify merchant
  if (merchant.phone) {
    const merchantMsg = `Booking rescheduled: ${client.name ?? client.phone} — ${service.name} now ${dateStr} at ${timeStr}`;
    await sendWhatsApp(merchant.phone, merchantMsg);
  }

  console.log("[NotificationWorker] reschedule_confirmation handled", { bookingId });
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

  // If the booking is still pending (customer hasn't yet clicked confirm),
  // turn the T-24h reminder into a confirm prompt with the confirm link.
  // Already-confirmed bookings get the original soft reminder.
  const isPending = booking.status === "pending" && !!booking.confirmationToken;
  const confirmUrl = isPending
    ? `${config.frontendUrl}/confirm/${booking.confirmationToken}`
    : null;

  const message = isPending
    ? [
        `Hi! Just confirming your appointment tomorrow at ${merchant.name}.`,
        `📅 ${dateStr} at ${timeStr}`,
        `✂️ ${service.name} with ${staffMember.name}`,
        ``,
        `Please confirm you'll be there → ${confirmUrl}`,
      ].join("\n")
    : [
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

  console.log("[NotificationWorker] appointment_reminder handled", { bookingId, withConfirm: isPending });
}

// ─── Confirmation cascade followups ────────────────────────────────────────────
//
// Both followups short-circuit if the booking is no longer pending — once the
// customer confirms, the cascade goes silent. They share the same body shape
// as the T-24h reminder but with tighter time-pressure copy.

async function handleAppointmentReminderFollowup(
  bookingId: string,
  windowLabel: "12h" | "2h",
): Promise<void> {
  const row = await loadBookingWithDetails(bookingId);
  if (!row) return;
  const { booking, merchant, service, staffMember, client } = row;
  if (booking.status !== "pending") {
    console.log("[NotificationWorker] cascade-followup skipped — already confirmed/terminal", {
      bookingId,
      windowLabel,
      status: booking.status,
    });
    return;
  }
  if (!client.phone || !booking.confirmationToken) return;

  const dateStr = formatDate(booking.startTime);
  const timeStr = formatTime(booking.startTime);
  const confirmUrl = `${config.frontendUrl}/confirm/${booking.confirmationToken}`;

  const headline =
    windowLabel === "12h"
      ? `Heads up — your appointment at ${merchant.name} is in 12 hours.`
      : `Final reminder — your appointment at ${merchant.name} is in 2 hours.`;

  const cta =
    windowLabel === "12h"
      ? `Please confirm so we hold your slot → ${confirmUrl}`
      : `Last chance to confirm → ${confirmUrl}`;

  const message = [
    headline,
    `📅 ${dateStr} at ${timeStr}`,
    `✂️ ${service.name} with ${staffMember.name}`,
    ``,
    cta,
  ].join("\n");

  const sid = await sendWhatsApp(client.phone, message);
  await logNotification({
    merchantId: merchant.id,
    clientId: client.id,
    bookingId: booking.id,
    type: windowLabel === "12h" ? "appointment_reminder_followup_12h" : "appointment_reminder_final_2h",
    channel: "whatsapp",
    recipient: client.phone,
    messageBody: message,
    status: sid ? "sent" : "failed",
    twilioSid: sid || undefined,
  });
  console.log(`[NotificationWorker] appointment_reminder_${windowLabel} handled`, { bookingId });
}

// ─── 30-day rebook check-in ────────────────────────────────────────────────────
// Sent ~30 days after a completed treatment as a soft "haven't seen you in a
// while, time for your next visit?" nudge. Skipped if the client has already
// booked again at this merchant since the original visit — the CRM sequence
// shouldn't pester active customers.

async function handleRebookCheckin(bookingId: string): Promise<void> {
  const row = await loadBookingWithDetails(bookingId);
  if (!row) return;
  const { booking, merchant, service, client } = row;

  // Skip if the client already has a future or recent booking at this merchant
  // — they don't need a "come back" nudge if they're already coming back.
  const { gt } = await import("drizzle-orm");
  const sinceCompletion = booking.completedAt ?? booking.startTime;
  const [recent] = await db
    .select({ id: bookings.id })
    .from(bookings)
    .where(
      and(
        eq(bookings.merchantId, merchant.id),
        eq(bookings.clientId, client.id),
        gt(bookings.startTime, sinceCompletion),
      ),
    )
    .limit(1);
  if (recent) {
    console.log("[NotificationWorker] rebook_checkin_30d skipped — client already rebooked", {
      bookingId,
      laterBookingId: recent.id,
    });
    return;
  }

  const firstName = client.name ? client.name.split(" ")[0] : "there";
  const bookingUrl = `${config.frontendUrl}/${merchant.slug}`;

  if (client.phone) {
    const msg = [
      `Hi ${firstName}! It's been a month since your ${service.name} at ${merchant.name}.`,
      ``,
      `Time for your next visit? Book here → ${bookingUrl}`,
    ].join("\n");
    const sid = await sendWhatsApp(client.phone, msg);
    await logNotification({
      merchantId: merchant.id,
      clientId: client.id,
      bookingId: booking.id,
      type: "rebook_checkin_30d",
      channel: "whatsapp",
      recipient: client.phone,
      messageBody: msg,
      status: sid ? "sent" : "failed",
      twilioSid: sid || undefined,
    });
  }

  if (client.email) {
    const html = `<!DOCTYPE html><html><body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#fcfaef;margin:0;padding:32px 16px;">
      <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.06);">
        <div style="background:#1a2313;color:#fff;padding:24px;text-align:center;">
          <p style="font-size:11px;letter-spacing:2px;opacity:0.7;text-transform:uppercase;margin:0 0 8px;">It's been a month</p>
          <h1 style="font-size:20px;margin:0;">${merchant.name}</h1>
        </div>
        <div style="padding:24px;text-align:center;">
          <p style="margin:0 0 16px;color:#333;">Hi ${firstName},</p>
          <p style="margin:0 0 24px;color:#555;line-height:1.6;">
            It's been about a month since your <strong>${service.name}</strong>. Many of our clients
            book their next session around now — would you like to book a follow-up?
          </p>
          <a href="${bookingUrl}" style="display:inline-block;background:#1a2313;color:#fff !important;padding:14px 32px;border-radius:12px;font-weight:600;text-decoration:none;font-size:14px;">Book my next visit →</a>
        </div>
      </div>
    </body></html>`;
    const ok = await sendEmail({
      to: client.email,
      subject: `Time for your next visit at ${merchant.name}?`,
      html,
    });
    await logNotification({
      merchantId: merchant.id,
      clientId: client.id,
      bookingId: booking.id,
      type: "rebook_checkin_30d",
      channel: "email",
      recipient: client.email,
      messageBody: `30-day rebook check-in for ${service.name}`,
      status: ok ? "sent" : "failed",
    });
  }

  console.log("[NotificationWorker] rebook_checkin_30d handled", { bookingId });
}

// ─── Merchant alert when client confirms ───────────────────────────────────────

async function handleBookingConfirmedByClient(bookingId: string): Promise<void> {
  const row = await loadBookingWithDetails(bookingId);
  if (!row) return;
  const { booking, merchant, service, staffMember, client } = row;
  const dateStr = formatDate(booking.startTime);
  const timeStr = formatTime(booking.startTime);
  const clientName = client.name ?? client.phone ?? "Client";

  // Merchant WhatsApp
  if (merchant.phone) {
    const msg = [
      `✅ ${clientName} just confirmed their appointment.`,
      `📅 ${dateStr} at ${timeStr}`,
      `✂️ ${service.name} with ${staffMember.name}`,
    ].join("\n");
    const sid = await sendWhatsApp(merchant.phone, msg);
    await logNotification({
      merchantId: merchant.id,
      clientId: client.id,
      bookingId: booking.id,
      type: "booking_confirmed_by_client",
      channel: "whatsapp",
      recipient: merchant.phone,
      messageBody: msg,
      status: sid ? "sent" : "failed",
      twilioSid: sid || undefined,
    });
  }

  // Merchant email
  if (merchant.email) {
    const html = `<!DOCTYPE html><html><body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#fcfaef;margin:0;padding:32px 16px;">
      <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.06);">
        <div style="background:#1a2313;color:#fff;padding:24px;text-align:center;">
          <p style="font-size:11px;letter-spacing:2px;opacity:0.7;text-transform:uppercase;margin:0 0 8px;">Appointment confirmed by client</p>
          <h1 style="font-size:20px;margin:0;">${merchant.name}</h1>
        </div>
        <div style="padding:24px;">
          <p style="margin:0 0 16px;color:#333;">
            <strong>${clientName}</strong> confirmed their appointment.
          </p>
          <div style="border-top:1px solid #e8e4de;border-bottom:1px solid #e8e4de;padding:16px 0;font-size:14px;">
            <div style="display:flex;justify-content:space-between;margin-bottom:6px;">
              <span style="color:#888;">Service</span>
              <span style="color:#111;font-weight:600;">${service.name}</span>
            </div>
            <div style="display:flex;justify-content:space-between;margin-bottom:6px;">
              <span style="color:#888;">Staff</span>
              <span style="color:#111;">${staffMember.name}</span>
            </div>
            <div style="display:flex;justify-content:space-between;">
              <span style="color:#888;">When</span>
              <span style="color:#111;">${dateStr} at ${timeStr}</span>
            </div>
          </div>
        </div>
      </div>
    </body></html>`;
    const ok = await sendEmail({
      to: merchant.email,
      subject: `Appointment confirmed by ${clientName}`,
      html,
    });
    await logNotification({
      merchantId: merchant.id,
      clientId: client.id,
      bookingId: booking.id,
      type: "booking_confirmed_by_client",
      channel: "email",
      recipient: merchant.email,
      messageBody: `Confirmation alert for ${clientName} — ${service.name}`,
      status: ok ? "sent" : "failed",
    });
  }

  console.log("[NotificationWorker] booking_confirmed_by_client handled", { bookingId });
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

  // Four-way branching so cash/online/refund-eligible/refund-forfeit all get
  // accurate copy. The old logic showed "No refund applies per our policy"
  // even for cash cancellations inside the free window, which read as a
  // penalty when actually no payment had been collected.
  let refundMessage: string;
  const paymentStatus = booking.paymentStatus ?? "";
  const paymentMethod = booking.paymentMethod ?? "";

  if (refundAmount > 0) {
    // Actual refund was queued to Stripe (full or partial) — tell the client.
    refundMessage =
      paymentStatus === "partially_refunded"
        ? `A partial refund of SGD ${refundAmount.toFixed(2)} will be processed within 3–5 business days.`
        : `A full refund of SGD ${refundAmount.toFixed(2)} will be processed within 3–5 business days.`;
  } else if (paymentStatus === "waived" || paymentMethod === "cash" || paymentStatus === "unpaid") {
    // Cash or unpaid — there's no online payment to refund. Don't lecture the
    // client about "no refund per policy" when nothing was collected.
    refundMessage = `No payment was collected online, so nothing to refund.`;
  } else {
    // Card paid, cancel fell outside the partial-refund window too.
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
    `Expect it in 3–5 business days.`,
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

async function handlePostServiceReceipt(bookingId: string): Promise<void> {
  const row = await loadBookingWithDetails(bookingId);
  if (!row) {
    console.warn("[NotificationWorker] post_service_receipt: booking not found", { bookingId });
    return;
  }

  const { booking, merchant, service, client } = row;

  if (!client.phone) {
    console.warn("[NotificationWorker] post_service_receipt: client has no phone", { bookingId });
    return;
  }

  const receiptMessage =
    `✅ *Service Complete — ${merchant.name}*\n\n` +
    `Hi ${client.name ?? "there"}, thank you for visiting us!\n\n` +
    `*Service:* ${service.name}\n` +
    `*Amount:* S$${booking.priceSgd}\n` +
    `*Date:* ${new Date(booking.startTime).toLocaleDateString("en-SG", { day: "numeric", month: "long", year: "numeric" })}\n\n` +
    `We hope to see you again soon! 🌟`;

  const sid = await sendWhatsApp(client.phone, receiptMessage);

  await logNotification({
    merchantId: merchant.id,
    clientId: client.id,
    bookingId: booking.id,
    type: "post_service_receipt",
    channel: "whatsapp",
    recipient: client.phone,
    messageBody: receiptMessage,
    status: sid ? "sent" : "failed",
    twilioSid: sid || undefined,
  });

  if (client.email) {
    const bookingUrl = `${config.frontendUrl}/${merchant.slug}`;
    const html = postServiceReceiptEmail({
      clientName: client.name ?? "there",
      merchantName: merchant.name,
      serviceName: service.name,
      dateStr: new Date(booking.startTime).toLocaleDateString("en-SG", {
        day: "numeric", month: "long", year: "numeric",
      }),
      priceSgd: parseFloat(String(booking.priceSgd)).toFixed(2),
      bookingUrl,
    });
    const emailSent = await sendEmail({
      to: client.email,
      subject: `Your visit receipt — ${merchant.name}`,
      html,
    });
    await logNotification({
      merchantId: merchant.id,
      clientId: client.id,
      bookingId: booking.id,
      type: "post_service_receipt",
      channel: "email",
      recipient: client.email,
      messageBody: `Post-service receipt email`,
      status: emailSent ? "sent" : "failed",
    });
  }

  console.log("[NotificationWorker] post_service_receipt handled", { bookingId });
}

async function handlePostServiceRebook(bookingId: string): Promise<void> {
  const row = await loadBookingWithDetails(bookingId);
  if (!row) {
    console.warn("[NotificationWorker] post_service_rebook: booking not found", { bookingId });
    return;
  }

  const { booking, merchant, service, client } = row;

  if (!client.phone) {
    console.warn("[NotificationWorker] post_service_rebook: client has no phone", { bookingId });
    return;
  }

  const bookingUrl = `${config.frontendUrl}/${merchant.slug}`;
  const rebookMessage =
    `💆 *Time for your next visit?*\n\n` +
    `Hi ${client.name ?? "there"}! It's been a couple of days since your *${service.name}* at ${merchant.name}.\n\n` +
    `Ready to book again? Tap the link below:\n${bookingUrl}\n\n` +
    `See you soon! ✨`;

  const sid = await sendWhatsApp(client.phone, rebookMessage);

  await logNotification({
    merchantId: merchant.id,
    clientId: client.id,
    bookingId: booking.id,
    type: "post_service_rebook",
    channel: "whatsapp",
    recipient: client.phone,
    messageBody: rebookMessage,
    status: sid ? "sent" : "failed",
    twilioSid: sid || undefined,
  });

  if (client.email) {
    const html = rebookCtaEmail({
      clientName: client.name ?? "there",
      merchantName: merchant.name,
      serviceName: service.name,
      bookingUrl,
    });
    const emailSent = await sendEmail({
      to: client.email,
      subject: `Time for your next visit at ${merchant.name}?`,
      html,
    });
    await logNotification({
      merchantId: merchant.id,
      clientId: client.id,
      bookingId: booking.id,
      type: "post_service_rebook",
      channel: "email",
      recipient: client.email,
      messageBody: `Rebook CTA email`,
      status: emailSent ? "sent" : "failed",
    });
  }

  console.log("[NotificationWorker] post_service_rebook handled", { bookingId });
}

async function handleLowRatingAlert(bookingId: string): Promise<void> {
  const row = await loadBookingWithDetails(bookingId);
  if (!row) {
    console.warn("[NotificationWorker] low_rating_alert: booking not found", { bookingId });
    return;
  }

  const { booking, merchant, service, client } = row;

  // Load the review
  const [review] = await db
    .select({ id: reviews.id, rating: reviews.rating, comment: reviews.comment })
    .from(reviews)
    .where(eq(reviews.bookingId, bookingId))
    .limit(1);

  if (!review) {
    console.warn("[NotificationWorker] low_rating_alert: review not found", { bookingId });
    return;
  }

  // Find merchant owner's phone (from merchant_users with role=owner)
  const [owner] = await db
    .select({ phone: merchantUsers.phone })
    .from(merchantUsers)
    .where(and(eq(merchantUsers.merchantId, merchant.id), eq(merchantUsers.role, "owner")))
    .limit(1);

  if (!owner?.phone) {
    console.warn("[NotificationWorker] low_rating_alert: merchant owner has no phone", { merchantId: merchant.id });
    return;
  }

  const commentLine = review.comment ? `"${review.comment}"` : "No comment left.";

  const message = [
    `⚠️ New review needs attention`,
    ``,
    `${client.name} rated their ${service.name} appointment ${review.rating}/5 stars.`,
    commentLine,
    ``,
    `Check your dashboard: ${config.frontendUrl}/dashboard/reviews`,
  ].join("\n");

  const sid = await sendWhatsApp(owner.phone, message);

  // Mark alert as sent
  await db
    .update(reviews)
    .set({ isAlertSent: true })
    .where(eq(reviews.id, review.id));

  await logNotification({
    merchantId: merchant.id,
    clientId: client.id,
    bookingId: booking.id,
    type: "low_rating_alert",
    channel: "whatsapp",
    recipient: owner.phone,
    messageBody: message,
    status: sid ? "sent" : "failed",
    twilioSid: sid || undefined,
  });

  console.log("[NotificationWorker] low_rating_alert handled", { bookingId, rating: review.rating });
}

async function handleOtpSend(data: OtpSendData): Promise<void> {
  const body = `Your GlowOS verification code: ${data.code}. Valid for 10 minutes.`;
  if (data.channel === "whatsapp") {
    // Prefer the pre-approved Content Template when configured. Required
    // for business-initiated OTPs outside Twilio's 24h session window —
    // freeform text returns Twilio error 63016 in that case.
    let sid = "";
    if (config.twilioOtpContentSid) {
      sid = await sendWhatsAppTemplate({
        to: data.destination,
        contentSid: config.twilioOtpContentSid,
        variables: { "1": data.code },
      });
    } else {
      // No template configured — fall back to freeform. This works only if
      // the recipient has an active 24h session; it WILL fail (Twilio 63016)
      // for most business-initiated OTPs.
      sid = await sendWhatsApp(data.destination, body);
    }
    if (!sid) {
      throw new Error(`WhatsApp OTP failed for ${data.destination}`);
    }
    console.log("[NotificationWorker] otp_send whatsapp ok", {
      destination: data.destination,
      sid,
      via: config.twilioOtpContentSid ? "template" : "freeform",
    });
    return;
  }
  const ok = await sendEmail({
    to: data.destination,
    subject: "Your verification code",
    html: `<p>Your GlowOS verification code is <strong>${data.code}</strong>.</p><p>It will expire in 10 minutes.</p>`,
  });
  if (!ok) {
    throw new Error(`Email OTP failed for ${data.destination}`);
  }
  console.log("[NotificationWorker] otp_send email ok", {
    destination: data.destination,
  });
}

// ─── Waitlist handlers ─────────────────────────────────────────────────────────

interface WaitlistMatchData {
  merchant_id: string;
  staff_id: string;
  service_id: string;
  freed_start: string;
  freed_end: string;
  notified_booking_slot_id: string;
}

async function handleWaitlistMatch(data: WaitlistMatchData): Promise<void> {
  const freedStart = new Date(data.freed_start);
  const freedEnd   = new Date(data.freed_end);
  const targetDate = `${freedStart.getFullYear()}-${String(freedStart.getMonth() + 1).padStart(2, "0")}-${String(freedStart.getDate()).padStart(2, "0")}`;
  const freedStartHHMM = `${String(freedStart.getHours()).padStart(2, "0")}:${String(freedStart.getMinutes()).padStart(2, "0")}`;
  const freedEndHHMM   = `${String(freedEnd.getHours()).padStart(2, "0")}:${String(freedEnd.getMinutes()).padStart(2, "0")}`;

  const { waitlist } = await import("@glowos/db");
  const { and, eq, lte, gte } = await import("drizzle-orm");

  const [entry] = await db
    .select()
    .from(waitlist)
    .where(
      and(
        eq(waitlist.merchantId, data.merchant_id),
        eq(waitlist.staffId, data.staff_id),
        eq(waitlist.status, "pending"),
        eq(waitlist.targetDate, targetDate),
        lte(waitlist.windowStart, freedStartHHMM),
        gte(waitlist.windowEnd, freedEndHHMM),
      )
    )
    .orderBy(waitlist.createdAt)
    .limit(1);

  if (!entry) {
    console.log("[WaitlistMatch] no pending entries match", { data });
    return;
  }

  const HOLD_MINUTES = 10;
  const holdExpiresAt = new Date(Date.now() + HOLD_MINUTES * 60 * 1000);
  await db
    .update(waitlist)
    .set({
      status: "notified",
      notifiedAt: new Date(),
      holdExpiresAt,
      notifiedBookingSlotId: data.notified_booking_slot_id,
      updatedAt: new Date(),
    })
    .where(eq(waitlist.id, entry.id));

  const { scheduleWaitlistHoldExpire } = await import("../lib/waitlist-scheduler.js");
  await scheduleWaitlistHoldExpire(entry.id, HOLD_MINUTES * 60 * 1000);

  await addJob("notifications", "waitlist_slot_opened", { waitlist_id: entry.id });
}

interface WaitlistHoldExpireData {
  waitlist_id: string;
}

async function handleWaitlistHoldExpire(data: WaitlistHoldExpireData): Promise<void> {
  const { waitlist } = await import("@glowos/db");
  const { eq } = await import("drizzle-orm");

  const [row] = await db
    .select()
    .from(waitlist)
    .where(eq(waitlist.id, data.waitlist_id))
    .limit(1);
  if (!row || row.status !== "notified") {
    return;
  }

  await db
    .update(waitlist)
    .set({ status: "expired", updatedAt: new Date() })
    .where(eq(waitlist.id, data.waitlist_id));

  if (row.notifiedBookingSlotId) {
    const [freed] = await db
      .select()
      .from(bookings)
      .where(eq(bookings.id, row.notifiedBookingSlotId))
      .limit(1);
    if (freed) {
      const { scheduleWaitlistMatchJob } = await import("../lib/waitlist-scheduler.js");
      await scheduleWaitlistMatchJob({
        merchant_id: row.merchantId,
        staff_id: row.staffId,
        service_id: row.serviceId,
        freed_start: freed.startTime.toISOString(),
        freed_end: freed.endTime.toISOString(),
        notified_booking_slot_id: row.notifiedBookingSlotId,
      });
    }
  }
}

async function handleWaitlistExpireStale(): Promise<void> {
  const { waitlist } = await import("@glowos/db");
  const { and, inArray, lt } = await import("drizzle-orm");
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

  await db
    .update(waitlist)
    .set({ status: "expired", updatedAt: new Date() })
    .where(and(
      inArray(waitlist.status, ["pending", "notified"]),
      lt(waitlist.targetDate, todayStr)
    ));
  console.log("[WaitlistExpire] swept past-date entries", { todayStr });
}

// ─── Waitlist notification handlers ───────────────────────────────────────────

interface WaitlistConfirmationData { waitlist_id: string; }
interface WaitlistSlotOpenedData   { waitlist_id: string; }

async function loadWaitlistWithDetails(id: string) {
  const { waitlist } = await import("@glowos/db");
  const [row] = await db
    .select({
      w: waitlist,
      merchant: merchants,
      service: services,
      staffMember: staff,
      client: clients,
    })
    .from(waitlist)
    .innerJoin(merchants, eq(waitlist.merchantId, merchants.id))
    .innerJoin(services, eq(waitlist.serviceId, services.id))
    .innerJoin(staff, eq(waitlist.staffId, staff.id))
    .innerJoin(clients, eq(waitlist.clientId, clients.id))
    .where(eq(waitlist.id, id))
    .limit(1);
  return row ?? null;
}

async function handleWaitlistConfirmation(data: WaitlistConfirmationData): Promise<void> {
  const row = await loadWaitlistWithDetails(data.waitlist_id);
  if (!row) return;
  const cancelUrl = `${config.frontendUrl}/${row.merchant.slug}/waitlist/cancel?id=${row.w.id}&token=${row.w.cancelToken}`;
  const message = [
    `Hi ${row.client.name ?? "there"}! You're on the waitlist at ${row.merchant.name}.`,
    `${row.service.name} with ${row.staffMember.name}`,
    `📅 ${row.w.targetDate} between ${row.w.windowStart}–${row.w.windowEnd}`,
    `We'll WhatsApp you if a slot opens. Cancel: ${cancelUrl}`,
  ].join("\n");

  const sid = await sendWhatsApp(row.client.phone, message).catch(() => null);
  await logNotification({
    merchantId: row.merchant.id,
    clientId: row.client.id,
    bookingId: null,
    type: "waitlist_confirmation",
    channel: "whatsapp",
    recipient: row.client.phone,
    messageBody: message,
    status: sid ? "sent" : "failed",
    twilioSid: sid || undefined,
  });
  if (!sid && row.client.email) {
    await sendEmail({
      to: row.client.email,
      subject: `You're on the waitlist at ${row.merchant.name}`,
      html: `<p>${message.replace(/\n/g, "<br/>")}</p>`,
    });
  }
}

async function handleWaitlistSlotOpened(data: WaitlistSlotOpenedData): Promise<void> {
  const row = await loadWaitlistWithDetails(data.waitlist_id);
  if (!row) return;
  const confirmUrl = `${config.frontendUrl}/${row.merchant.slug}/confirm-waitlist?waitlist=${row.w.id}&token=${row.w.cancelToken}`;
  const message = [
    `Slot opened! ${row.staffMember.name} has an opening on ${row.w.targetDate}.`,
    `Confirm within 10 min: ${confirmUrl}`,
  ].join("\n");

  const sid = await sendWhatsApp(row.client.phone, message).catch(() => null);
  await logNotification({
    merchantId: row.merchant.id,
    clientId: row.client.id,
    bookingId: null,
    type: "waitlist_slot_opened",
    channel: "whatsapp",
    recipient: row.client.phone,
    messageBody: message,
    status: sid ? "sent" : "failed",
    twilioSid: sid || undefined,
  });
  if (!sid && row.client.email) {
    await sendEmail({
      to: row.client.email,
      subject: `A slot opened — confirm within 10 min`,
      html: `<p>${message.replace(/\n/g, "<br/>")}</p>`,
    });
  }
}

// ─── Treatment quote handler ─────────────────────────────────────────────────
//
// Auto-sends the accept-link to the client via WhatsApp + email when a quote
// is issued. Uses freeform WhatsApp — Twilio's 24h session window usually
// covers this case because the client was just in the clinic for the consult
// that triggered the quote. If freeform fails, email picks up the slack
// (SendGrid has no equivalent window rule).

interface TreatmentQuoteIssuedData {
  quote_id: string;
}

async function handleTreatmentQuoteIssued(quoteId: string): Promise<void> {
  const [row] = await db
    .select({
      quote: treatmentQuotes,
      merchant: { id: merchants.id, name: merchants.name, slug: merchants.slug },
      client: { id: clients.id, name: clients.name, phone: clients.phone, email: clients.email },
    })
    .from(treatmentQuotes)
    .innerJoin(merchants, eq(treatmentQuotes.merchantId, merchants.id))
    .innerJoin(clients, eq(treatmentQuotes.clientId, clients.id))
    .where(eq(treatmentQuotes.id, quoteId))
    .limit(1);

  if (!row) {
    console.warn("[NotificationWorker] treatment_quote_issued: quote not found", { quoteId });
    return;
  }

  const { quote, merchant, client } = row;
  const acceptUrl = `${config.frontendUrl}/quote/${quote.acceptToken}`;
  const price = parseFloat(String(quote.priceSgd)).toFixed(2);
  const validUntil = format(quote.validUntil, "d MMM yyyy");
  const firstName = client.name ? client.name.split(" ")[0] : "there";

  // WhatsApp — freeform within the session window.
  if (client.phone) {
    const msg = [
      `Hi ${firstName}, ${merchant.name} has issued a treatment quote for you.`,
      ``,
      `📋 ${quote.serviceName}`,
      `💳 SGD ${price}`,
      `📅 Valid until ${validUntil}`,
      ``,
      `Review & accept here: ${acceptUrl}`,
      ``,
      `This quote is valid for a limited time. Please accept before the expiry date to confirm your slot.`,
    ].join("\n");
    const sid = await sendWhatsApp(client.phone, msg);
    await logNotification({
      merchantId: merchant.id,
      clientId: client.id,
      bookingId: null,
      type: "treatment_quote_issued",
      channel: "whatsapp",
      recipient: client.phone,
      messageBody: msg,
      status: sid ? "sent" : "failed",
      twilioSid: sid || undefined,
    });
  }

  // Email — reliable fallback.
  if (client.email) {
    const html = `<!DOCTYPE html><html><body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#fcfaef;margin:0;padding:32px 16px;">
      <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.06);">
        <div style="background:#1a2313;color:#fff;padding:24px;text-align:center;">
          <p style="font-size:11px;letter-spacing:2px;opacity:0.7;text-transform:uppercase;margin:0 0 8px;">Treatment quote</p>
          <h1 style="font-size:20px;margin:0;">${merchant.name}</h1>
        </div>
        <div style="padding:24px;">
          <p style="margin:0 0 8px;color:#333;">Hi ${firstName},</p>
          <p style="margin:0 0 20px;color:#555;line-height:1.6;">
            Following your consultation, we've issued the quote below. Please review and accept to reserve your treatment slot.
          </p>
          <div style="border-top:1px solid #e8e4de;border-bottom:1px solid #e8e4de;padding:16px 0;margin-bottom:20px;">
            <div style="display:flex;justify-content:space-between;margin-bottom:8px;font-size:14px;">
              <span style="color:#888;">Service</span>
              <span style="color:#111;font-weight:600;">${quote.serviceName}</span>
            </div>
            <div style="display:flex;justify-content:space-between;margin-bottom:8px;font-size:14px;">
              <span style="color:#888;">Price</span>
              <span style="color:#456466;font-weight:700;font-size:18px;">SGD ${price}</span>
            </div>
            <div style="display:flex;justify-content:space-between;font-size:14px;">
              <span style="color:#888;">Valid until</span>
              <span style="color:#111;font-weight:500;">${validUntil}</span>
            </div>
          </div>
          ${quote.notes ? `<p style="margin:0 0 20px;color:#555;font-style:italic;font-size:13px;border-left:3px solid #e8e4de;padding-left:12px;">${quote.notes}</p>` : ""}
          <div style="text-align:center;">
            <a href="${acceptUrl}" style="display:inline-block;background:#1a2313;color:#fff !important;padding:14px 32px;border-radius:12px;font-weight:600;text-decoration:none;font-size:14px;">Review & Accept →</a>
          </div>
          <p style="margin:20px 0 0;color:#888;font-size:12px;text-align:center;">
            Or paste this link into your browser:<br>
            <span style="word-break:break-all;color:#666;">${acceptUrl}</span>
          </p>
        </div>
      </div>
    </body></html>`;
    const ok = await sendEmail({
      to: client.email,
      subject: `Your treatment quote from ${merchant.name}`,
      html,
    });
    await logNotification({
      merchantId: merchant.id,
      clientId: client.id,
      bookingId: null,
      type: "treatment_quote_issued",
      channel: "email",
      recipient: client.email,
      messageBody: `Treatment quote email for ${quote.serviceName}`,
      status: ok ? "sent" : "failed",
    });
  }

  console.log("[NotificationWorker] treatment_quote_issued handled", { quoteId });
}

// ─── Treatment quote expiry reminder (daily sweep) ─────────────────────────────
// Fires a nudge 3 days before valid_until for any still-pending quote that
// hasn't already been reminded. Runs once a day from the repeat-cron in
// workers/index.ts; internally idempotent via reminderSentAt column.
async function handleTreatmentQuoteReminderSweep(): Promise<void> {
  const { gt, lte, isNull } = await import("drizzle-orm");
  const now = new Date();
  // Lower bound > now (so we don't nudge quotes that already expired between
  // sweeps), upper bound <= now + 3d.
  const threeDaysOut = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);

  const due = await db
    .select({ id: treatmentQuotes.id })
    .from(treatmentQuotes)
    .where(
      and(
        eq(treatmentQuotes.status, "pending"),
        isNull(treatmentQuotes.reminderSentAt),
        gt(treatmentQuotes.validUntil, now),
        lte(treatmentQuotes.validUntil, threeDaysOut),
      ),
    );

  console.log("[NotificationWorker] quote reminder sweep", { due: due.length });

  for (const { id } of due) {
    try {
      await sendTreatmentQuoteReminder(id);
      await db
        .update(treatmentQuotes)
        .set({ reminderSentAt: new Date(), updatedAt: new Date() })
        .where(eq(treatmentQuotes.id, id));
    } catch (err) {
      console.error("[NotificationWorker] quote reminder failed", { id, err });
    }
  }
}

async function sendTreatmentQuoteReminder(quoteId: string): Promise<void> {
  const [row] = await db
    .select({
      quote: treatmentQuotes,
      merchant: { id: merchants.id, name: merchants.name, slug: merchants.slug },
      client: { id: clients.id, name: clients.name, phone: clients.phone, email: clients.email },
    })
    .from(treatmentQuotes)
    .innerJoin(merchants, eq(treatmentQuotes.merchantId, merchants.id))
    .innerJoin(clients, eq(treatmentQuotes.clientId, clients.id))
    .where(eq(treatmentQuotes.id, quoteId))
    .limit(1);
  if (!row) return;

  const { quote, merchant, client } = row;
  const acceptUrl = `${config.frontendUrl}/quote/${quote.acceptToken}`;
  const price = parseFloat(String(quote.priceSgd)).toFixed(2);
  const validUntil = format(quote.validUntil, "d MMM yyyy");
  const firstName = client.name ? client.name.split(" ")[0] : "there";

  if (client.phone) {
    const msg = [
      `Hi ${firstName}, a quick reminder — your ${merchant.name} treatment quote expires on ${validUntil}.`,
      ``,
      `📋 ${quote.serviceName}`,
      `💳 SGD ${price}`,
      ``,
      `Accept before it expires: ${acceptUrl}`,
    ].join("\n");
    const sid = await sendWhatsApp(client.phone, msg);
    await logNotification({
      merchantId: merchant.id,
      clientId: client.id,
      bookingId: null,
      type: "treatment_quote_reminder",
      channel: "whatsapp",
      recipient: client.phone,
      messageBody: msg,
      status: sid ? "sent" : "failed",
      twilioSid: sid || undefined,
    });
  }

  if (client.email) {
    const html = `<!DOCTYPE html><html><body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#fcfaef;margin:0;padding:32px 16px;">
      <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.06);">
        <div style="background:#1a2313;color:#fff;padding:24px;text-align:center;">
          <p style="font-size:11px;letter-spacing:2px;opacity:0.7;text-transform:uppercase;margin:0 0 8px;">Quote expiring soon</p>
          <h1 style="font-size:20px;margin:0;">${merchant.name}</h1>
        </div>
        <div style="padding:24px;">
          <p style="margin:0 0 8px;color:#333;">Hi ${firstName},</p>
          <p style="margin:0 0 20px;color:#555;line-height:1.6;">
            Just a reminder — your treatment quote expires on <strong>${validUntil}</strong>.
            Accept before then to lock in your slot at the quoted price.
          </p>
          <div style="border-top:1px solid #e8e4de;border-bottom:1px solid #e8e4de;padding:16px 0;margin-bottom:20px;">
            <div style="display:flex;justify-content:space-between;margin-bottom:8px;font-size:14px;">
              <span style="color:#888;">Service</span>
              <span style="color:#111;font-weight:600;">${quote.serviceName}</span>
            </div>
            <div style="display:flex;justify-content:space-between;font-size:14px;">
              <span style="color:#888;">Price</span>
              <span style="color:#456466;font-weight:700;font-size:18px;">SGD ${price}</span>
            </div>
          </div>
          <div style="text-align:center;">
            <a href="${acceptUrl}" style="display:inline-block;background:#1a2313;color:#fff !important;padding:14px 32px;border-radius:12px;font-weight:600;text-decoration:none;font-size:14px;">Review & Accept →</a>
          </div>
        </div>
      </div>
    </body></html>`;
    const ok = await sendEmail({
      to: client.email,
      subject: `Reminder: your treatment quote from ${merchant.name} expires ${validUntil}`,
      html,
    });
    await logNotification({
      merchantId: merchant.id,
      clientId: client.id,
      bookingId: null,
      type: "treatment_quote_reminder",
      channel: "email",
      recipient: client.email,
      messageBody: `Treatment quote reminder for ${quote.serviceName}`,
      status: ok ? "sent" : "failed",
    });
  }
}

// ─── Package purchase notification ────────────────────────────────────────────

interface PackagePurchasedData {
  client_package_id: string;
  // 'paid' = customer just completed Stripe payment online
  // 'reserved' = customer chose pay-at-counter (no money received yet)
  payment_status?: "paid" | "reserved";
}

async function handlePackagePurchased(data: PackagePurchasedData): Promise<void> {
  const { clientPackages, servicePackages, packageSessions } = await import("@glowos/db");
  const [row] = await db
    .select({
      cp: clientPackages,
      pkg: servicePackages,
      merchant: { id: merchants.id, name: merchants.name, slug: merchants.slug },
      client: { id: clients.id, name: clients.name, phone: clients.phone, email: clients.email },
    })
    .from(clientPackages)
    .innerJoin(servicePackages, eq(clientPackages.packageId, servicePackages.id))
    .innerJoin(merchants, eq(clientPackages.merchantId, merchants.id))
    .innerJoin(clients, eq(clientPackages.clientId, clients.id))
    .where(eq(clientPackages.id, data.client_package_id))
    .limit(1);

  if (!row) {
    console.warn("[NotificationWorker] package_purchased: not found", data);
    return;
  }

  const { cp, pkg, merchant, client } = row;
  const firstName = client.name ? client.name.split(" ")[0] : "there";
  const price = parseFloat(String(pkg.priceSgd)).toFixed(2);
  const expiresAt = format(cp.expiresAt, "d MMM yyyy");
  const status = data.payment_status ?? "reserved";

  // Look up the first booking (if any) so we can mention the appointment in
  // the message. Package purchases via the wizard always book session 1.
  const [firstSession] = await db
    .select({ bookingId: packageSessions.bookingId })
    .from(packageSessions)
    .where(
      and(
        eq(packageSessions.clientPackageId, cp.id),
        eq(packageSessions.sessionNumber, 1),
      ),
    )
    .limit(1);

  let firstBookingLine = "";
  let firstBookingCancelLine = "";
  if (firstSession?.bookingId) {
    const [b] = await db
      .select({ booking: bookings, service: services, staffMember: staff })
      .from(bookings)
      .innerJoin(services, eq(bookings.serviceId, services.id))
      .innerJoin(staff, eq(bookings.staffId, staff.id))
      .where(eq(bookings.id, firstSession.bookingId))
      .limit(1);
    if (b) {
      const when = format(b.booking.startTime, "EEE, d MMM 'at' h:mma");
      firstBookingLine = `\n📅 First session: ${b.service.name} with ${b.staffMember.name} — ${when}`;
      // Same signed-token cancel/reschedule link the booking_confirmation
      // handler uses, so package customers get the same self-service flow.
      const bookingToken = generateBookingToken(b.booking.id);
      firstBookingCancelLine = `${config.frontendUrl}/cancel/${bookingToken}`;
    }
  }

  const paymentLine =
    status === "paid"
      ? `✅ Payment received: SGD ${price}`
      : `💵 Pay SGD ${price} at the clinic on your first visit`;

  // WhatsApp — freeform within the session window.
  if (client.phone) {
    const lines = [
      `Hi ${firstName}, your ${pkg.name} is confirmed at ${merchant.name}.`,
      ``,
      `📦 ${cp.sessionsTotal} sessions · valid until ${expiresAt}`,
      paymentLine + firstBookingLine,
    ];
    if (firstBookingCancelLine) {
      lines.push(``, `Reschedule or cancel your first session? → ${firstBookingCancelLine}`);
    }
    lines.push(``, `See you soon!`);
    const msg = lines.join("\n");
    const sid = await sendWhatsApp(client.phone, msg);
    await logNotification({
      merchantId: merchant.id,
      clientId: client.id,
      bookingId: firstSession?.bookingId ?? null,
      type: "package_purchased",
      channel: "whatsapp",
      recipient: client.phone,
      messageBody: msg,
      status: sid ? "sent" : "failed",
      twilioSid: sid || undefined,
    });
  }

  // Email — branded confirmation as a backup channel.
  if (client.email) {
    const html = `<!DOCTYPE html><html><body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#fcfaef;margin:0;padding:32px 16px;">
      <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.06);">
        <div style="background:#1a2313;color:#fff;padding:24px;text-align:center;">
          <p style="font-size:11px;letter-spacing:2px;opacity:0.7;text-transform:uppercase;margin:0 0 8px;">Package confirmed</p>
          <h1 style="font-size:20px;margin:0;">${merchant.name}</h1>
        </div>
        <div style="padding:24px;">
          <p style="margin:0 0 8px;color:#333;">Hi ${firstName},</p>
          <p style="margin:0 0 20px;color:#555;line-height:1.6;">
            Thanks for purchasing the <strong>${pkg.name}</strong>. Here's your confirmation:
          </p>
          <div style="border-top:1px solid #e8e4de;border-bottom:1px solid #e8e4de;padding:16px 0;margin-bottom:20px;">
            <div style="display:flex;justify-content:space-between;margin-bottom:8px;font-size:14px;">
              <span style="color:#888;">Sessions</span>
              <span style="color:#111;font-weight:600;">${cp.sessionsTotal}</span>
            </div>
            <div style="display:flex;justify-content:space-between;margin-bottom:8px;font-size:14px;">
              <span style="color:#888;">${status === "paid" ? "Paid" : "Due at first visit"}</span>
              <span style="color:#456466;font-weight:700;font-size:18px;">SGD ${price}</span>
            </div>
            <div style="display:flex;justify-content:space-between;font-size:14px;">
              <span style="color:#888;">Valid until</span>
              <span style="color:#111;font-weight:500;">${expiresAt}</span>
            </div>
          </div>
          ${firstBookingLine ? `<p style="margin:0 0 12px;color:#555;line-height:1.6;font-size:13px;">Your first session is booked.<br><strong style="color:#111;">${firstBookingLine.replace(/^\n📅 First session: /, "")}</strong></p>` : ""}
          ${firstBookingCancelLine ? `<p style="margin:0 0 20px;color:#555;line-height:1.6;font-size:13px;">Need to reschedule or cancel that session? <a href="${firstBookingCancelLine}" style="color:#456466;text-decoration:underline;">Manage your booking</a>.</p>` : ""}
        </div>
      </div>
    </body></html>`;
    const ok = await sendEmail({
      to: client.email,
      subject: `${pkg.name} confirmed at ${merchant.name}`,
      html,
    });
    await logNotification({
      merchantId: merchant.id,
      clientId: client.id,
      bookingId: null,
      type: "package_purchased",
      channel: "email",
      recipient: client.email,
      messageBody: `Package confirmation for ${pkg.name}`,
      status: ok ? "sent" : "failed",
    });
  }

  console.log("[NotificationWorker] package_purchased handled", { id: cp.id, status });
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
        case "reschedule_confirmation": {
          const data = job.data as BookingConfirmationData;
          await handleRescheduleConfirmation(data.booking_id);
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
        case "post_service_receipt": {
          const data = job.data as PostServiceReceiptData;
          await handlePostServiceReceipt(data.booking_id);
          break;
        }
        case "post_service_rebook": {
          const data = job.data as PostServiceRebookData;
          await handlePostServiceRebook(data.booking_id);
          break;
        }
        case "low_rating_alert": {
          const data = job.data as LowRatingAlertData;
          await handleLowRatingAlert(data.booking_id);
          break;
        }
        case "otp_send": {
          await handleOtpSend(job.data as OtpSendData);
          break;
        }
        case "treatment_quote_issued": {
          await handleTreatmentQuoteIssued(
            (job.data as TreatmentQuoteIssuedData).quote_id,
          );
          break;
        }
        case "treatment_quote_reminder_sweep": {
          await handleTreatmentQuoteReminderSweep();
          break;
        }
        case "package_purchased": {
          await handlePackagePurchased(job.data as PackagePurchasedData);
          break;
        }
        case "appointment_reminder_followup_12h": {
          await handleAppointmentReminderFollowup(
            (job.data as AppointmentReminderData).booking_id,
            "12h",
          );
          break;
        }
        case "appointment_reminder_final_2h": {
          await handleAppointmentReminderFollowup(
            (job.data as AppointmentReminderData).booking_id,
            "2h",
          );
          break;
        }
        case "booking_confirmed_by_client": {
          await handleBookingConfirmedByClient(
            (job.data as { booking_id: string }).booking_id,
          );
          break;
        }
        case "rebook_checkin_30d": {
          await handleRebookCheckin(
            (job.data as { booking_id: string }).booking_id,
          );
          break;
        }
        case "waitlist_match": {
          await handleWaitlistMatch(job.data as WaitlistMatchData);
          break;
        }
        case "waitlist_hold_expire": {
          await handleWaitlistHoldExpire(job.data as WaitlistHoldExpireData);
          break;
        }
        case "waitlist_expire_stale": {
          await handleWaitlistExpireStale();
          break;
        }
        case "waitlist_confirmation": {
          await handleWaitlistConfirmation(job.data as WaitlistConfirmationData);
          break;
        }
        case "waitlist_slot_opened": {
          await handleWaitlistSlotOpened(job.data as WaitlistSlotOpenedData);
          break;
        }
        default:
          console.warn("[NotificationWorker] Unknown job name", { name: job.name });
      }
    },
    {
      connection: {
        url: config.redisUrl,
        retryStrategy: (times: number) => Math.min(times * 2000, 30000),
      },
      prefix: config.queuePrefix,
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
