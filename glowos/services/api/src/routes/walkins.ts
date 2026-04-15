import { Hono } from "hono";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  clients,
  clientProfiles,
  bookings,
  services,
  staff,
  merchants,
} from "@glowos/db";
import { requireMerchant } from "../middleware/auth.js";
import { zValidator } from "../middleware/validate.js";
import type { AppVariables } from "../lib/types.js";

export const walkinsRouter = new Hono<{ Variables: AppVariables }>();

// ─── Schemas ───────────────────────────────────────────────────────────────────

const walkinRegisterSchema = z.object({
  client_name: z.string().min(1, "Client name is required"),
  client_phone: z.string().min(1, "Client phone is required"),
  client_email: z.string().email().optional(),
  service_id: z.string().uuid(),
  staff_id: z.string().uuid(),
  start_time: z.string().datetime({ message: "start_time must be an ISO datetime string" }),
  payment_method: z.enum(["stripe", "cash", "otc"]).default("cash"),
  notes: z.string().optional(),
});

const recordPaymentSchema = z.object({
  payment_method: z.enum(["stripe", "cash", "otc"]),
  amount_sgd: z.number().positive().optional(),
  notes: z.string().optional(),
});

// ─── POST /merchant/walkins/register ──────────────────────────────────────────

walkinsRouter.post("/register", requireMerchant, zValidator(walkinRegisterSchema), async (c) => {
  const merchantId = c.get("merchantId");
  const body = c.get("body") as z.infer<typeof walkinRegisterSchema>;

  // Load merchant for payout config
  const [merchant] = await db
    .select()
    .from(merchants)
    .where(eq(merchants.id, merchantId))
    .limit(1);

  if (!merchant) {
    return c.json({ error: "Merchant not found" }, 404);
  }

  // Load service to get duration and price
  const [service] = await db
    .select()
    .from(services)
    .where(and(eq(services.id, body.service_id), eq(services.merchantId, merchantId)))
    .limit(1);

  if (!service) {
    return c.json({ error: "Service not found" }, 404);
  }

  // Find or create client by phone
  let client = await db
    .select()
    .from(clients)
    .where(eq(clients.phone, body.client_phone))
    .limit(1)
    .then((rows) => rows[0] ?? null);

  if (!client) {
    const [created] = await db
      .insert(clients)
      .values({
        phone: body.client_phone,
        email: body.client_email ?? null,
        name: body.client_name,
        acquisitionSource: "walkin",
      })
      .returning();
    client = created;
  }

  // Ensure client profile exists for this merchant
  const [existingProfile] = await db
    .select()
    .from(clientProfiles)
    .where(
      and(
        eq(clientProfiles.merchantId, merchantId),
        eq(clientProfiles.clientId, client.id)
      )
    )
    .limit(1);

  if (!existingProfile) {
    await db.insert(clientProfiles).values({
      merchantId,
      clientId: client.id,
    });
  }

  // Calculate end time
  const startTime = new Date(body.start_time);
  const endTime = new Date(startTime.getTime() + service.durationMinutes * 60 * 1000);

  // Create booking
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
      status: "in_progress",
      priceSgd: service.priceSgd,
      paymentStatus: body.payment_method === "cash" || body.payment_method === "otc" ? "completed" : "pending",
      paymentMethod: body.payment_method,
      bookingSource: "walk_in",
      commissionRate: "0",
      commissionSgd: "0",
      merchantPayoutSgd: service.priceSgd,
      staffNotes: body.notes ?? null,
    })
    .returning();

  return c.json({ booking, client }, 201);
});

// ─── POST /merchant/walkins/bookings/:id/record-payment ────────────────────────

walkinsRouter.post("/bookings/:id/record-payment", requireMerchant, zValidator(recordPaymentSchema), async (c) => {
  const merchantId = c.get("merchantId");
  const bookingId = c.req.param("id");
  const body = c.get("body") as z.infer<typeof recordPaymentSchema>;

  const [existing] = await db
    .select()
    .from(bookings)
    .where(and(eq(bookings.id, bookingId), eq(bookings.merchantId, merchantId)))
    .limit(1);

  if (!existing) {
    return c.json({ error: "Booking not found" }, 404);
  }

  const [updated] = await db
    .update(bookings)
    .set({
      paymentMethod: body.payment_method,
      paymentStatus: "completed",
      ...(body.amount_sgd && { priceSgd: body.amount_sgd.toString() }),
      updatedAt: new Date(),
    })
    .where(eq(bookings.id, bookingId))
    .returning();

  return c.json({ booking: updated });
});

// ─── GET /merchant/walkins/today ───────────────────────────────────────────────

walkinsRouter.get("/today", requireMerchant, async (c) => {
  const merchantId = c.get("merchantId");
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfToday = new Date(startOfToday.getTime() + 24 * 60 * 60 * 1000);

  const todayWalkins = await db
    .select({
      booking: bookings,
      client: clients,
      service: services,
      staffMember: staff,
    })
    .from(bookings)
    .innerJoin(clients, eq(bookings.clientId, clients.id))
    .innerJoin(services, eq(bookings.serviceId, services.id))
    .innerJoin(staff, eq(bookings.staffId, staff.id))
    .where(
      and(
        eq(bookings.merchantId, merchantId),
        eq(bookings.bookingSource, "walk_in"),
      )
    )
    .orderBy(bookings.startTime);

  // Filter to today in JS (avoids tz issues with DB gte/lte)
  const filtered = todayWalkins.filter((row) => {
    const t = row.booking.startTime.getTime();
    return t >= startOfToday.getTime() && t < endOfToday.getTime();
  });

  return c.json({ walkins: filtered });
});
