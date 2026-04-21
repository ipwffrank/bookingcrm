import { Hono } from "hono";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { addMinutes } from "date-fns";
import {
  db,
  waitlist,
  merchants,
  services,
  staff,
  clients as clientsTable,
  bookings,
} from "@glowos/db";
import { zValidator } from "../middleware/validate.js";
import { findOrCreateClient } from "../lib/findOrCreateClient.js";
import { addJob } from "../lib/queue.js";
import { requireMerchant } from "../middleware/auth.js";
import { invalidateAvailabilityCacheByMerchantId } from "../lib/availability.js";
import type { AppVariables } from "../lib/types.js";

export const waitlistRouter = new Hono<{ Variables: AppVariables }>();
export const merchantWaitlistRouter = new Hono<{ Variables: AppVariables }>();

const timeRegex = /^\d{2}:\d{2}$/;

const joinSchema = z.object({
  merchant_slug: z.string().min(1),
  client_name: z.string().min(1),
  client_phone: z.string().min(1),
  client_email: z.string().email().optional(),
  service_id: z.string().uuid(),
  staff_id: z.string().uuid(),
  target_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  window_start: z.string().regex(timeRegex),
  window_end: z.string().regex(timeRegex),
});

// ─── POST /waitlist ────────────────────────────────────────────────────────────

waitlistRouter.post("/", zValidator(joinSchema), async (c) => {
  const body = c.get("body") as z.infer<typeof joinSchema>;

  if (body.window_start >= body.window_end) {
    return c.json(
      { error: "Bad Request", message: "window_start must be earlier than window_end" },
      400
    );
  }
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(body.target_date + "T00:00:00");
  if (target < today) {
    return c.json({ error: "Bad Request", message: "target_date is in the past" }, 400);
  }

  const [merchant] = await db
    .select({ id: merchants.id, country: merchants.country })
    .from(merchants)
    .where(eq(merchants.slug, body.merchant_slug))
    .limit(1);
  if (!merchant) return c.json({ error: "Not Found", message: "Merchant not found" }, 404);

  const [svc] = await db
    .select({ id: services.id })
    .from(services)
    .where(and(eq(services.id, body.service_id), eq(services.merchantId, merchant.id)))
    .limit(1);
  if (!svc) return c.json({ error: "Not Found", message: "Service not found" }, 404);

  const [st] = await db
    .select({ id: staff.id })
    .from(staff)
    .where(and(eq(staff.id, body.staff_id), eq(staff.merchantId, merchant.id)))
    .limit(1);
  if (!st) return c.json({ error: "Not Found", message: "Staff not found" }, 404);

  let client: { id: string };
  try {
    client = await findOrCreateClient(
      body.client_phone,
      body.client_name,
      body.client_email,
      merchant.country
    );
  } catch {
    return c.json({ error: "Bad Request", message: "Invalid phone number" }, 400);
  }

  const cancelToken = randomUUID().replace(/-/g, "");

  const [row] = await db
    .insert(waitlist)
    .values({
      merchantId: merchant.id,
      clientId: client.id,
      serviceId: body.service_id,
      staffId: body.staff_id,
      targetDate: body.target_date,
      windowStart: body.window_start,
      windowEnd: body.window_end,
      cancelToken,
    })
    .returning();

  await addJob("notifications", "waitlist_confirmation", { waitlist_id: row.id });

  return c.json({ id: row.id, cancel_token: cancelToken }, 201);
});

// ─── DELETE /waitlist/:id ──────────────────────────────────────────────────────

waitlistRouter.delete("/:id", async (c) => {
  const id = c.req.param("id");
  const token = c.req.query("token") ?? "";
  const [row] = await db
    .select()
    .from(waitlist)
    .where(eq(waitlist.id, id))
    .limit(1);
  if (!row) return c.json({ error: "Not Found" }, 404);
  if (row.cancelToken !== token) return c.json({ error: "Forbidden" }, 403);
  if (
    row.status === "booked" ||
    row.status === "cancelled" ||
    row.status === "expired"
  ) {
    return c.json({ ok: true });
  }
  await db
    .update(waitlist)
    .set({ status: "cancelled", updatedAt: new Date() })
    .where(eq(waitlist.id, id));
  return c.json({ ok: true });
});

// ─── POST /waitlist/:id/confirm ────────────────────────────────────────────────

waitlistRouter.post("/:id/confirm", async (c) => {
  const id = c.req.param("id");
  const token = c.req.query("token") ?? "";

  const [row] = await db
    .select()
    .from(waitlist)
    .where(eq(waitlist.id, id))
    .limit(1);
  if (!row) return c.json({ error: "Not Found" }, 404);
  if (row.cancelToken !== token) return c.json({ error: "Forbidden" }, 403);
  if (row.status !== "notified") {
    return c.json(
      { error: "Conflict", message: "Waitlist entry is not in 'notified' state" },
      409
    );
  }
  if (!row.holdExpiresAt || row.holdExpiresAt.getTime() < Date.now()) {
    return c.json({ error: "Conflict", message: "Hold expired" }, 409);
  }
  if (!row.notifiedBookingSlotId) {
    return c.json({ error: "Conflict", message: "No freed slot recorded" }, 409);
  }

  const [freed] = await db
    .select()
    .from(bookings)
    .where(eq(bookings.id, row.notifiedBookingSlotId))
    .limit(1);
  if (!freed) {
    return c.json({ error: "Conflict", message: "Freed slot not found" }, 409);
  }

  const result = await db.transaction(async (tx) => {
    const [svc] = await tx
      .select({
        durationMinutes: services.durationMinutes,
        bufferMinutes: services.bufferMinutes,
        priceSgd: services.priceSgd,
      })
      .from(services)
      .where(eq(services.id, row.serviceId))
      .limit(1);
    if (!svc) throw new Error("service_gone");

    const durationMinutes = svc.durationMinutes;
    const startTime = freed.startTime;
    const endTime = addMinutes(startTime, svc.durationMinutes + svc.bufferMinutes);

    const [b] = await tx
      .insert(bookings)
      .values({
        merchantId: row.merchantId,
        clientId: row.clientId,
        serviceId: row.serviceId,
        staffId: row.staffId,
        startTime,
        endTime,
        durationMinutes,
        status: "confirmed",
        priceSgd: svc.priceSgd,
        paymentMethod: null,
        bookingSource: "direct_widget",
        commissionRate: "0",
        commissionSgd: "0",
      })
      .returning();

    await tx
      .update(waitlist)
      .set({ status: "booked", updatedAt: new Date() })
      .where(eq(waitlist.id, id));

    return b;
  });

  await invalidateAvailabilityCacheByMerchantId(row.merchantId);
  await addJob("notifications", "booking_confirmation", { booking_id: result.id });

  return c.json({ booking_id: result.id }, 201);
});

// ─── GET /merchant/waitlist ────────────────────────────────────────────────────

merchantWaitlistRouter.get("/", requireMerchant, async (c) => {
  const merchantId = c.get("merchantId")!;
  const filter = c.req.query("status") ?? "active";
  const statuses: Array<"pending" | "notified" | "booked" | "expired" | "cancelled"> =
    filter === "all"
      ? ["pending", "notified", "booked", "expired", "cancelled"]
      : ["pending", "notified"];

  const rows = await db
    .select({
      id: waitlist.id,
      clientId: waitlist.clientId,
      clientName: clientsTable.name,
      clientPhone: clientsTable.phone,
      serviceId: waitlist.serviceId,
      serviceName: services.name,
      staffId: waitlist.staffId,
      staffName: staff.name,
      targetDate: waitlist.targetDate,
      windowStart: waitlist.windowStart,
      windowEnd: waitlist.windowEnd,
      status: waitlist.status,
      holdExpiresAt: waitlist.holdExpiresAt,
      createdAt: waitlist.createdAt,
    })
    .from(waitlist)
    .innerJoin(clientsTable, eq(waitlist.clientId, clientsTable.id))
    .innerJoin(services, eq(waitlist.serviceId, services.id))
    .innerJoin(staff, eq(waitlist.staffId, staff.id))
    .where(and(eq(waitlist.merchantId, merchantId), inArray(waitlist.status, statuses)))
    .orderBy(filter === "all" ? desc(waitlist.createdAt) : waitlist.createdAt);

  return c.json({ entries: rows });
});

// ─── DELETE /merchant/waitlist/:id ────────────────────────────────────────────

merchantWaitlistRouter.delete("/:id", requireMerchant, async (c) => {
  const merchantId = c.get("merchantId")!;
  const id = c.req.param("id")!;
  const [row] = await db
    .select({ id: waitlist.id, merchantId: waitlist.merchantId, status: waitlist.status })
    .from(waitlist)
    .where(eq(waitlist.id, id))
    .limit(1);
  if (!row || row.merchantId !== merchantId) return c.json({ error: "Not Found" }, 404);
  if (row.status === "booked")
    return c.json({ error: "Conflict", message: "Already booked" }, 409);
  await db
    .update(waitlist)
    .set({ status: "cancelled", updatedAt: new Date() })
    .where(eq(waitlist.id, id));
  return c.json({ ok: true });
});
