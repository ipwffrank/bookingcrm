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
import type { AppVariables } from "../lib/types.js";

const bookingsRouter = new Hono<{ Variables: AppVariables }>();

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
  payment_method: z.string().optional(),
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

// ─── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Find a client by phone, or create one if not found.
 */
async function findOrCreateClient(
  phone: string,
  name?: string,
  email?: string
): Promise<{ id: string }> {
  const [existing] = await db
    .select({ id: clients.id })
    .from(clients)
    .where(eq(clients.phone, phone))
    .limit(1);

  if (existing) {
    // Update name/email if provided and missing
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

// ─── Public: GET /booking/:slug ────────────────────────────────────────────────

bookingsRouter.get("/:slug", async (c) => {
  const slug = c.req.param("slug")!;

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

  return c.json({ merchant, services: activeServices, staff: activeStaff });
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

  const slots = await getAvailability({
    merchantSlug: slug,
    serviceId,
    staffId: staffId ?? "any",
    date,
  });

  return c.json({ slots });
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

  // Load service for price
  const [service] = await db
    .select({ priceSgd: services.priceSgd, durationMinutes: services.durationMinutes })
    .from(services)
    .where(eq(services.id, lease.serviceId))
    .limit(1);

  if (!service) {
    return c.json({ error: "Not Found", message: "Service not found" }, 404);
  }

  // Find or create client
  const client = await findOrCreateClient(
    body.client_phone,
    body.client_name,
    body.client_email
  );

  // Find or create client profile for this merchant
  await findOrCreateClientProfile(merchant.id, client.id);

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
      priceSgd: service.priceSgd,
      paymentMethod: body.payment_method,
      bookingSource: "direct_widget",
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

  return c.json(
    {
      booking,
      booking_token: bookingToken,
      message: "Booking confirmed successfully",
    },
    201
  );
});

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
      eligible: false,
      reason: "Booking is already cancelled",
      refund_type: "none" as const,
      refund_amount: 0,
    });
  }

  if (booking.status === "completed" || booking.status === "no_show") {
    return c.json({
      booking,
      eligible: false,
      reason: "Booking cannot be cancelled after completion",
      refund_type: "none" as const,
      refund_amount: 0,
    });
  }

  // Determine refund based on cancellation_policy
  const policy = merchant.cancellationPolicy as {
    hours_for_full_refund?: number;
    hours_for_partial_refund?: number;
    partial_refund_percentage?: number;
  } | null;

  const now = new Date();
  const hoursUntilBooking = (booking.startTime.getTime() - now.getTime()) / (1000 * 60 * 60);
  const price = parseFloat(String(booking.priceSgd));

  let refundType: "full" | "partial" | "none" = "none";
  let refundAmount = 0;

  if (!policy) {
    // Default: full refund
    refundType = "full";
    refundAmount = price;
  } else if (
    policy.hours_for_full_refund !== undefined &&
    hoursUntilBooking >= policy.hours_for_full_refund
  ) {
    refundType = "full";
    refundAmount = price;
  } else if (
    policy.hours_for_partial_refund !== undefined &&
    hoursUntilBooking >= policy.hours_for_partial_refund
  ) {
    refundType = "partial";
    const pct = policy.partial_refund_percentage ?? 50;
    refundAmount = parseFloat(((price * pct) / 100).toFixed(2));
  }

  return c.json({
    booking,
    service,
    eligible: true,
    refund_type: refundType,
    refund_amount: refundAmount,
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

  const [row] = await db
    .select({ booking: bookings })
    .from(bookings)
    .where(eq(bookings.id, bookingId))
    .limit(1);

  if (!row) {
    return c.json({ error: "Not Found", message: "Booking not found" }, 404);
  }

  const { booking } = row;

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

  const [updated] = await db
    .update(bookings)
    .set({
      status: "cancelled",
      cancelledAt: new Date(),
      cancelledBy: "client",
      updatedAt: new Date(),
    })
    .where(eq(bookings.id, bookingId))
    .returning();

  await invalidateAvailabilityCacheByMerchantId(booking.merchantId);

  return c.json({
    success: true,
    message: "Booking cancelled successfully",
    booking: updated,
  });
});

// ─── Protected: GET /merchant/bookings ────────────────────────────────────────

bookingsRouter.get("/merchant", requireMerchant, async (c) => {
  const merchantId = c.get("merchantId");
  const dateParam = c.req.query("date");
  const statusParam = c.req.query("status");
  const staffIdParam = c.req.query("staff_id");

  const conditions = [eq(bookings.merchantId, merchantId)];

  if (dateParam) {
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

bookingsRouter.get("/merchant/:id", requireMerchant, async (c) => {
  const merchantId = c.get("merchantId");
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

bookingsRouter.post(
  "/merchant",
  requireMerchant,
  zValidator(merchantBookingCreateSchema),
  async (c) => {
    const merchantId = c.get("merchantId");
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
    const client = await findOrCreateClient(body.client_phone, body.client_name);
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

bookingsRouter.put("/merchant/:id/check-in", requireMerchant, async (c) => {
  const merchantId = c.get("merchantId");
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

bookingsRouter.put("/merchant/:id/complete", requireMerchant, async (c) => {
  const merchantId = c.get("merchantId");
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

  return c.json({ booking: updated });
});

// ─── Protected: PUT /merchant/bookings/:id/no-show ────────────────────────────

bookingsRouter.put("/merchant/:id/no-show", requireMerchant, async (c) => {
  const merchantId = c.get("merchantId");
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

  return c.json({ booking: updated });
});

export { bookingsRouter };
