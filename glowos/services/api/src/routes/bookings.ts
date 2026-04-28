import { Hono } from "hono";
import { and, eq, gte, lte, inArray, sql, or, desc } from "drizzle-orm";
import { config } from "../lib/config.js";
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
  bookingGroups,
  bookingEdits,
  clientPackages,
  packageSessions,
  loyaltyPrograms,
  loyaltyTransactions,
  merchantUsers,
  notificationLog,
} from "@glowos/db";
import { requireMerchant } from "../middleware/auth.js";
import { zValidator } from "../middleware/validate.js";
import { getAvailability, invalidateAvailabilityCacheByMerchantId } from "../lib/availability.js";
import { generateBookingToken, verifyBookingToken } from "../lib/jwt.js";
import { generateConfirmationToken } from "../lib/confirmation-token.js";
import { normalizePhone, normalizeEmail } from "../lib/normalize.js";
import { findOrCreateClient } from "../lib/findOrCreateClient.js";
import { isFirstTimerAtMerchant } from "../lib/firstTimerCheck.js";
import { verifyVerificationToken } from "../lib/jwt.js";
import { processRefund, restoreLoyaltyOnCancel } from "../lib/refunds.js";
import {
  loadMerchantHoursContext,
  outsideHoursViolation,
} from "../lib/operating-hours-gate.js";
import { findBookingConflict } from "../lib/booking-conflicts.js";
import { writeAuditDiff } from "../lib/booking-edits.js";
import { addJob } from "../lib/queue.js";
import {
  scheduleReminder,
  scheduleReviewRequest,
  scheduleRebookCheckin,
  scheduleNoShowReengagement,
  scheduleRebookingPrompt,
  schedulePostServiceSequence,
} from "../lib/scheduler.js";
import { scheduleWaitlistMatchJob } from "../lib/waitlist-scheduler.js";
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
  secondary_staff_id: z.string().uuid().nullable().optional(),
  client_name: z.string().min(1),
  client_phone: z.string().min(1),
  start_time: z.string().datetime(),
  payment_method: z.string().optional(),
  notes: z.string().optional(),
});

const rescheduleSchema = z.object({
  start_time: z.string().datetime({ message: "start_time must be an ISO datetime string" }),
  end_time: z.string().datetime({ message: "end_time must be an ISO datetime string" }).optional(),
  notify_client: z.boolean().optional().default(true),
  secondary_staff_id: z.string().uuid().nullable().optional(),
});

const patchBookingSchema = z.object({
  service_id: z.string().uuid().optional(),
  staff_id: z.string().uuid().optional(),
  secondary_staff_id: z.string().uuid().nullable().optional(),
  start_time: z.string().datetime().optional(),
  end_time: z.string().datetime().optional(),
  payment_method: z.string().optional(),
  price_sgd: z.number().nonnegative().optional(),
  client_notes: z.string().nullable().optional(),
});

// ─── Helpers ───────────────────────────────────────────────────────────────────

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

  // Restore any loyalty points that were redeemed against this booking.
  // The compensating `adjust` row in loyalty_transactions is the source of
  // truth — booking.loyaltyPointsRedeemed stays set so we keep the trail.
  await restoreLoyaltyOnCancel(bookingId, null);

  await invalidateAvailabilityCacheByMerchantId(booking.merchantId);

  // Queue cancellation notifications
  await addJob("notifications", "cancellation_notification", { booking_id: bookingId });
  await scheduleRebookingPrompt(bookingId);

  // Fire waitlist matcher with the freed slot
  await scheduleWaitlistMatchJob({
    merchant_id: booking.merchantId,
    staff_id: booking.staffId,
    service_id: booking.serviceId,
    freed_start: booking.startTime.toISOString(),
    freed_end: booking.endTime.toISOString(),
    notified_booking_slot_id: booking.id,
  });

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

// ─── Public: GET /booking/confirm/:token ─────────────────────────────────────
// Lookup-only — used by the customer page to fetch booking details before they
// click 'Confirm' (or to render an "already confirmed" state if they already
// did). No state change.

bookingsRouter.get("/confirm/:token", async (c) => {
  const token = c.req.param("token")!;
  if (!token || token.length < 16) {
    return c.json({ error: "Bad Request", message: "Invalid confirmation token" }, 400);
  }
  const [row] = await db
    .select({
      booking: bookings,
      merchant: { name: merchants.name, slug: merchants.slug, logoUrl: merchants.logoUrl },
      service: { name: services.name, durationMinutes: services.durationMinutes },
      staffMember: { name: staff.name },
    })
    .from(bookings)
    .innerJoin(merchants, eq(bookings.merchantId, merchants.id))
    .innerJoin(services, eq(bookings.serviceId, services.id))
    .innerJoin(staff, eq(bookings.staffId, staff.id))
    .where(eq(bookings.confirmationToken, token))
    .limit(1);
  if (!row) {
    return c.json({ error: "Not Found", message: "Confirmation link expired or invalid" }, 404);
  }
  return c.json({
    booking: {
      id: row.booking.id,
      status: row.booking.status,
      startTime: row.booking.startTime,
      endTime: row.booking.endTime,
      priceSgd: row.booking.priceSgd,
      confirmedAt: row.booking.confirmedAt,
    },
    merchant: row.merchant,
    service: row.service,
    staff: row.staffMember,
  });
});

// ─── Public: POST /booking/confirm/:token ────────────────────────────────────
// Customer clicks the WhatsApp/email confirm link and lands on /confirm/:token.
// The page POSTs here, which flips status pending → confirmed and notifies the
// merchant. Idempotent — already-confirmed bookings return success.

bookingsRouter.post("/confirm/:token", async (c) => {
  const token = c.req.param("token")!;
  if (!token || token.length < 16) {
    return c.json({ error: "Bad Request", message: "Invalid confirmation token" }, 400);
  }
  const [row] = await db
    .select()
    .from(bookings)
    .where(eq(bookings.confirmationToken, token))
    .limit(1);
  if (!row) {
    return c.json({ error: "Not Found", message: "Confirmation link expired or invalid" }, 404);
  }
  if (row.status === "cancelled" || row.status === "no_show") {
    return c.json(
      { error: "Conflict", message: `Booking is ${row.status} — cannot confirm` },
      409,
    );
  }
  // Already confirmed (or further along) — idempotent success.
  if (row.status !== "pending") {
    return c.json({ booking: { id: row.id, status: row.status, confirmedAt: row.confirmedAt } });
  }

  const now = new Date();
  await db
    .update(bookings)
    .set({ status: "confirmed", confirmedAt: now, updatedAt: now })
    .where(eq(bookings.id, row.id));

  // Tell the merchant the customer confirmed (WhatsApp + email + dashboard
  // banner via notification_log polling). Handler added in Commit B.
  await addJob("notifications", "booking_confirmed_by_client", {
    booking_id: row.id,
  }).catch((err: unknown) => {
    console.error("[booking-confirm] notify failed", err);
  });

  return c.json({ booking: { id: row.id, status: "confirmed", confirmedAt: now } });
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

// ─── Protected: GET /merchant/bookings/:id/edit-context ───────────────────────

merchantBookingsRouter.get("/:id/edit-context", requireMerchant, async (c) => {
  const merchantId = c.get("merchantId")!;
  const bookingId = c.req.param("id")!;

  const [row] = await db
    .select({
      booking: bookings,
      group: bookingGroups,
    })
    .from(bookings)
    .leftJoin(bookingGroups, eq(bookings.groupId, bookingGroups.id))
    .where(and(eq(bookings.id, bookingId), eq(bookings.merchantId, merchantId)))
    .limit(1);

  if (!row) {
    return c.json({ error: "Not Found", message: "Booking not found" }, 404);
  }

  const siblingBookings = row.group
    ? await db
        .select({ booking: bookings, service: services, staff })
        .from(bookings)
        .innerJoin(services, eq(bookings.serviceId, services.id))
        .innerJoin(staff, eq(bookings.staffId, staff.id))
        .where(eq(bookings.groupId, row.group.id))
    : [{ booking: row.booking }];

  // Active packages for this client
  const activePackages = await db
    .select({
      id: clientPackages.id,
      packageName: clientPackages.packageName,
      sessionsTotal: clientPackages.sessionsTotal,
      sessionsUsed: clientPackages.sessionsUsed,
      expiresAt: clientPackages.expiresAt,
    })
    .from(clientPackages)
    .where(
      and(
        eq(clientPackages.clientId, row.booking.clientId),
        eq(clientPackages.merchantId, merchantId),
        eq(clientPackages.status, "active")
      )
    );

  const pkgIds = activePackages.map((p) => p.id);
  const pendingSessions = pkgIds.length
    ? await db
        .select({
          id: packageSessions.id,
          clientPackageId: packageSessions.clientPackageId,
          serviceId: packageSessions.serviceId,
          sessionNumber: packageSessions.sessionNumber,
        })
        .from(packageSessions)
        .where(
          and(
            inArray(packageSessions.clientPackageId, pkgIds),
            eq(packageSessions.status, "pending")
          )
        )
    : [];

  const allServices = await db
    .select({
      id: services.id,
      name: services.name,
      priceSgd: services.priceSgd,
      durationMinutes: services.durationMinutes,
      bufferMinutes: services.bufferMinutes,
      preBufferMinutes: services.preBufferMinutes,
      postBufferMinutes: services.postBufferMinutes,
    })
    .from(services)
    .where(and(eq(services.merchantId, merchantId), eq(services.isActive, true)));

  const allStaff = await db
    .select({ id: staff.id, name: staff.name })
    .from(staff)
    .where(eq(staff.merchantId, merchantId));

  // Resolve the secondary staff name (if any) for the booking under edit so
  // the form can render it without a second roundtrip.
  const secondaryStaffName = row.booking.secondaryStaffId
    ? allStaff.find((s) => s.id === row.booking.secondaryStaffId)?.name ?? null
    : null;

  // Staff service-eligibility map so the form can filter the per-row staff
  // dropdown to only those who actually perform the selected service.
  const allStaffIds = allStaff.map((s) => s.id);
  const staffServiceLinks =
    allStaffIds.length === 0
      ? []
      : await db
          .select({ staffId: staffServices.staffId, serviceId: staffServices.serviceId })
          .from(staffServices)
          .where(inArray(staffServices.staffId, allStaffIds));
  const serviceIdsByStaff = new Map<string, string[]>();
  for (const link of staffServiceLinks) {
    const arr = serviceIdsByStaff.get(link.staffId) ?? [];
    arr.push(link.serviceId);
    serviceIdsByStaff.set(link.staffId, arr);
  }
  const allStaffWithServices = allStaff.map((s) => ({
    ...s,
    serviceIds: serviceIdsByStaff.get(s.id) ?? [],
  }));

  // Last edit + full client info
  const [lastEdit] = await db
    .select()
    .from(bookingEdits)
    .where(
      row.group
        ? eq(bookingEdits.bookingGroupId, row.group.id)
        : eq(bookingEdits.bookingId, bookingId)
    )
    .orderBy(sql`${bookingEdits.createdAt} DESC`)
    .limit(1);

  const [clientRow] = await db
    .select({ id: clients.id, name: clients.name, phone: clients.phone })
    .from(clients)
    .where(eq(clients.id, row.booking.clientId))
    .limit(1);

  // Resolve the client's profile row for THIS merchant — the loyalty endpoint
  // is keyed by profileId, not clientId. Surfaced here so the booking edit UI
  // can fetch loyalty balance without a second round trip to look it up.
  const [profileRow] = await db
    .select({ id: clientProfiles.id })
    .from(clientProfiles)
    .where(
      and(
        eq(clientProfiles.clientId, row.booking.clientId),
        eq(clientProfiles.merchantId, merchantId),
      ),
    )
    .limit(1);

  return c.json({
    booking: row.booking,
    group: row.group,
    client: clientRow ? { ...clientRow, profileId: profileRow?.id ?? null } : null,
    siblingBookings,
    activePackages: activePackages.map((p) => ({
      ...p,
      pendingSessions: pendingSessions.filter((s) => s.clientPackageId === p.id),
    })),
    services: allServices,
    staff: allStaffWithServices,
    // Convenience fields derived from the booking under edit so the form
    // can render the secondary-staff selector and pre/post buffer hints
    // without joining services itself.
    secondaryStaffId: row.booking.secondaryStaffId,
    secondaryStaffName,
    lastEdit: lastEdit ?? null,
  });
});

// ─── Protected: GET /merchant/bookings/:id/notifications ─────────────────────
// Returns recent notification_log entries for a single booking. Used by:
//   - Booking detail panel: show full notification history
//   - Reschedule polling: confirm WhatsApp/email actually went out
// Scope: same as edit. Staff can only view notifications for their own bookings.

merchantBookingsRouter.get(
  "/:id/notifications",
  requireMerchant,
  async (c) => {
    const merchantId = c.get("merchantId")!;
    const userRole = c.get("userRole");
    const contextStaffId = c.get("staffId");
    const bookingId = c.req.param("id")!;

    const [booking] = await db
      .select({ id: bookings.id, staffId: bookings.staffId })
      .from(bookings)
      .where(and(eq(bookings.id, bookingId), eq(bookings.merchantId, merchantId)))
      .limit(1);

    if (!booking) {
      return c.json({ error: "Not Found", message: "Booking not found" }, 404);
    }

    if (userRole === "staff" && booking.staffId !== contextStaffId) {
      return c.json({ error: "Forbidden", message: "You can only view your own bookings" }, 403);
    }

    const rows = await db
      .select({
        id: notificationLog.id,
        type: notificationLog.type,
        channel: notificationLog.channel,
        recipient: notificationLog.recipient,
        status: notificationLog.status,
        twilioSid: notificationLog.twilioSid,
        messageBody: notificationLog.messageBody,
        // Surfaced in the booking detail Notifications panel so admins can
        // self-diagnose Twilio/SendGrid failures (added 0017).
        errorMessage: notificationLog.errorMessage,
        createdAt: notificationLog.sentAt,
      })
      .from(notificationLog)
      .where(eq(notificationLog.bookingId, bookingId))
      .orderBy(desc(notificationLog.sentAt))
      .limit(50);

    return c.json({ notifications: rows });
  }
);

// ─── Protected: POST /merchant/bookings ───────────────────────────────────────

merchantBookingsRouter.post(
  "/",
  requireMerchant,
  zValidator(merchantBookingCreateSchema),
  async (c) => {
    const merchantId = c.get("merchantId")!;
    const body = c.get("body") as z.infer<typeof merchantBookingCreateSchema>;

    // Operating-hours gate — same rule as the group create path. Single-
    // booking and group-booking endpoints both write into the same bookings
    // table; both need to enforce the same constraint.
    if (body.start_time) {
      const ctx = await loadMerchantHoursContext(merchantId);
      if (!ctx.operatingHours || Object.keys(ctx.operatingHours).length === 0) {
        return c.json(
          {
            error: "Forbidden",
            message:
              "Operating hours are not configured for this merchant. Set them in Settings → Operating Hours first.",
          },
          403,
        );
      }
      const v = outsideHoursViolation(body.start_time, ctx.operatingHours, ctx.timezone);
      if (v === "closed") {
        return c.json(
          { error: "Forbidden", message: "Booking falls on a day the merchant is closed." },
          403,
        );
      }
      if (v === "outside") {
        return c.json(
          { error: "Forbidden", message: "Booking is outside operating hours." },
          403,
        );
      }
    }

    // Load merchant (for country → phone normalization default)
    const [merchant] = await db
      .select({ country: merchants.country })
      .from(merchants)
      .where(eq(merchants.id, merchantId))
      .limit(1);

    if (!merchant) {
      return c.json({ error: "Not Found", message: "Merchant not found" }, 404);
    }

    // Load service
    const [service] = await db
      .select({
        priceSgd: services.priceSgd,
        durationMinutes: services.durationMinutes,
        bufferMinutes: services.bufferMinutes,
        preBufferMinutes: services.preBufferMinutes,
        postBufferMinutes: services.postBufferMinutes,
      })
      .from(services)
      .where(and(eq(services.id, body.service_id), eq(services.merchantId, merchantId)))
      .limit(1);

    if (!service) {
      return c.json({ error: "Not Found", message: "Service not found" }, 404);
    }

    // Verify staff belongs to merchant — primary always; secondary if set.
    const requiredStaffIds = [body.staff_id];
    if (body.secondary_staff_id) requiredStaffIds.push(body.secondary_staff_id);
    const staffRows = await db
      .select({ id: staff.id })
      .from(staff)
      .where(and(inArray(staff.id, requiredStaffIds), eq(staff.merchantId, merchantId)));

    if (staffRows.length !== requiredStaffIds.length) {
      return c.json({ error: "Not Found", message: "Staff member not found" }, 404);
    }

    // Reject secondary on services with no buffers — there's no window for
    // the secondary to own.
    if (
      body.secondary_staff_id &&
      service.preBufferMinutes === 0 &&
      service.postBufferMinutes === 0
    ) {
      return c.json(
        {
          error: "Bad Request",
          message:
            "Secondary staff requires the service to have pre or post buffer minutes",
        },
        400,
      );
    }

    const startTime = parseISO(body.start_time);
    const totalDuration =
      service.preBufferMinutes +
      service.durationMinutes +
      service.bufferMinutes +
      service.postBufferMinutes;
    const endTime = addMinutes(startTime, totalDuration);

    // Find or create client
    let client: { id: string };
    try {
      client = await findOrCreateClient(
        body.client_phone,
        body.client_name,
        undefined,
        merchant.country
      );
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
        secondaryStaffId: body.secondary_staff_id ?? null,
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

// ─── Protected: PUT /merchant/bookings/:id/confirm ────────────────────────────
// Admin/staff confirms a pending booking on behalf of the client. Stamps
// confirmedAt and skips the merchant-side WhatsApp/email alert (the merchant
// is the one doing the confirming, no point notifying themselves).

merchantBookingsRouter.put("/:id/confirm", requireMerchant, async (c) => {
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
  if (existing.status === "cancelled" || existing.status === "no_show") {
    return c.json(
      { error: "Conflict", message: `Cannot confirm a booking with status: ${existing.status}` },
      409,
    );
  }
  if (existing.status !== "pending") {
    // Already confirmed or further along — idempotent success.
    return c.json({ booking: { id: existing.id, status: existing.status } });
  }

  const now = new Date();
  const [updated] = await db
    .update(bookings)
    .set({ status: "confirmed", confirmedAt: now, updatedAt: now })
    .where(and(eq(bookings.id, bookingId), eq(bookings.merchantId, merchantId)))
    .returning();

  return c.json({ booking: updated });
});

// ─── Protected: PUT /merchant/bookings/:id/check-in ───────────────────────────
// Pending bookings are confirmed implicitly when staff check the customer in
// (they're physically at the counter — that IS the confirmation).

merchantBookingsRouter.put("/:id/check-in", requireMerchant, async (c) => {
  const merchantId = c.get("merchantId")!;
  const bookingId = c.req.param("id")!;

  const [existing] = await db
    .select({ id: bookings.id, status: bookings.status, confirmedAt: bookings.confirmedAt })
    .from(bookings)
    .where(and(eq(bookings.id, bookingId), eq(bookings.merchantId, merchantId)))
    .limit(1);

  if (!existing) {
    return c.json({ error: "Not Found", message: "Booking not found" }, 404);
  }

  if (existing.status !== "confirmed" && existing.status !== "pending") {
    return c.json(
      { error: "Conflict", message: `Cannot check in a booking with status: ${existing.status}` },
      409
    );
  }

  const now = new Date();
  // If still pending, stamp confirmedAt at check-in so the audit trail is
  // honest about when the booking was implicitly confirmed.
  const setData: { status: "in_progress"; checkedInAt: Date; updatedAt: Date; confirmedAt?: Date } = {
    status: "in_progress",
    checkedInAt: now,
    updatedAt: now,
  };
  if (existing.status === "pending" && !existing.confirmedAt) {
    setData.confirmedAt = now;
  }

  const [updated] = await db
    .update(bookings)
    .set(setData)
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
  await scheduleRebookCheckin(bookingId);
  await addJob("crm", "update_client_profile", { booking_id: bookingId });
  if (updated) {
    await addJob("vip", "rescore_client", {
      merchant_id: merchantId,
      client_id: updated.clientId,
    });
  }

  // ── Loyalty auto-earn ─────────────────────────────────────────────────────
  // Fire-and-forget: earning failures must never block booking completion.
  if (updated?.clientId && updated.priceSgd) {
    (async () => {
      try {
        const [program] = await db
          .select()
          .from(loyaltyPrograms)
          .where(eq(loyaltyPrograms.merchantId, merchantId))
          .limit(1);

        if (program?.enabled) {
          const priceSgd = parseFloat(updated.priceSgd);
          if (priceSgd > 0) {
            const earned =
              Math.floor(priceSgd * program.pointsPerDollar) + program.pointsPerVisit;
            if (earned > 0) {
              const expiresAt =
                program.earnExpiryMonths > 0
                  ? new Date(
                      Date.now() +
                        program.earnExpiryMonths * 30 * 24 * 60 * 60 * 1000,
                    )
                  : null;
              await db.insert(loyaltyTransactions).values({
                merchantId,
                clientId: updated.clientId,
                kind: "earn",
                amount: earned,
                earnedFromSgd: updated.priceSgd,
                bookingId,
                reason: "Earned from booking",
                expiresAt: expiresAt ?? undefined,
                createdAt: new Date(),
              });
            }
          }
        }
      } catch (err) {
        console.error("[loyalty] auto-earn failed for booking", bookingId, err);
      }
    })();
  }

  return c.json({ booking: updated });
});

// ─── Protected: POST /merchant/bookings/:id/apply-loyalty-redemption ──────────
// Owner / manager / staff can apply a redemption at checkout time.
// Re-applying a redemption is not supported in this Phase 2 PR — the user
// must call /remove-loyalty-redemption first and then re-apply.

const applyRedemptionSchema = z.object({
  points: z.number().int().positive("points must be positive"),
}).strict();

merchantBookingsRouter.post(
  "/:id/apply-loyalty-redemption",
  requireMerchant,
  zValidator(applyRedemptionSchema),
  async (c) => {
    const role = c.get("userRole");
    if (!role || !["owner", "manager", "staff"].includes(role)) {
      return c.json({ error: "Forbidden", message: "Owner, manager, or staff only" }, 403);
    }

    const merchantId = c.get("merchantId")!;
    const userId = c.get("userId")!;
    const bookingId = c.req.param("id")!;
    const body = c.get("body") as z.infer<typeof applyRedemptionSchema>;

    const [existing] = await db
      .select()
      .from(bookings)
      .where(and(eq(bookings.id, bookingId), eq(bookings.merchantId, merchantId)))
      .limit(1);

    if (!existing) {
      return c.json({ error: "Not Found", message: "Booking not found" }, 404);
    }

    if (
      existing.status === "completed" ||
      existing.status === "cancelled" ||
      existing.status === "no_show"
    ) {
      return c.json(
        {
          error: "Conflict",
          message: `Cannot apply loyalty redemption to a booking with status: ${existing.status}`,
        },
        409,
      );
    }

    // Pending pre-bookings can't redeem yet — redemption is intentionally
    // gated to the check-in moment so the balance is fresh and cancellations
    // don't require unwinding a discount. Frontend hides the apply UI in
    // this state; this is the server-side enforcement.
    if (existing.status === "pending") {
      return c.json(
        {
          error: "Conflict",
          message:
            "Redemption opens at check-in — confirm or check the booking in first",
        },
        409,
      );
    }

    if (!existing.clientId) {
      return c.json(
        { error: "Conflict", message: "Booking has no client attached" },
        409,
      );
    }

    if ((existing.loyaltyPointsRedeemed ?? 0) > 0) {
      return c.json(
        {
          error: "Conflict",
          message: "Booking already has a loyalty redemption — remove it before re-applying",
        },
        409,
      );
    }

    const [program] = await db
      .select()
      .from(loyaltyPrograms)
      .where(eq(loyaltyPrograms.merchantId, merchantId))
      .limit(1);

    if (!program || !program.enabled) {
      return c.json({ error: "Conflict", message: "Loyalty program is not enabled" }, 409);
    }

    if (body.points < program.minRedeemPoints) {
      return c.json(
        {
          error: "Conflict",
          message: `Minimum redemption is ${program.minRedeemPoints} points`,
        },
        409,
      );
    }

    const [balanceRow] = await db
      .select({ balance: sql<string>`coalesce(sum(${loyaltyTransactions.amount}), 0)` })
      .from(loyaltyTransactions)
      .where(
        and(
          eq(loyaltyTransactions.merchantId, merchantId),
          eq(loyaltyTransactions.clientId, existing.clientId),
        ),
      )
      .limit(1);
    const currentBalance = Number(balanceRow?.balance ?? 0);

    if (body.points > currentBalance) {
      return c.json(
        {
          error: "Conflict",
          message: `Insufficient balance. Have ${currentBalance} points, requested ${body.points}`,
        },
        409,
      );
    }

    const sgdValue = body.points / program.pointsPerDollarRedeem;
    const bookingTotal = parseFloat(existing.priceSgd);
    if (sgdValue > bookingTotal) {
      return c.json(
        {
          error: "Conflict",
          message: `Redemption (SGD ${sgdValue.toFixed(2)}) exceeds booking total (SGD ${bookingTotal.toFixed(2)})`,
        },
        409,
      );
    }

    const sgdValueStr = sgdValue.toFixed(2);

    const [actor] = await db
      .select({ name: merchantUsers.name })
      .from(merchantUsers)
      .where(eq(merchantUsers.id, userId))
      .limit(1);

    const result = await db.transaction(async (tx) => {
      const [insertedTx] = await tx
        .insert(loyaltyTransactions)
        .values({
          merchantId,
          clientId: existing.clientId,
          kind: "redeem",
          amount: -body.points,
          redeemedSgd: sgdValueStr,
          bookingId,
          reason: "Redeemed at booking checkout",
          actorUserId: userId,
          actorName: actor?.name ?? null,
          createdAt: new Date(),
        })
        .returning();

      const [updatedBooking] = await tx
        .update(bookings)
        .set({
          discountSgd: sgdValueStr,
          loyaltyPointsRedeemed: body.points,
          loyaltyRedemptionTxId: insertedTx.id,
          updatedAt: new Date(),
        })
        .where(and(eq(bookings.id, bookingId), eq(bookings.merchantId, merchantId)))
        .returning();

      return { tx: insertedTx, booking: updatedBooking };
    });

    const newBalance = currentBalance - body.points;

    return c.json({
      booking: result.booking,
      transaction: result.tx,
      newBalance,
    });
  },
);

// ─── Protected: POST /merchant/bookings/:id/remove-loyalty-redemption ─────────
// Inserts a compensating `adjust` row that restores the redeemed points and
// zeros the redemption columns on the booking. Disallowed once the booking is
// completed (payment has already been taken at the discounted total).

merchantBookingsRouter.post(
  "/:id/remove-loyalty-redemption",
  requireMerchant,
  async (c) => {
    const role = c.get("userRole");
    if (!role || !["owner", "manager", "staff"].includes(role)) {
      return c.json({ error: "Forbidden", message: "Owner, manager, or staff only" }, 403);
    }

    const merchantId = c.get("merchantId")!;
    const userId = c.get("userId")!;
    const bookingId = c.req.param("id")!;

    const [existing] = await db
      .select()
      .from(bookings)
      .where(and(eq(bookings.id, bookingId), eq(bookings.merchantId, merchantId)))
      .limit(1);

    if (!existing) {
      return c.json({ error: "Not Found", message: "Booking not found" }, 404);
    }

    if (existing.status === "completed") {
      return c.json(
        {
          error: "Conflict",
          message: "Cannot remove loyalty redemption from a completed booking",
        },
        409,
      );
    }

    if ((existing.loyaltyPointsRedeemed ?? 0) <= 0) {
      return c.json(
        { error: "Conflict", message: "Booking has no loyalty redemption to remove" },
        409,
      );
    }

    const originalPoints = existing.loyaltyPointsRedeemed;
    const originalTxId = existing.loyaltyRedemptionTxId;

    const [actor] = await db
      .select({ name: merchantUsers.name })
      .from(merchantUsers)
      .where(eq(merchantUsers.id, userId))
      .limit(1);

    const result = await db.transaction(async (tx) => {
      await tx
        .insert(loyaltyTransactions)
        .values({
          merchantId,
          clientId: existing.clientId,
          kind: "adjust",
          amount: originalPoints,
          bookingId,
          reason: `Reversed booking redemption${originalTxId ? ` (tx ${originalTxId})` : ""}`,
          actorUserId: userId,
          actorName: actor?.name ?? null,
          createdAt: new Date(),
        })
        .returning();

      const [updatedBooking] = await tx
        .update(bookings)
        .set({
          discountSgd: "0",
          loyaltyPointsRedeemed: 0,
          loyaltyRedemptionTxId: null,
          updatedAt: new Date(),
        })
        .where(and(eq(bookings.id, bookingId), eq(bookings.merchantId, merchantId)))
        .returning();

      return { booking: updatedBooking };
    });

    const [balanceRow] = await db
      .select({ balance: sql<string>`coalesce(sum(${loyaltyTransactions.amount}), 0)` })
      .from(loyaltyTransactions)
      .where(
        and(
          eq(loyaltyTransactions.merchantId, merchantId),
          eq(loyaltyTransactions.clientId, existing.clientId),
        ),
      )
      .limit(1);
    const newBalance = Number(balanceRow?.balance ?? 0);

    return c.json({ booking: result.booking, newBalance });
  },
);

// ─── Protected: PUT /merchant/bookings/:id/no-show ────────────────────────────

merchantBookingsRouter.put("/:id/no-show", requireMerchant, async (c) => {
  const merchantId = c.get("merchantId")!;
  const bookingId = c.req.param("id")!;

  const [existing] = await db
    .select({
      id: bookings.id,
      status: bookings.status,
      priceSgd: bookings.priceSgd,
    })
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

  // Load merchant's cancellation policy to compute the retained amount.
  const [merchant] = await db
    .select({ cancellationPolicy: merchants.cancellationPolicy })
    .from(merchants)
    .where(eq(merchants.id, merchantId))
    .limit(1);

  const policy = (merchant?.cancellationPolicy ?? null) as
    | { no_show_charge?: "full" | "partial" | "none" }
    | null;
  const charge = policy?.no_show_charge ?? "full";
  const refundPct = charge === "full" ? 0 : charge === "partial" ? 50 : 100;
  const refundAmountSgd = ((Number(existing.priceSgd) * refundPct) / 100).toFixed(2);

  const [updated] = await db
    .update(bookings)
    .set({
      status: "no_show",
      noShowAt: new Date(),
      refundAmountSgd,
      updatedAt: new Date(),
    })
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

    // Operating-hours gate — reschedule moves start_time; the new time has
    // to still fall inside hours.
    if (body.start_time) {
      const ctx = await loadMerchantHoursContext(merchantId);
      if (!ctx.operatingHours || Object.keys(ctx.operatingHours).length === 0) {
        return c.json(
          {
            error: "Forbidden",
            message:
              "Operating hours are not configured for this merchant. Set them in Settings → Operating Hours first.",
          },
          403,
        );
      }
      const v = outsideHoursViolation(body.start_time, ctx.operatingHours, ctx.timezone);
      if (v === "closed") {
        return c.json(
          { error: "Forbidden", message: "New time falls on a day the merchant is closed." },
          403,
        );
      }
      if (v === "outside") {
        return c.json(
          { error: "Forbidden", message: "New time is outside operating hours." },
          403,
        );
      }
    }

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

    // Optionally update the secondary staff assignment. When the field is
    // omitted, leave the existing value untouched. When explicitly set
    // (including null), validate ownership + buffer presence.
    let newSecondaryStaffId: string | null = existing.secondaryStaffId;
    if (body.secondary_staff_id !== undefined) {
      newSecondaryStaffId = body.secondary_staff_id;
      if (newSecondaryStaffId) {
        const [sec] = await db
          .select({ id: staff.id })
          .from(staff)
          .where(and(eq(staff.id, newSecondaryStaffId), eq(staff.merchantId, merchantId)))
          .limit(1);
        if (!sec) {
          return c.json({ error: "Not Found", message: "Secondary staff not found" }, 404);
        }
        const [svc] = await db
          .select({
            preBufferMinutes: services.preBufferMinutes,
            postBufferMinutes: services.postBufferMinutes,
          })
          .from(services)
          .where(eq(services.id, existing.serviceId))
          .limit(1);
        if (svc && svc.preBufferMinutes === 0 && svc.postBufferMinutes === 0) {
          return c.json(
            {
              error: "Bad Request",
              message:
                "Secondary staff requires the service to have pre or post buffer minutes",
            },
            400,
          );
        }
      }
    }

    // Capture pre-update slot times for the waitlist matcher (the freed slot)
    const oldStart = existing.startTime;
    const oldEnd = existing.endTime;

    const [updated] = await db
      .update(bookings)
      .set({
        startTime: newStart,
        endTime: newEnd,
        secondaryStaffId: newSecondaryStaffId,
        updatedAt: new Date(),
      })
      .where(and(eq(bookings.id, bookingId), eq(bookings.merchantId, merchantId)))
      .returning();

    await invalidateAvailabilityCacheByMerchantId(merchantId);

    // Fire waitlist matcher with the old (freed) slot times
    await scheduleWaitlistMatchJob({
      merchant_id: existing.merchantId,
      staff_id: existing.staffId,
      service_id: existing.serviceId,
      freed_start: oldStart.toISOString(),
      freed_end: oldEnd.toISOString(),
      notified_booking_slot_id: existing.id,
    });

    // Notify the client of the new time. Worker selects email + WhatsApp
    // channels per client.preferredContactChannel and renders the
    // `reschedule_confirmation` template (already registered in
    // notification.worker.ts). Carry the previous start_time so the
    // template can show "moved from X to Y".
    // Schema default is `true`; the explicit check keeps legacy callers
    // (no `notify_client` field) sending while letting the calendar drag-
    // drop modal pass `notify_client: false` to suppress the message.
    if (body.notify_client !== false) {
      await addJob("notifications", "reschedule_confirmation", {
        booking_id: bookingId,
        previous_start_time: oldStart.toISOString(),
      });
    }

    return c.json({ booking: updated });
  }
);

// ─── Protected: PATCH /merchant/bookings/:id (general edit) ────────────────────

merchantBookingsRouter.patch(
  "/:id",
  requireMerchant,
  zValidator(patchBookingSchema),
  async (c) => {
    const merchantId = c.get("merchantId")!;
    const userId = c.get("userId")!;
    const userRole = c.get("userRole") as "owner" | "manager" | "staff";
    const bookingId = c.req.param("id")!;
    const body = c.get("body") as z.infer<typeof patchBookingSchema>;

    const [existing] = await db
      .select()
      .from(bookings)
      .where(and(eq(bookings.id, bookingId), eq(bookings.merchantId, merchantId)))
      .limit(1);
    if (!existing) {
      return c.json({ error: "Not Found", message: "Booking not found" }, 404);
    }
    if (existing.status === "cancelled") {
      return c.json(
        { error: "Conflict", message: "Cannot edit a cancelled booking" },
        409
      );
    }

    // Operating-hours gate — when start_time is being moved, the new time
    // must still fall inside the merchant's stated hours. Closes the
    // create-then-edit-to-out-of-hours bypass.
    if (body.start_time) {
      const ctx = await loadMerchantHoursContext(merchantId);
      if (!ctx.operatingHours || Object.keys(ctx.operatingHours).length === 0) {
        return c.json(
          {
            error: "Forbidden",
            message:
              "Operating hours are not configured for this merchant. Set them in Settings → Operating Hours first.",
          },
          403,
        );
      }
      const v = outsideHoursViolation(body.start_time, ctx.operatingHours, ctx.timezone);
      if (v === "closed") {
        return c.json(
          { error: "Forbidden", message: "New time falls on a day the merchant is closed." },
          403,
        );
      }
      if (v === "outside") {
        return c.json(
          { error: "Forbidden", message: "New time is outside operating hours." },
          403,
        );
      }
    }

    // If staff_id is changing, verify the new staff belongs to this merchant
    if (body.staff_id && body.staff_id !== existing.staffId) {
      const [staffMember] = await db
        .select({ id: staff.id })
        .from(staff)
        .where(and(eq(staff.id, body.staff_id), eq(staff.merchantId, merchantId)))
        .limit(1);
      if (!staffMember) {
        return c.json({ error: "Not Found", message: "Staff member not found" }, 404);
      }
    }

    // Resolve service (for duration + buffers).
    let durationMinutes = existing.durationMinutes;
    let newEndTime = existing.endTime;
    let effectivePrice = existing.priceSgd;
    let svcPreBuffer = 0;
    let svcPostBuffer = 0;
    let svcLegacyBuffer = 0;
    // Always load buffers for the *effective* service so conflict checks
    // and validation use the right windows even when service_id is unchanged.
    {
      const targetServiceId = body.service_id ?? existing.serviceId;
      const [svc] = await db
        .select({
          priceSgd: services.priceSgd,
          durationMinutes: services.durationMinutes,
          bufferMinutes: services.bufferMinutes,
          preBufferMinutes: services.preBufferMinutes,
          postBufferMinutes: services.postBufferMinutes,
        })
        .from(services)
        .where(and(eq(services.id, targetServiceId), eq(services.merchantId, merchantId)))
        .limit(1);
      if (!svc) {
        return c.json({ error: "Not Found", message: "Service not found" }, 404);
      }
      svcPreBuffer = svc.preBufferMinutes;
      svcPostBuffer = svc.postBufferMinutes;
      svcLegacyBuffer = svc.bufferMinutes;
      if (body.service_id && body.service_id !== existing.serviceId) {
        durationMinutes = svc.durationMinutes;
        const baseStart = body.start_time ? parseISO(body.start_time) : existing.startTime;
        newEndTime = addMinutes(
          baseStart,
          svc.preBufferMinutes +
            svc.durationMinutes +
            svc.bufferMinutes +
            svc.postBufferMinutes,
        );
        effectivePrice = svc.priceSgd;
      }
    }
    if (body.price_sgd !== undefined) effectivePrice = body.price_sgd.toFixed(2);

    const newStart = body.start_time ? parseISO(body.start_time) : existing.startTime;
    if (body.end_time) newEndTime = parseISO(body.end_time);
    const newStaffId = body.staff_id ?? existing.staffId;

    // Resolve secondary staff assignment. Optional + nullable: omitted = keep
    // existing; explicit null = clear; explicit uuid = set + validate.
    let newSecondaryStaffId: string | null = existing.secondaryStaffId;
    if (body.secondary_staff_id !== undefined) {
      newSecondaryStaffId = body.secondary_staff_id;
      if (newSecondaryStaffId) {
        const [sec] = await db
          .select({ id: staff.id })
          .from(staff)
          .where(and(eq(staff.id, newSecondaryStaffId), eq(staff.merchantId, merchantId)))
          .limit(1);
        if (!sec) {
          return c.json({ error: "Not Found", message: "Secondary staff not found" }, 404);
        }
        if (svcPreBuffer === 0 && svcPostBuffer === 0) {
          return c.json(
            {
              error: "Bad Request",
              message:
                "Secondary staff requires the service to have pre or post buffer minutes",
            },
            400,
          );
        }
      }
    }

    const staffOrTimeChanged =
      newStaffId !== existing.staffId ||
      newSecondaryStaffId !== existing.secondaryStaffId ||
      newStart.getTime() !== existing.startTime.getTime() ||
      newEndTime.getTime() !== existing.endTime.getTime();
    if (staffOrTimeChanged) {
      const conflict = await findBookingConflict({
        merchantId,
        candidate: {
          staffId: newStaffId,
          secondaryStaffId: newSecondaryStaffId,
          startTime: newStart,
          // Legacy bufferMinutes is shared/extra time blocking the primary;
          // lump it into the primary window.
          serviceDurationMinutes: durationMinutes + svcLegacyBuffer,
          preBufferMinutes: svcPreBuffer,
          postBufferMinutes: svcPostBuffer,
        },
        excludeBookingIds: [bookingId],
      });
      if (conflict) {
        return c.json(
          { error: "Conflict", message: "Staff double-booked", ...conflict },
          409
        );
      }
    }

    // Commission fields are intentionally left untouched (locked at completion
    // per spec). No review-request or no-show job is queued here either —
    // those fire once at completion, not on subsequent edits.
    await db.transaction(async (tx) => {
      const newValues = {
        serviceId: body.service_id ?? existing.serviceId,
        staffId: newStaffId,
        secondaryStaffId: newSecondaryStaffId,
        startTime: newStart,
        endTime: newEndTime,
        durationMinutes,
        priceSgd: effectivePrice,
        paymentMethod: body.payment_method ?? existing.paymentMethod,
        clientNotes: body.client_notes === undefined ? existing.clientNotes : body.client_notes,
      };

      await writeAuditDiff(
        { userId, userRole, bookingId },
        {
          serviceId: existing.serviceId,
          staffId: existing.staffId,
          secondaryStaffId: existing.secondaryStaffId,
          startTime: existing.startTime,
          endTime: existing.endTime,
          priceSgd: existing.priceSgd,
          paymentMethod: existing.paymentMethod,
          clientNotes: existing.clientNotes,
        },
        newValues,
        tx
      );

      await tx
        .update(bookings)
        .set({ ...newValues, updatedAt: new Date() })
        .where(eq(bookings.id, bookingId));
    });

    await invalidateAvailabilityCacheByMerchantId(merchantId);
    return c.json({ success: true });
  }
);

// ─── Protected: GET /merchant/bookings/:id/edits (audit trail) ────────────────

merchantBookingsRouter.get("/:id/edits", requireMerchant, async (c) => {
  const merchantId = c.get("merchantId")!;
  const bookingId = c.req.param("id")!;

  const [existing] = await db
    .select({ id: bookings.id, groupId: bookings.groupId })
    .from(bookings)
    .where(and(eq(bookings.id, bookingId), eq(bookings.merchantId, merchantId)))
    .limit(1);
  if (!existing) {
    return c.json({ error: "Not Found", message: "Booking not found" }, 404);
  }

  const rows = await db
    .select()
    .from(bookingEdits)
    .where(
      existing.groupId
        ? or(
            eq(bookingEdits.bookingId, bookingId),
            eq(bookingEdits.bookingGroupId, existing.groupId)
          )!
        : eq(bookingEdits.bookingId, bookingId)
    )
    .orderBy(sql`${bookingEdits.createdAt} DESC`);

  return c.json({ edits: rows });
});

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
      country: merchants.country,
      stripeAccountId: merchants.stripeAccountId,
      paymentGateway: merchants.paymentGateway,
      ipay88MerchantCode: merchants.ipay88MerchantCode,
      operatingHours: merchants.operatingHours,
    })
    .from(merchants)
    .where(eq(merchants.slug, slug))
    .limit(1);

  if (!merchant) {
    return c.json({ error: "Not Found", message: "Salon not found" }, 404);
  }

  // Active, publicly visible services. Package-only add-ons (like "Nail art
  // per nail") are flagged visible_on_booking_page = false so they don't
  // appear in the customer's standalone service list.
  const activeServices = await db
    .select()
    .from(services)
    .where(
      and(
        eq(services.merchantId, merchant.id),
        eq(services.isActive, true),
        eq(services.visibleOnBookingPage, true),
      ),
    );

  // Active, publicly visible staff. `is_any_available` is an eligibility flag
  // (can this staff receive bookings when a customer picks "Any Available"?)
  // — NOT a visibility flag. Every real staff shows by name regardless, and a
  // synthetic "Any Available" entry is prepended client-side. To exclude the
  // synthetic placeholder staff row that seed data sometimes creates, the
  // merchant sets that row's is_publicly_visible = false.
  const activeStaff = await db
    .select()
    .from(staff)
    .where(
      and(
        eq(staff.merchantId, merchant.id),
        eq(staff.isActive, true),
        eq(staff.isPubliclyVisible, true),
      ),
    );

  // Pull the staff_services links so the widget can filter staff to those who
  // actually perform the selected service. Avoids a separate roundtrip per
  // service selection.
  const staffIdSet = activeStaff.map((s) => s.id);
  const links =
    staffIdSet.length === 0
      ? []
      : await db
          .select({ staffId: staffServices.staffId, serviceId: staffServices.serviceId })
          .from(staffServices)
          .where(inArray(staffServices.staffId, staffIdSet));
  const serviceIdsByStaff = new Map<string, string[]>();
  for (const link of links) {
    const arr = serviceIdsByStaff.get(link.staffId) ?? [];
    arr.push(link.serviceId);
    serviceIdsByStaff.set(link.staffId, arr);
  }
  const staffWithServices = activeStaff.map((s) => ({
    ...s,
    serviceIds: serviceIdsByStaff.get(s.id) ?? [],
  }));

  // Don't expose the actual stripe account ID or iPay88 credentials to public,
  // just whether online payment is enabled and which gateway will be used.
  // - iPay88: requires per-merchant credentials (no platform fallback).
  // - Stripe: per-merchant Connect account (`stripeAccountId`) is one path,
  //   but the platform's own Stripe key is a valid fallback (PR #46) — the
  //   PaymentIntent endpoint routes accordingly. So Stripe payment is enabled
  //   whenever EITHER the merchant has Connect OR the platform has Stripe
  //   configured. This unblocks pilot merchants who haven't onboarded Connect.
  const { stripeAccountId, ipay88MerchantCode, paymentGateway, ...merchantPublic } = merchant;
  const paymentEnabled =
    paymentGateway === "ipay88"
      ? !!ipay88MerchantCode
      : !!stripeAccountId || !!config.stripeSecretKey;

  return c.json({
    merchant: { ...merchantPublic, paymentEnabled, paymentGateway },
    services: activeServices,
    staff: staffWithServices,
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
      preBufferMinutes: services.preBufferMinutes,
      postBufferMinutes: services.postBufferMinutes,
    })
    .from(services)
    .where(and(eq(services.id, body.service_id), eq(services.merchantId, merchant.id)))
    .limit(1);

  if (!service) {
    return c.json({ error: "Not Found", message: "Service not found" }, 404);
  }

  const startTime = parseISO(body.start_time);
  const totalDuration =
    service.preBufferMinutes +
    service.durationMinutes +
    service.bufferMinutes +
    service.postBufferMinutes;
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
    .select({ id: merchants.id, country: merchants.country })
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
        body.client_email,
        merchant.country
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
  let firstTimerDiscountApplied = false;
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
      const defaultCountry = merchant.country;
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
          if (ftPrice < computedPrice) {
            computedPrice = ftPrice;
            firstTimerDiscountApplied = true;
          }
        }
      }
    }
  }

  const priceSgdFinal = computedPrice.toFixed(2);

  // For services with pre/post buffers, re-derive the auto-assigned secondary
  // by re-running availability for the lease date. The slot search returns
  // the secondary it picked; we persist that on the booking so the calendar
  // shows the right staff for prep/cleanup.
  let secondaryStaffId: string | null = null;
  const [serviceBuffers] = await db
    .select({
      preBufferMinutes: services.preBufferMinutes,
      postBufferMinutes: services.postBufferMinutes,
    })
    .from(services)
    .where(eq(services.id, lease.serviceId))
    .limit(1);
  if (
    serviceBuffers &&
    (serviceBuffers.preBufferMinutes > 0 || serviceBuffers.postBufferMinutes > 0)
  ) {
    try {
      const dateStr = lease.startTime.toISOString().slice(0, 10);
      const slots = await getAvailability({
        merchantSlug: slug,
        serviceId: lease.serviceId,
        staffId: lease.staffId,
        date: dateStr,
      });
      const matched = slots.find(
        (s) =>
          s.start_time === lease.startTime.toISOString() &&
          s.staff_id === lease.staffId,
      );
      secondaryStaffId = matched?.secondary_staff_id ?? null;
    } catch (err) {
      // Non-fatal — proceed without secondary assignment if availability
      // recompute fails. Merchant can still set it manually later.
      console.error("[booking-confirm] failed to resolve secondary staff", err);
    }
  }

  // Create booking. Public widget bookings start as 'pending' — the T-24h
  // reminder asks the customer to click confirm, which flips status to
  // 'confirmed'. confirmation_token is the unguessable handle for that flow.
  const [booking] = await db
    .insert(bookings)
    .values({
      merchantId: merchant.id,
      clientId: client.id,
      serviceId: lease.serviceId,
      staffId: lease.staffId,
      secondaryStaffId,
      startTime: lease.startTime,
      endTime: lease.endTime,
      durationMinutes: service.durationMinutes,
      status: "pending",
      confirmationToken: generateConfirmationToken(),
      priceSgd: priceSgdFinal,
      paymentMethod: body.payment_method,
      bookingSource: body.booking_source ?? "direct_widget",
      commissionRate: "0",
      commissionSgd: "0",
      firstTimerDiscountApplied,
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
