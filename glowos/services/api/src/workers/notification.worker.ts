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
} from "@glowos/db";
import { sendWhatsApp } from "../lib/twilio.js";
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
    const sid = await sendWhatsApp(data.destination, body);
    if (!sid) {
      throw new Error(`WhatsApp OTP failed for ${data.destination}`);
    }
    console.log("[NotificationWorker] otp_send whatsapp ok", {
      destination: data.destination,
      sid,
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
