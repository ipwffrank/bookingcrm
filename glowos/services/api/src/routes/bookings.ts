import { Hono } from "hono";
import { and, eq, gte, lte, inArray } from "drizzle-orm";
import { z } from "zod";
import { addMinutes, addSeconds, parseISO, startOfDay, endOfDay } from "date-fns";
import {
  db,
  merchants,
  services,
  staff,
  staffServices,
  bookings,
  slotLeases,
  clients,
  clientProfiles,
} from "@glowos/db";
import { requireMerchant } from "../middleware/auth.js";
import { zValidator } from "../middleware/validate.js";
import { getAvailability, invalidateAvailabilityCacheByMerchantId } from "../lib/availability.js";
import { generateBookingToken, verifyBookingToken } from "../lib/jwt.js";
import { normalizePhone, normalizeEmail } from "../lib/normalize.js";
import { isFirstTimerAtMerchant } from "../lib/firstTimerCheck.js";
import { verifyVerificationToken } from "../lib/jwt.js";
import { processRefund } from "../lib/refunds.js";
import { addJob } from "../lib/queue.js";
import {
  scheduleReminder,
  scheduleReviewRequest,
  scheduleNoShowReengagement,
  scheduleRebookingPrompt,
  schedulePostServiceSequence,
} from "../lib/scheduler.js";
import type { AppVariables } from "../lib/types.js";

const bookingsRouter = new Hono<{ Variables: AppVariables }>();

// Separate router for merchant-side booking management, mounted at /merchant/bookings
// This avoids Hono v4 route collision where /:slug wildcard can intercept /merchant literal
export const merchantBookingsRouter = new Hono<{ Variables: AppVariables }>();

// ─── Schemas ───────────────────────────────────────────────────────────────────

const leaseSchema = z.object({
  service_id: z.string().uuid(),
  staff_id: z.string().uuid(),
  start_time: z.string().datetime({ message: "start_time must be an ISO datetime string" }),
});

const confirmSchema = z.object({
  lease_id: z.string().uuid(),
  client_name: z.string().min(1, "Client name is required"),
  client_phone: z.string().min(1, "Client phone is required"),
  client_email: z.string().email().optional(),
  client_id: z.string().uuid().optional(),
  payment_method: z.string().optional(),
  verification_token: z.string().optional(),
  booking_source: z
    .enum([
      "google_reserve",
      "google_gbp_link",
      "direct_widget",
      "instagram",
      "qr_walkin",
      "walkin_manual",
      "embedded_widget",
    ])
    .optional(),
});

const merchantBookingCreateSchema = z.object({
  service_id: z.string().uuid(),
  staff_id: z.string().uuid(),
  client_name: z.string().min(1),
  client_phone: z.string().min(1),
  start_time: z.string().datetime(),
  payment_method: z.string().optional(),
  notes: z.string().optional(),
});

const rescheduleSchema = z.object({
  start_time: z.string().datetime({ message: "start_time must be an ISO datetime string" }),
  end_time: z.string().datetime({ message: "end_time must be an ISO datetime string" }).optional(),
});

// ─── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Find a client by phone, or create one if not found.
 * Phone is normalized to E.164; email is trimmed + lowercased.
 * Throws if the phone cannot be normalized (caller must handle with a 400).
 */
async function findOrCreateClient(
  rawPhone: string,
  name?: string,
  rawEmail?: string,
  defaultCountry: "SG" | "MY" = "SG"
): Promise<{ id: string }> {
  const phone = normalizePhone(rawPhone, defaultCountry);
  if (!phone) throw new Error("Invalid phone number");
  const email = normalizeEmail(rawEmail);

  const [existing] = await db
    .select({ id: clients.id })
    .from(clients)
    .where(eq(clients.phone, phone))
    .limit(1);

  if (existing) {
    if (name || email) {
      await db
        .update(clients)
        .set({
          ...(name ? { name } : {}),
          ...(email ? { email } : {}),
        })
        .where(eq(clients.id, existing.id));
    }
    return existing;
  }

  const [created] = await db
    .insert(clients)
    .values({ phone, name, email })
    .returning({ id: clients.id });

  if (!created) throw new Error("Failed to create client");
  return created;
}

/**
 * Find or create a client_profile for the given merchant + client pair.
 */
async function findOrCreateClientProfile(
  merchantId: string,
  clientId: string
): Promise<{ id: string }> {
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

  if (existing) return existing;

  const [created] = await db
    .insert(clientProfiles)
    .values({ merchantId, clientId })
    .returning({ id: clientProfiles.id });

  if (!created) throw new Error("Failed to create client profile");
  return created;
}

// ─── IMPORTANT: Literal-path routes MUST come before /:slug wildcard routes ──
// Otherwise Hono treats "merchant", "cancel", etc. as a :slug value.

// ─── Public: GET /booking/cancel/:bookingToken ────────────────────────────────

bookingsRouter.get("/cancel/:bookingToken", async (c) => {
  const token = c.req.param("bookingToken")!;

  // Decode the booking ID from the token (without verifying HMAC yet — we need the ID first)
  let bookingId: string;
  try {
    const decoded = JSON.parse(Buffer.from(token, "base64url").toString("utf8")) as {
      bookingId: string;
    };
    bookingId = decoded.bookingId;
  } catch {
    return c.json({ error: "Bad Request", message: "Invalid cancellation token" }, 400);
  }

  // Verify HMAC
  if (!verifyBookingToken(token, bookingId)) {
    return c.json({ error: "Unauthorized", message: "Invalid cancellation token" }, 401);
  }

  // Load booking with related data
  const [row] = await db
    .select({
      booking: bookings,
      merchant: merchants,
      service: services,
    })
    .from(bookings)
    .innerJoin(merchants, eq(bookings.merchantId, merchants.id))
    .innerJoin(services, eq(bookings.serviceId, services.id))
    .where(eq(bookings.id, bookingId))
    .limit(1);

  if (!row) {
    return c.json({ error: "Not Found", message: "Booking not found" }, 404);
  }

  const { booking, merchant, service } = row;

  if (booking.status === "cancelled") {
    return c.json({
      booking,
      merchant_slug: merchant.slug,
      eligible: false,
      reason: "Booking is already cancelled",
      refund_type: "none" as const,
      refund_amount: 0,
    });
  }

  if (booking.status === "completed" || booking.status === "no_show") {
    return c.json({
      booking,
      merchant_slug: merchant.slug,
      eligible: false,
      reason: "Booking cannot be cancelled after completion",
      refund_type: "none" as const,
      refund_amount: 0,
    });
  }

  // Determine refund based on cancellation_policy
  const policy = merchant.cancellationPolicy as {
    free_cancellation_hours?: number;
    late_cancellation_refund_pct?: number;
    no_show_charge?: "full" | "partial" | "none";
  } | null;

  const now = new Date();
  const hoursUntilBooking = (booking.startTime.getTime() - now.getTime()) / (1000 * 60 * 60);
  const price = parseFloat(String(booking.priceSgd));

  let refundType: "full" | "partial" | "none" = "none";
  let refundAmount = 0;
  let refundPercentage = 0;

  if (!policy) {
    // Default: full refund
    refundType = "full";
    refundAmount = price;
    refundPercentage = 100;
  } else if (
    policy.free_cancellation_hours !== undefined &&
    hoursUntilBooking >= policy.free_cancellation_hours
  ) {
    // Cancelled within the free cancellation window → full refund
    refundType = "full";
    refundAmount = price;
    refundPercentage = 100;
  } else if (
    policy.late_cancellation_refund_pct !== undefined &&
    policy.late_cancellation_refund_pct > 0
  ) {
    // Cancelled after free window but before appointment → partial refund
    refundType = "partial";
    refundPercentage = policy.late_cancellation_refund_pct;
    refundAmount = parseFloat(((price * refundPercentage) / 100).toFixed(2));
  }

  return c.json({
    booking,
    service,
    merchant_slug: merchant.slug,
    eligible: true,
    refund_type: refundType,
    refund_amount: refundAmount,
    refund_percentage: refundPercentage,
  });
});

// ─── Public: POST /booking/cancel/:bookingToken ───────────────────────────────

bookingsRouter.post("/cancel/:bookingToken", async (c) => {
  const token = c.req.param("bookingToken")!;

  let bookingId: string;
  try {
    const decoded = JSON.parse(Buffer.from(token, "base64url").toString("utf8")) as {
      bookingId: string;
    };
    bookingId = decoded.bookingId;
  } catch {
    return c.json({ error: "Bad Request", message: "Invalid cancellation token" }, 400);
  }

  if (!verifyBookingToken(token, bookingId)) {
    return c.json({ error: "Unauthorized", message: "Invalid cancellation token" }, 401);
  }

  // Load booking + merchant (need cancellation policy)
  const [row] = await db
    .select({ booking: bookings, merchant: merchants })
    .from(bookings)
    .innerJoin(merchants, eq(bookings.merchantId, merchants.id))
    .where(eq(bookings.id, bookingId))
    .limit(1);

  if (!row) {
    return c.json({ error: "Not Found", message: "Booking not found" }, 404);
  }

  const { booking, merchant } = row;

  if (booking.status === "cancelled") {
    return c.json(
      { error: "Conflict", message: "Booking is already cancelled" },
      409
    );
  }

  if (booking.status === "completed" || booking.status === "no_show") {
    return c.json(
      { error: "Conflict", message: "Cannot cancel a completed or no-show booking" },
      409
    );
  }

  // Determine refund type based on merchant cancellation policy
  const policy = merchant.cancellationPolicy as {
    free_cancellation_hours?: number;
    late_cancellation_refund_pct?: number;
  } | null;

  const now = new Date();
  const hoursUntilBooking = (booking.startTime.getTime() - now.getTime()) / (1000 * 60 * 60);

  let refundType: "full" | "partial" | "none" = "none";
  let refundPercentage = 0;

  if (!policy) {
    // No policy configured — default to full refund
    refundType = "full";
    refundPercentage = 100;
  } else if (
    policy.free_cancellation_hours !== undefined &&
    hoursUntilBooking >= policy.free_cancellation_hours
  ) {
    refundType = "full";
    refundPercentage = 100;
  } else if (
    policy.late_cancellation_refund_pct !== undefined &&
    policy.late_cancellation_refund_pct > 0
  ) {
    refundType = "partial";
    refundPercentage = policy.late_cancellation_refund_pct;
  }

  // Process refund (handles Stripe + DB update + status change)
  // For card payments this issues the Stripe refund; for cash it marks as waived.
  if (booking.paymentMethod === "card" && booking.paymentStatus === "paid") {
    await processRefund(bookingId, refundType, refundPercentage);
    // processRefund already sets status=cancelled, so just set cancelledBy
    await db
      .update(bookings)
      .set({ cancelledBy: "client" })
      .where(eq(bookings.id, bookingId));
  } else {
    // Cash or unpaid — just cancel
    await db
      .update(bookings)
      .set({
        status: "cancelled",
        cancelledAt: new Date(),
        cancelledBy: "client",
        updatedAt: new Date(),
      })
      .where(eq(bookings.id, bookingId))
      .returning();
  }

  await invalidateAvailabilityCacheByMerchantId(booking.merchantId);

  // Queue cancellation notifications
  await addJob("notifications", "cancellation_notification", { booking_id: bookingId });
  await scheduleRebookingPrompt(bookingId);

  // Reload the updated booking to return
  const [updated] = await db
    .select()
    .from(bookings)
    .where(eq(bookings.id, bookingId))
    .limit(1);

  return c.json({
    success: true,
    message: "Booking cancelled successfully",
    booking: updated,
    refund_type: refundType,
    refund_percentage: refundPercentage,
  });
});

// ─── Public: POST /booking/reschedule/:bookingToken ─────────────────────────
// Client self-service reschedule — moves the booking to a new slot, keeps the
// existing Stripe payment intact. Requires a valid slot lease for the new time.

const clientRescheduleSchema = z.object({
  lease_id: z.string().uuid(),
});

bookingsRouter.post(
  "/reschedule/:bookingToken",
  zValidator(clientRescheduleSchema),
  async (c) => {
    const token = c.req.param("bookingToken")!;
    const body = c.get("body") as z.infer<typeof clientRescheduleSchema>;

    let bookingId: string;
    try {
      const decoded = JSON.parse(Buffer.from(token, "base64url").toString("utf8")) as {
        bookingId: string;
      };
      bookingId = decoded.bookingId;
    } catch {
      return c.json({ error: "Bad Request", message: "Invalid token" }, 400);
    }

    if (!verifyBookingToken(token, bookingId)) {
      return c.json({ error: "Unauthorized", message: "Invalid token" }, 401);
    }

    // Load booking
    const [booking] = await db
      .select()
      .from(bookings)
      .where(eq(bookings.id, bookingId))
      .limit(1);

    if (!booking) {
      return c.json({ error: "Not Found", message: "Booking not found" }, 404);
    }

    if (booking.status !== "confirmed") {
      return c.json(
        { error: "Conflict", message: `Cannot reschedule a booking with status: ${booking.status}` },
        409
      );
    }

    // Load and validate the new lease
    const now = new Date();
    const [lease] = await db
      .select()
      .from(slotLeases)
      .where(
        and(
          eq(slotLeases.id, body.lease_id),
          eq(slotLeases.merchantId, booking.merchantId),
          gte(slotLeases.expiresAt, now)
        )
      )
      .limit(1);

    if (!lease) {
      return c.json(
        { error: "Gone", message: "Lease not found or has expired. Please select a new slot." },
        410
      );
    }

    // Move booking to new time/staff
    const [updated] = await db
      .update(bookings)
      .set({
        staffId: lease.staffId,
        startTime: lease.startTime,
        endTime: lease.endTime,
        updatedAt: new Date(),
      })
      .where(eq(bookings.id, bookingId))
      .returning();

    // Delete the used lease
    await db.delete(slotLeases).where(eq(slotLeases.id, lease.id));
    await invalidateAvailabilityCacheByMerchantId(booking.merchantId);

    // Re-schedule the reminder for the new time + send confirmation
    if (updated) {
      await scheduleReminder(updated.id, updated.startTime);
      await addJob("notifications", "reschedule_confirmation", { booking_id: updated.id });
    }

    return c.json({
      success: true,
      message: "Booking rescheduled successfully",
      booking: updated,
    });
  }
);

// ─── Protected: GET /merchant/bookings ────────────────────────────────────────

merchantBookingsRouter.get("/", requireMerchant, async (c) => {
  const merchantId = c.get("merchantId")!;
  const dateParam = c.req.query("date");
  const statusParam = c.req.query("status");
  const staffIdParam = c.req.query("staff_id");

  const conditions = [eq(bookings.merchantId, merchantId)];

  const fromParam = c.req.query("from");
  const toParam = c.req.query("to");

  // from/to range takes priority over single date
  if (fromParam && toParam) {
    const from = new Date(fromParam + "T00:00:00");
    const to = new Date(toParam + "T23:59:59");
    conditions.push(gte(bookings.startTime, from));
    conditions.push(lte(bookings.startTime, to));
  } else if (dateParam) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
      return c.json({ error: "Bad Request", message: "date must be in YYYY-MM-DD format" }, 400);
    }
    const parsedDate = parseISO(dateParam);
    conditions.push(gte(bookings.startTime, startOfDay(parsedDate)));
    conditions.push(lte(bookings.startTime, endOfDay(parsedDate)));
  }

  if (statusParam) {
    conditions.push(eq(bookings.status, statusParam as "confirmed" | "in_progress" | "completed" | "cancelled" | "no_show"));
  }

  if (staffIdParam) {
    conditions.push(eq(bookings.staffId, staffIdParam));
  }

  const clientIdParam = c.req.query("client_id");
  if (clientIdParam) {
    conditions.push(eq(bookings.clientId, clientIdParam));
  }

  const rows = await db
    .select({
      booking: bookings,
      service: services,
      staffMember: staff,
      client: clients,
    })
    .from(bookings)
    .innerJoin(services, eq(bookings.serviceId, services.id))
    .innerJoin(staff, eq(bookings.staffId, staff.id))
    .innerJoin(clients, eq(bookings.clientId, clients.id))
    .where(and(...conditions));

  return c.json({ bookings: rows });
});

// ─── Protected: GET /merchant/bookings/:id ────────────────────────────────────

merchantBookingsRouter.get("/:id", requireMerchant, async (c) => {
  const merchantId = c.get("merchantId")!;
  const bookingId = c.req.param("id")!;

  const [row] = await db
    .select({
      booking: bookings,
      service: services,
      staffMember: staff,
      client: clients,
    })
    .from(bookings)
    .innerJoin(services, eq(bookings.serviceId, services.id))
    .innerJoin(staff, eq(bookings.staffId, staff.id))
    .innerJoin(clients, eq(bookings.clientId, clients.id))
    .where(and(eq(bookings.id, bookingId), eq(bookings.merchantId, merchantId)))
    .limit(1);

  if (!row) {
    return c.json({ error: "Not Found", message: "Booking not found" }, 404);
  }

  return c.json({ booking: row.booking, service: row.service, staff: row.staffMember, client: row.client });
});

// ─── Protected: POST /merchant/bookings ───────────────────────────────────────

merchantBookingsRouter.post(
  "/",
  requireMerchant,
  zValidator(merchantBookingCreateSchema),
  async (c) => {
    const merchantId = c.get("merchantId")!;
    const body = c.get("body") as z.infer<typeof merchantBookingCreateSchema>;

    // Load service
    const [service] = await db
      .select({
        priceSgd: services.priceSgd,
        durationMinutes: services.durationMinutes,
        bufferMinutes: services.bufferMinutes,
      })
      .from(services)
      .where(and(eq(services.id, body.service_id), eq(services.merchantId, merchantId)))
      .limit(1);

    if (!service) {
      return c.json({ error: "Not Found", message: "Service not found" }, 404);
    }

    // Verify staff belongs to merchant
    const [staffMember] = await db
      .select({ id: staff.id })
      .from(staff)
      .where(and(eq(staff.id, body.staff_id), eq(staff.merchantId, merchantId)))
      .limit(1);

    if (!staffMember) {
      return c.json({ error: "Not Found", message: "Staff member not found" }, 404);
    }

    const startTime = parseISO(body.start_time);
    const totalDuration = service.durationMinutes + service.bufferMinutes;
    const endTime = addMinutes(startTime, totalDuration);

    // Find or create client
    let client: { id: string };
    try {
      client = await findOrCreateClient(body.client_phone, body.client_name);
    } catch {
      return c.json(
        { error: "Bad Request", message: "Invalid phone number" },
        400
      );
    }
    await findOrCreateClientProfile(merchantId, client.id);

    const [booking] = await db
      .insert(bookings)
      .values({
        merchantId,
        clientId: client.id,
        serviceId: body.service_id,
        staffId: body.staff_id,
        startTime,
        endTime,
        durationMinutes: service.durationMinutes,
        status: "confirmed",
        priceSgd: service.priceSgd,
        paymentMethod: body.payment_method,
        bookingSource: "walkin_manual",
        commissionRate: "0",
        commissionSgd: "0",
        clientNotes: body.notes,
      })
      .returning();

    if (!booking) {
      return c.json({ error: "Internal Server Error", message: "Failed to create booking" }, 500);
    }

    await invalidateAvailabilityCacheByMerchantId(merchantId);

    const bookingToken = generateBookingToken(booking.id);

    return c.json({ booking, booking_token: bookingToken }, 201);
  }
);

// ─── Protected: PUT /merchant/bookings/:id/check-in ───────────────────────────

merchantBookingsRouter.put("/:id/check-in", requireMerchant, async (c) => {
  const merchantId = c.get("merchantId")!;
  const bookingId = c.req.param("id")!;

  const [existing] = await db
    .select({ id: bookings.id, status: bookings.status })
    .from(bookings)
    .where(and(eq(bookings.id, bookingId), eq(bookings.merchantId, merchantId)))
    .limit(1);

  if (!existing) {
    return c.json({ error: "Not Found", message: "Booking not found" }, 404);
  }

  if (existing.status !== "confirmed") {
    return c.json(
      { error: "Conflict", message: `Cannot check in a booking with status: ${existing.status}` },
      409
    );
  }

  const [updated] = await db
    .update(bookings)
    .set({ status: "in_progress", checkedInAt: new Date(), updatedAt: new Date() })
    .where(and(eq(bookings.id, bookingId), eq(bookings.merchantId, merchantId)))
    .returning();

  return c.json({ booking: updated });
});

// ─── Protected: PUT /merchant/bookings/:id/complete ───────────────────────────

merchantBookingsRouter.put("/:id/complete", requireMerchant, async (c) => {
  const merchantId = c.get("merchantId")!;
  const bookingId = c.req.param("id")!;

  const [existing] = await db
    .select({ id: bookings.id, status: bookings.status })
    .from(bookings)
    .where(and(eq(bookings.id, bookingId), eq(bookings.merchantId, merchantId)))
    .limit(1);

  if (!existing) {
    return c.json({ error: "Not Found", message: "Booking not found" }, 404);
  }

  if (existing.status !== "in_progress") {
    return c.json(
      { error: "Conflict", message: `Cannot complete a booking with status: ${existing.status}` },
      409
    );
  }

  const [updated] = await db
    .update(bookings)
    .set({ status: "completed", completedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(bookings.id, bookingId), eq(bookings.merchantId, merchantId)))
    .returning();

  // Queue post-completion jobs
  await scheduleReviewRequest(bookingId);
  await schedulePostServiceSequence(bookingId);
  await addJob("crm", "update_client_profile", { booking_id: bookingId });
  if (updated) {
    await addJob("vip", "rescore_client", {
      merchant_id: merchantId,
      client_id: updated.clientId,
    });
  }

  return c.json({ booking: updated });
});

// ─── Protected: PUT /merchant/bookings/:id/no-show ────────────────────────────

merchantBookingsRouter.put("/:id/no-show", requireMerchant, async (c) => {
  const merchantId = c.get("merchantId")!;
  const bookingId = c.req.param("id")!;

  const [existing] = await db
    .select({ id: bookings.id, status: bookings.status })
    .from(bookings)
    .where(and(eq(bookings.id, bookingId), eq(bookings.merchantId, merchantId)))
    .limit(1);

  if (!existing) {
    return c.json({ error: "Not Found", message: "Booking not found" }, 404);
  }

  if (existing.status !== "confirmed" && existing.status !== "in_progress") {
    return c.json(
      { error: "Conflict", message: `Cannot mark no-show for booking with status: ${existing.status}` },
      409
    );
  }

  const [updated] = await db
    .update(bookings)
    .set({ status: "no_show", noShowAt: new Date(), updatedAt: new Date() })
    .where(and(eq(bookings.id, bookingId), eq(bookings.merchantId, merchantId)))
    .returning();

  await invalidateAvailabilityCacheByMerchantId(merchantId);

  // Queue no-show re-engagement (24h delay)
  await scheduleNoShowReengagement(bookingId);

  return c.json({ booking: updated });
});

// ─── Protected: PATCH /merchant/bookings/:id/reschedule ──────────────────────

merchantBookingsRouter.patch(
  "/:id/reschedule",
  requireMerchant,
  zValidator(rescheduleSchema),
  async (c) => {
    const merchantId = c.get("merchantId")!;
    const userRole = c.get("userRole");
    const contextStaffId = c.get("staffId");
    const bookingId = c.req.param("id")!;
    const body = c.get("body") as z.infer<typeof rescheduleSchema>;

    const [existing] = await db
      .select()
      .from(bookings)
      .where(and(eq(bookings.id, bookingId), eq(bookings.merchantId, merchantId)))
      .limit(1);

    if (!existing) {
      return c.json({ error: "Not Found", message: "Booking not found" }, 404);
    }

    // Staff can only reschedule their own bookings
    if (userRole === "staff" && existing.staffId !== contextStaffId) {
      return c.json({ error: "Forbidden", message: "You can only reschedule your own bookings" }, 403);
    }

    if (!["confirmed", "in_progress"].includes(existing.status)) {
      return c.json(
        { error: "Conflict", message: `Cannot reschedule a booking with status: ${existing.status}` },
        409
      );
    }

    const newStart = parseISO(body.start_time);
    // If end_time provided use it; otherwise preserve existing duration
    const newEnd = body.end_time
      ? parseISO(body.end_time)
      : new Date(newStart.getTime() + (existing.endTime.getTime() - existing.startTime.getTime()));

    const [updated] = await db
      .update(bookings)
      .set({ startTime: newStart, endTime: newEnd, updatedAt: new Date() })
      .where(and(eq(bookings.id, bookingId), eq(bookings.merchantId, merchantId)))
      .returning();

    await invalidateAvailabilityCacheByMerchantId(merchantId);

    return c.json({ booking: updated });
  }
);

// ─── GET /booking/:slug/staff ──────────────────────────────────────────────────
// Public — returns visible staff with profile fields for the booking widget

bookingsRouter.get("/:slug/staff", async (c) => {
  const slug = c.req.param("slug");

  const [merchant] = await db
    .select()
    .from(merchants)
    .where(eq(merchants.slug, slug))
    .limit(1);

  if (!merchant) {
    return c.json({ error: "Business not found" }, 404);
  }

  const staffList = await db
    .select({
      id: staff.id,
      name: staff.name,
      title: staff.title,
      photoUrl: staff.photoUrl,
      bio: staff.bio,
      specialtyTags: staff.specialtyTags,
      credentials: staff.credentials,
      displayOrder: staff.displayOrder,
      isAnyAvailable: staff.isAnyAvailable,
    })
    .from(staff)
    .where(
      and(
        eq(staff.merchantId, merchant.id),
        eq(staff.isActive, true),
        eq(staff.isPubliclyVisible, true)
      )
    )
    .orderBy(staff.displayOrder);

  return c.json({ staff: staffList });
});

// ─── Public: GET /booking/:slug ────────────────────────────────────────────────
// NOTE: Wildcard /:slug routes MUST be defined AFTER all literal-path routes
// (e.g. /merchant, /cancel) to prevent Hono from matching literal segments as slugs.

bookingsRouter.get("/:slug", async (c) => {
  const slug = c.req.param("slug")!;

  // Guard: reject reserved path segments that should be handled by literal routes
  const reservedPaths = ["merchant", "cancel", "health"];
  if (reservedPaths.includes(slug)) {
    return c.json({ error: "Not Found", message: "Route not found" }, 404);
  }

  const [merchant] = await db
    .select({
      id: merchants.id,
      slug: merchants.slug,
      name: merchants.name,
      description: merchants.description,
      logoUrl: merchants.logoUrl,
      coverPhotoUrl: merchants.coverPhotoUrl,
      phone: merchants.phone,
      addressLine1: merchants.addressLine1,
      addressLine2: merchants.addressLine2,
      postalCode: merchants.postalCode,
      timezone: merchants.timezone,
      stripeAccountId: merchants.stripeAccountId,
      operatingHours: merchants.operatingHours,
    })
    .from(merchants)
    .where(eq(merchants.slug, slug))
    .limit(1);

  if (!merchant) {
    return c.json({ error: "Not Found", message: "Salon not found" }, 404);
  }

  // Active services
  const activeServices = await db
    .select()
    .from(services)
    .where(and(eq(services.merchantId, merchant.id), eq(services.isActive, true)));

  // Active staff
  const activeStaff = await db
    .select()
    .from(staff)
    .where(and(eq(staff.merchantId, merchant.id), eq(staff.isActive, true)));

  // Don't expose the actual stripe account ID to public, just whether payment is enabled
  const { stripeAccountId, ...merchantPublic } = merchant;

  return c.json({
    merchant: { ...merchantPublic, paymentEnabled: !!stripeAccountId },
    services: activeServices,
    staff: activeStaff,
  });
});

// ─── Public: GET /booking/:slug/availability ───────────────────────────────────

bookingsRouter.get("/:slug/availability", async (c) => {
  const slug = c.req.param("slug")!;
  const serviceId = c.req.query("service_id");
  const staffId = c.req.query("staff_id");
  const date = c.req.query("date");

  if (!serviceId || !date) {
    return c.json(
      { error: "Bad Request", message: "service_id and date query params are required" },
      400
    );
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return c.json({ error: "Bad Request", message: "date must be in YYYY-MM-DD format" }, 400);
  }

  try {
    const slots = await getAvailability({
      merchantSlug: slug,
      serviceId,
      staffId: staffId ?? "any",
      date,
    });
    return c.json({ slots });
  } catch (err) {
    console.error("[availability] Error computing availability", err);
    return c.json({ error: "Internal Server Error", message: "Failed to load availability" }, 500);
  }
});

// ─── GET /booking/:slug/next-available ────────────────────────────────────────
// Find the next date with available slots for a given service + staff

bookingsRouter.get("/:slug/next-available", async (c) => {
  const slug = c.req.param("slug")!;
  const serviceId = c.req.query("service_id");
  const staffId = c.req.query("staff_id");
  const afterDate = c.req.query("after"); // YYYY-MM-DD

  if (!serviceId || !afterDate) {
    return c.json({ error: "Bad Request", message: "service_id and after are required" }, 400);
  }

  // Search up to 30 days forward
  const maxDays = 30;
  const startDate = new Date(afterDate + "T00:00:00");

  for (let i = 1; i <= maxDays; i++) {
    const checkDate = new Date(startDate.getTime() + i * 24 * 60 * 60 * 1000);
    const dateStr = checkDate.toISOString().slice(0, 10);

    try {
      const slots = await getAvailability({
        merchantSlug: slug,
        serviceId,
        staffId: staffId || "any",
        date: dateStr,
      });

      if (slots.length > 0) {
        return c.json({
          found: true,
          date: dateStr,
          firstSlot: slots[0].start_time,
          slotsCount: slots.length,
        });
      }
    } catch {
      // Skip dates that error (e.g. invalid)
      continue;
    }
  }

  return c.json({ found: false, message: "No availability in the next 30 days" });
});

// ─── Public: POST /booking/:slug/lease ────────────────────────────────────────

bookingsRouter.post("/:slug/lease", zValidator(leaseSchema), async (c) => {
  const slug = c.req.param("slug")!;
  const body = c.get("body") as z.infer<typeof leaseSchema>;

  // Resolve merchant
  const [merchant] = await db
    .select({ id: merchants.id })
    .from(merchants)
    .where(eq(merchants.slug, slug))
    .limit(1);

  if (!merchant) {
    return c.json({ error: "Not Found", message: "Salon not found" }, 404);
  }

  // Load service for duration
  const [service] = await db
    .select({
      id: services.id,
      durationMinutes: services.durationMinutes,
      bufferMinutes: services.bufferMinutes,
    })
    .from(services)
    .where(and(eq(services.id, body.service_id), eq(services.merchantId, merchant.id)))
    .limit(1);

  if (!service) {
    return c.json({ error: "Not Found", message: "Service not found" }, 404);
  }

  const startTime = parseISO(body.start_time);
  const totalDuration = service.durationMinutes + service.bufferMinutes;
  const endTime = addMinutes(startTime, totalDuration);
  const dateStr = body.start_time.slice(0, 10); // YYYY-MM-DD

  // Verify slot is actually available
  const slots = await getAvailability({
    merchantSlug: slug,
    serviceId: body.service_id,
    staffId: body.staff_id,
    date: dateStr,
  });

  const slotExists = slots.some(
    (s) => s.start_time === startTime.toISOString() && s.staff_id === body.staff_id
  );

  if (!slotExists) {
    return c.json(
      { error: "Conflict", message: "This slot is no longer available" },
      409
    );
  }

  const expiresAt = addSeconds(new Date(), 300); // 5 minutes
  const sessionToken = crypto.randomUUID();

  const [lease] = await db
    .insert(slotLeases)
    .values({
      merchantId: merchant.id,
      staffId: body.staff_id,
      serviceId: body.service_id,
      startTime,
      endTime,
      expiresAt,
      sessionToken,
    })
    .returning();

  if (!lease) {
    return c.json({ error: "Internal Server Error", message: "Failed to create lease" }, 500);
  }

  await invalidateAvailabilityCacheByMerchantId(merchant.id);

  return c.json({ lease_id: lease.id, expires_at: lease.expiresAt }, 201);
});

// ─── Public: DELETE /booking/:slug/lease/:leaseId ─────────────────────────────

bookingsRouter.delete("/:slug/lease/:leaseId", async (c) => {
  const slug = c.req.param("slug")!;
  const leaseId = c.req.param("leaseId")!;

  const [merchant] = await db
    .select({ id: merchants.id })
    .from(merchants)
    .where(eq(merchants.slug, slug))
    .limit(1);

  if (!merchant) {
    return c.json({ error: "Not Found", message: "Salon not found" }, 404);
  }

  const [lease] = await db
    .select({ id: slotLeases.id })
    .from(slotLeases)
    .where(and(eq(slotLeases.id, leaseId), eq(slotLeases.merchantId, merchant.id)))
    .limit(1);

  if (!lease) {
    return c.json({ error: "Not Found", message: "Lease not found" }, 404);
  }

  await db.delete(slotLeases).where(eq(slotLeases.id, leaseId));

  await invalidateAvailabilityCacheByMerchantId(merchant.id);

  return c.json({ success: true, message: "Lease released" });
});

// ─── Public: POST /booking/:slug/confirm ──────────────────────────────────────

bookingsRouter.post("/:slug/confirm", zValidator(confirmSchema), async (c) => {
  const slug = c.req.param("slug")!;
  const body = c.get("body") as z.infer<typeof confirmSchema>;

  // Resolve merchant
  const [merchant] = await db
    .select({ id: merchants.id })
    .from(merchants)
    .where(eq(merchants.slug, slug))
    .limit(1);

  if (!merchant) {
    return c.json({ error: "Not Found", message: "Salon not found" }, 404);
  }

  // Verify lease exists, belongs to merchant, and hasn't expired
  const now = new Date();
  const [lease] = await db
    .select()
    .from(slotLeases)
    .where(
      and(
        eq(slotLeases.id, body.lease_id),
        eq(slotLeases.merchantId, merchant.id),
        gte(slotLeases.expiresAt, now)
      )
    )
    .limit(1);

  if (!lease) {
    return c.json(
      { error: "Gone", message: "Lease not found or has expired. Please select a new slot." },
      410
    );
  }

  // Load service with full discount fields
  const [service] = await db
    .select({
      priceSgd: services.priceSgd,
      durationMinutes: services.durationMinutes,
      discountPct: services.discountPct,
      firstTimerDiscountPct: services.firstTimerDiscountPct,
      firstTimerDiscountEnabled: services.firstTimerDiscountEnabled,
    })
    .from(services)
    .where(eq(services.id, lease.serviceId))
    .limit(1);

  if (!service) {
    return c.json({ error: "Not Found", message: "Service not found" }, 404);
  }

  // Find or create client — use pre-authenticated client_id if provided (Google Sign-In)
  let client: { id: string };
  if (body.client_id) {
    // Verify client exists
    const [existing] = await db
      .select({ id: clients.id })
      .from(clients)
      .where(eq(clients.id, body.client_id))
      .limit(1);
    if (!existing) {
      return c.json({ error: "Not Found", message: "Client not found" }, 404);
    }
    client = existing;
    const normalizedPhone = body.client_phone ? normalizePhone(body.client_phone) : null;
    const normalizedEmail = normalizeEmail(body.client_email);
    await db
      .update(clients)
      .set({
        ...(normalizedPhone ? { phone: normalizedPhone } : {}),
        ...(body.client_name ? { name: body.client_name } : {}),
        ...(normalizedEmail ? { email: normalizedEmail } : {}),
      })
      .where(eq(clients.id, client.id));
  } else {
    try {
      client = await findOrCreateClient(
        body.client_phone,
        body.client_name,
        body.client_email
      );
    } catch {
      return c.json(
        { error: "Bad Request", message: "Invalid phone number" },
        400
      );
    }
  }

  // Find or create client profile for this merchant
  await findOrCreateClientProfile(merchant.id, client.id);

  // Compute final price (regular discount always applies; first-timer requires verification)
  const basePrice = parseFloat(String(service.priceSgd));
  let computedPrice = basePrice;
  if (service.discountPct) {
    computedPrice = basePrice * (1 - service.discountPct / 100);
  }
  if (
    service.firstTimerDiscountEnabled &&
    service.firstTimerDiscountPct &&
    body.verification_token
  ) {
    const token = verifyVerificationToken(body.verification_token);
    if (token) {
      const defaultCountry: "SG" | "MY" = "SG";
      const normalizedPhone = normalizePhone(body.client_phone, defaultCountry);
      const normalizedEmail = normalizeEmail(body.client_email);

      let identityMatches = false;
      switch (token.purpose) {
        case "google_verify": {
          if (body.client_id && token.google_id) {
            const [existing] = await db
              .select({ googleId: clients.googleId })
              .from(clients)
              .where(eq(clients.id, body.client_id))
              .limit(1);
            if (existing?.googleId && existing.googleId === token.google_id) {
              identityMatches = true;
            }
          }
          break;
        }
        case "first_timer_verify": {
          if (token.phone && normalizedPhone && token.phone === normalizedPhone) {
            identityMatches = true;
          }
          break;
        }
        default: {
          // Any other purpose (e.g., "login") is explicitly rejected for discount eligibility.
          console.warn("[first-timer] rejected token with unsupported purpose", {
            purpose: token.purpose,
          });
          break;
        }
      }

      if (identityMatches) {
        const eligible = await isFirstTimerAtMerchant({
          merchantId: merchant.id,
          normalizedPhone,
          normalizedEmail,
          googleId: token.google_id ?? null,
        });
        if (eligible) {
          const ftPrice = basePrice * (1 - service.firstTimerDiscountPct / 100);
          if (ftPrice < computedPrice) computedPrice = ftPrice;
        }
      }
    }
  }

  const priceSgdFinal = computedPrice.toFixed(2);

  // Create booking
  const [booking] = await db
    .insert(bookings)
    .values({
      merchantId: merchant.id,
      clientId: client.id,
      serviceId: lease.serviceId,
      staffId: lease.staffId,
      startTime: lease.startTime,
      endTime: lease.endTime,
      durationMinutes: service.durationMinutes,
      status: "confirmed",
      priceSgd: priceSgdFinal,
      paymentMethod: body.payment_method,
      bookingSource: body.booking_source ?? "direct_widget",
      commissionRate: "0",
      commissionSgd: "0",
    })
    .returning();

  if (!booking) {
    return c.json({ error: "Internal Server Error", message: "Failed to create booking" }, 500);
  }

  // Delete the used lease
  await db.delete(slotLeases).where(eq(slotLeases.id, lease.id));

  await invalidateAvailabilityCacheByMerchantId(merchant.id);

  // Generate cancellation token
  const bookingToken = generateBookingToken(booking.id);

  // Queue post-booking jobs (cash/walk-in bookings)
  await addJob("notifications", "booking_confirmation", { booking_id: booking.id });
  await scheduleReminder(booking.id, booking.startTime);

  return c.json(
    {
      booking,
      booking_token: bookingToken,
      message: "Booking confirmed successfully",
    },
    201
  );
});

export { bookingsRouter };
