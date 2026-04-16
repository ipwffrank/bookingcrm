import { Hono } from "hono";
import { eq, and, gte, lte } from "drizzle-orm";
import { db, staff, merchants, bookings, services, clients } from "@glowos/db";
import { requireMerchant } from "../middleware/auth.js";
import type { AppVariables } from "../lib/types.js";

const staffPortalRouter = new Hono<{ Variables: AppVariables }>();

staffPortalRouter.use("*", requireMerchant);

// GET /staff/me — own profile + merchant info
staffPortalRouter.get("/me", async (c) => {
  const merchantId = c.get("merchantId")!;
  const staffId = c.get("staffId");

  if (!staffId) {
    return c.json({ error: "Forbidden", message: "Staff access required" }, 403);
  }

  const [staffMember] = await db
    .select({
      id: staff.id,
      name: staff.name,
      title: staff.title,
      photoUrl: staff.photoUrl,
      bio: staff.bio,
    })
    .from(staff)
    .where(and(eq(staff.id, staffId), eq(staff.merchantId, merchantId)))
    .limit(1);

  const [merchant] = await db
    .select({ id: merchants.id, name: merchants.name, slug: merchants.slug })
    .from(merchants)
    .where(eq(merchants.id, merchantId))
    .limit(1);

  return c.json({ staff: staffMember, merchant });
});

// GET /staff/bookings?from=YYYY-MM-DD&to=YYYY-MM-DD — all merchant bookings (read-only)
staffPortalRouter.get("/bookings", async (c) => {
  const merchantId = c.get("merchantId")!;
  const fromStr = c.req.query("from");
  const toStr = c.req.query("to");
  const filterStaffId = c.req.query("staff_id");

  if (!fromStr || !toStr) {
    return c.json({ error: "Bad Request", message: "from and to query params required (YYYY-MM-DD)" }, 400);
  }

  const from = new Date(fromStr);
  const to = new Date(toStr + "T23:59:59");

  const conditions = [
    eq(bookings.merchantId, merchantId),
    gte(bookings.startTime, from),
    lte(bookings.startTime, to),
  ];

  if (filterStaffId) {
    conditions.push(eq(bookings.staffId, filterStaffId));
  }

  const rows = await db
    .select({
      id: bookings.id,
      staffId: bookings.staffId,
      startTime: bookings.startTime,
      endTime: bookings.endTime,
      status: bookings.status,
      priceSgd: bookings.priceSgd,
      clientName: clients.name,
      serviceName: services.name,
      staffName: staff.name,
    })
    .from(bookings)
    .leftJoin(clients, eq(bookings.clientId, clients.id))
    .leftJoin(services, eq(bookings.serviceId, services.id))
    .leftJoin(staff, eq(bookings.staffId, staff.id))
    .where(and(...conditions))
    .orderBy(bookings.startTime);

  return c.json({ bookings: rows });
});

// GET /staff/my-bookings — bookings assigned to this staff member (upcoming)
staffPortalRouter.get("/my-bookings", async (c) => {
  const merchantId = c.get("merchantId")!;
  const staffId = c.get("staffId");

  if (!staffId) {
    return c.json({ error: "Forbidden", message: "Staff access required" }, 403);
  }

  const rows = await db
    .select({
      id: bookings.id,
      startTime: bookings.startTime,
      endTime: bookings.endTime,
      status: bookings.status,
      priceSgd: bookings.priceSgd,
      clientName: clients.name,
      clientPhone: clients.phone,
      serviceName: services.name,
    })
    .from(bookings)
    .leftJoin(clients, eq(bookings.clientId, clients.id))
    .leftJoin(services, eq(bookings.serviceId, services.id))
    .where(and(
      eq(bookings.merchantId, merchantId),
      eq(bookings.staffId, staffId),
      gte(bookings.startTime, new Date()),
    ))
    .orderBy(bookings.startTime)
    .limit(50);

  return c.json({ bookings: rows });
});

export { staffPortalRouter };
