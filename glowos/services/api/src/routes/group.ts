import { Hono } from "hono";
import { eq, inArray, and, gte, lt, sum, count, countDistinct, desc, or, ilike, sql } from "drizzle-orm";
import { db, merchants, bookings, clients } from "@glowos/db";
import { requireGroupAccess } from "../middleware/groupAuth.js";
import type { AppVariables } from "../lib/types.js";
import { z } from "zod";
import { zValidator } from "../middleware/validate.js";

const groupRouter = new Hono<{ Variables: AppVariables }>();

groupRouter.use("*", requireGroupAccess);

const createBranchSchema = z.object({
  name: z.string().trim().min(1).max(255),
  slug: z
    .string()
    .trim()
    .min(3)
    .max(100)
    .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, "slug must be lowercase letters, numbers, dashes; no leading/trailing dash"),
  country: z.enum(["SG", "MY"]),
  category: z
    .enum(["hair_salon", "nail_studio", "spa", "massage", "beauty_centre", "restaurant", "beauty_clinic", "medical_clinic", "other"])
    .optional(),
  addressLine1: z.string().max(255).optional(),
  addressLine2: z.string().max(255).optional(),
  postalCode: z.string().max(10).optional(),
  phone: z.string().max(20).optional(),
  email: z.string().email().max(255).optional(),
  description: z.string().optional(),
}).strict();

const updateBranchSchema = z
  .object({
    name: z.string().trim().min(1).max(255),
    category: z.enum(["hair_salon", "nail_studio", "spa", "massage", "beauty_centre", "restaurant", "beauty_clinic", "medical_clinic", "other"]),
    addressLine1: z.string().max(255).nullable(),
    addressLine2: z.string().max(255).nullable(),
    postalCode: z.string().max(10).nullable(),
    phone: z.string().max(20).nullable(),
    email: z.string().email().max(255).nullable(),
    description: z.string().nullable(),
    logoUrl: z.string().url().nullable(),
    coverPhotoUrl: z.string().url().nullable(),
  })
  .partial()
  .strict();

function parseDateRange(fromStr: string | undefined, toStr: string | undefined): { from: Date; to: Date } {
  const now = new Date();
  const from = fromStr ? new Date(fromStr) : new Date(now.getFullYear(), now.getMonth(), 1);
  const to = toStr ? new Date(toStr) : now;
  if (isNaN(from.getTime()) || isNaN(to.getTime())) {
    throw new Error("INVALID_DATE");
  }
  if (from >= to) {
    throw new Error("INVALID_DATE");
  }
  return { from, to };
}

// ─── GET /group/overview ────────────────────────────────────────────────────────
groupRouter.get("/overview", async (c) => {
  const groupId = c.get("groupId")!;
  let from: Date, to: Date;
  try {
    ({ from, to } = parseDateRange(c.req.query("from"), c.req.query("to")));
  } catch {
    return c.json({ error: "Bad Request", message: "Invalid date format. Use ISO 8601 (e.g. 2026-01-01)" }, 400);
  }

  // 1. Get all merchantIds for this group
  const merchantRows = await db
    .select({ id: merchants.id, name: merchants.name })
    .from(merchants)
    .where(eq(merchants.groupId, groupId));

  const merchantIds = merchantRows.map((m) => m.id);

  if (merchantIds.length === 0) {
    return c.json({ revenue: 0, bookingCount: 0, activeClients: 0, revenueByBranch: [], opsHealth: [], topClients: [] });
  }

  // 2. Total revenue + booking count (completed bookings only)
  const [stats] = await db
    .select({ revenue: sum(bookings.priceSgd), bookingCount: count(bookings.id) })
    .from(bookings)
    .where(and(inArray(bookings.merchantId, merchantIds), eq(bookings.status, "completed"), gte(bookings.startTime, from), lt(bookings.startTime, to)));

  // 3. Active clients (distinct clientId with any booking in period)
  const [{ activeClients }] = await db
    .select({ activeClients: countDistinct(bookings.clientId) })
    .from(bookings)
    .where(and(inArray(bookings.merchantId, merchantIds), gte(bookings.startTime, from), lt(bookings.startTime, to)));

  // 4. Revenue by branch (completed)
  const revenueByBranchRows = await db
    .select({ merchantId: bookings.merchantId, revenue: sum(bookings.priceSgd) })
    .from(bookings)
    .where(and(inArray(bookings.merchantId, merchantIds), eq(bookings.status, "completed"), gte(bookings.startTime, from), lt(bookings.startTime, to)))
    .groupBy(bookings.merchantId)
    .orderBy(desc(sum(bookings.priceSgd)));

  // 5. Ops health: confirmed+completed+in_progress booking count per branch
  const opsRows = await db
    .select({ merchantId: bookings.merchantId, bookingCount: count(bookings.id) })
    .from(bookings)
    .where(
      and(
        inArray(bookings.merchantId, merchantIds),
        or(eq(bookings.status, "confirmed"), eq(bookings.status, "completed"), eq(bookings.status, "in_progress")),
        gte(bookings.startTime, from),
        lt(bookings.startTime, to)
      )
    )
    .groupBy(bookings.merchantId)
    .orderBy(desc(count(bookings.id)));

  // 6. Top 5 clients by total spend in period
  const topClientsRows = await db
    .select({ id: clients.id, name: clients.name, phone: clients.phone, totalSpend: sum(bookings.priceSgd) })
    .from(bookings)
    .innerJoin(clients, eq(bookings.clientId, clients.id))
    .where(and(inArray(bookings.merchantId, merchantIds), eq(bookings.status, "completed"), gte(bookings.startTime, from), lt(bookings.startTime, to)))
    .groupBy(clients.id, clients.name, clients.phone)
    .orderBy(desc(sum(bookings.priceSgd)))
    .limit(5);

  // Build name map for branch lookup
  const nameMap = Object.fromEntries(merchantRows.map((m) => [m.id, m.name]));

  return c.json({
    revenue: parseFloat(stats?.revenue ?? "0"),
    bookingCount: stats?.bookingCount ?? 0,
    activeClients: activeClients ?? 0,
    revenueByBranch: revenueByBranchRows.map((r) => ({
      merchantId: r.merchantId,
      name: nameMap[r.merchantId] ?? "Unknown",
      revenue: parseFloat(r.revenue ?? "0"),
    })),
    opsHealth: opsRows.map((r) => ({
      merchantId: r.merchantId,
      name: nameMap[r.merchantId] ?? "Unknown",
      bookingCount: r.bookingCount,
    })),
    topClients: topClientsRows.map((r) => ({
      id: r.id,
      name: r.name ?? "Unknown",
      phone: r.phone,
      totalSpend: parseFloat(r.totalSpend ?? "0"),
    })),
  });
});

// ─── GET /group/branches ────────────────────────────────────────────────────────
groupRouter.get("/branches", async (c) => {
  const groupId = c.get("groupId")!;
  let from: Date, to: Date;
  try {
    ({ from, to } = parseDateRange(c.req.query("from"), c.req.query("to")));
  } catch {
    return c.json({ error: "Bad Request", message: "Invalid date format. Use ISO 8601 (e.g. 2026-01-01)" }, 400);
  }

  const merchantRows = await db
    .select({ id: merchants.id, name: merchants.name, addressLine1: merchants.addressLine1, category: merchants.category })
    .from(merchants)
    .where(eq(merchants.groupId, groupId));

  const merchantIds = merchantRows.map((m) => m.id);

  if (merchantIds.length === 0) {
    return c.json({ branches: [] });
  }

  // Revenue + booking count per branch (completed bookings)
  const revenueRows = await db
    .select({ merchantId: bookings.merchantId, revenue: sum(bookings.priceSgd), bookingCount: count(bookings.id) })
    .from(bookings)
    .where(and(inArray(bookings.merchantId, merchantIds), eq(bookings.status, "completed"), gte(bookings.startTime, from), lt(bookings.startTime, to)))
    .groupBy(bookings.merchantId);

  const revenueMap = Object.fromEntries(revenueRows.map((r) => [r.merchantId, r]));

  return c.json({
    branches: merchantRows.map((m) => {
      const stats = revenueMap[m.id];
      return {
        merchantId: m.id,
        name: m.name,
        location: m.addressLine1 ?? "",
        category: m.category ?? "",
        revenue: parseFloat(stats?.revenue ?? "0"),
        bookingCount: stats?.bookingCount ?? 0,
      };
    }),
  });
});

// ─── GET /group/branches/:merchantId ──────────────────────────────────────────
groupRouter.get("/branches/:merchantId", async (c) => {
  const groupId = c.get("groupId")!;
  const merchantId = c.req.param("merchantId")!;
  let from: Date, to: Date;
  try {
    ({ from, to } = parseDateRange(c.req.query("from"), c.req.query("to")));
  } catch {
    return c.json({ error: "Bad Request", message: "Invalid date format. Use ISO 8601 (e.g. 2026-01-01)" }, 400);
  }

  // Verify this merchant belongs to the group
  const [merchant] = await db
    .select({ id: merchants.id, name: merchants.name, addressLine1: merchants.addressLine1 })
    .from(merchants)
    .where(and(eq(merchants.id, merchantId), eq(merchants.groupId, groupId)))
    .limit(1);

  if (!merchant) {
    return c.json({ error: "Not Found", message: "Branch not found in your group" }, 404);
  }

  // Revenue + booking count (completed)
  const [stats] = await db
    .select({ revenue: sum(bookings.priceSgd), bookingCount: count(bookings.id) })
    .from(bookings)
    .where(and(eq(bookings.merchantId, merchantId), eq(bookings.status, "completed"), gte(bookings.startTime, from), lt(bookings.startTime, to)));

  // Active clients
  const [{ activeClients }] = await db
    .select({ activeClients: countDistinct(bookings.clientId) })
    .from(bookings)
    .where(and(eq(bookings.merchantId, merchantId), gte(bookings.startTime, from), lt(bookings.startTime, to)));

  // Recent bookings (last 10)
  const recentBookings = await db
    .select({
      id: bookings.id,
      clientId: bookings.clientId,
      serviceId: bookings.serviceId,
      startTime: bookings.startTime,
      status: bookings.status,
      priceSgd: bookings.priceSgd,
    })
    .from(bookings)
    .where(and(eq(bookings.merchantId, merchantId), gte(bookings.startTime, from), lt(bookings.startTime, to)))
    .orderBy(desc(bookings.startTime))
    .limit(10);

  return c.json({
    merchant: { id: merchant.id, name: merchant.name, location: merchant.addressLine1 ?? "" },
    revenue: parseFloat(stats?.revenue ?? "0"),
    bookingCount: stats?.bookingCount ?? 0,
    activeClients: activeClients ?? 0,
    recentBookings,
  });
});

// ─── GET /group/clients ─────────────────────────────────────────────────────────
groupRouter.get("/clients", async (c) => {
  const groupId = c.get("groupId")!;
  const search = c.req.query("search") ?? "";
  const page = Math.max(1, parseInt(c.req.query("page") ?? "1", 10) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(c.req.query("limit") ?? "20", 10) || 20));
  const offset = (page - 1) * limit;
  let from: Date, to: Date;
  try {
    ({ from, to } = parseDateRange(c.req.query("from"), c.req.query("to")));
  } catch {
    return c.json({ error: "Bad Request", message: "Invalid date format. Use ISO 8601 (e.g. 2026-01-01)" }, 400);
  }

  // Get all merchantIds for this group
  const merchantRows = await db
    .select({ id: merchants.id })
    .from(merchants)
    .where(eq(merchants.groupId, groupId));

  const merchantIds = merchantRows.map((m) => m.id);

  if (merchantIds.length === 0) {
    return c.json({ clients: [], total: 0, page, limit });
  }

  // Build search filter
  const searchFilter = search
    ? or(ilike(clients.name, `%${search}%`), ilike(clients.phone, `%${search}%`))
    : undefined;

  const baseWhere = and(
    inArray(bookings.merchantId, merchantIds),
    eq(bookings.status, "completed"),
    gte(bookings.startTime, from),
    lt(bookings.startTime, to),
    searchFilter
  );

  // Count total matching clients
  const [{ total }] = await db
    .select({ total: countDistinct(clients.id) })
    .from(clients)
    .innerJoin(bookings, eq(clients.id, bookings.clientId))
    .where(baseWhere);

  // Client list with aggregates
  const clientRows = await db
    .select({
      id: clients.id,
      name: clients.name,
      phone: clients.phone,
      email: clients.email,
      totalSpend: sum(bookings.priceSgd),
      branchCount: countDistinct(bookings.merchantId),
      lastVisit: sql<Date | null>`MAX(${bookings.startTime})`,
    })
    .from(clients)
    .innerJoin(bookings, eq(clients.id, bookings.clientId))
    .where(baseWhere)
    .groupBy(clients.id, clients.name, clients.phone, clients.email)
    .orderBy(desc(sum(bookings.priceSgd)))
    .limit(limit)
    .offset(offset);

  return c.json({
    clients: clientRows.map((r) => ({
      id: r.id,
      name: r.name ?? "Unknown",
      phone: r.phone,
      email: r.email ?? null,
      totalSpend: parseFloat(r.totalSpend ?? "0"),
      branchCount: r.branchCount,
      lastVisit: r.lastVisit,
    })),
    total: total ?? 0,
    page,
    limit,
  });
});

// ─── POST /group/branches ──────────────────────────────────────────────────────
groupRouter.post("/branches", zValidator(createBranchSchema), async (c) => {
  const groupId = c.get("groupId")!;
  const body = c.get("body") as z.infer<typeof createBranchSchema>;

  // Slug uniqueness — explicit pre-check for a friendly 409 ahead of the unique-
  // constraint violation that would surface as a generic 500.
  const [existing] = await db
    .select({ id: merchants.id })
    .from(merchants)
    .where(eq(merchants.slug, body.slug))
    .limit(1);
  if (existing) {
    return c.json({ error: "Conflict", message: "Slug already taken" }, 409);
  }

  const timezone = body.country === "MY" ? "Asia/Kuala_Lumpur" : "Asia/Singapore";
  const paymentGateway = body.country === "MY" ? "ipay88" : "stripe";

  const [created] = await db
    .insert(merchants)
    .values({
      slug: body.slug,
      name: body.name,
      country: body.country,
      timezone,
      paymentGateway,
      groupId,
      ...(body.category ? { category: body.category } : {}),
      ...(body.addressLine1 !== undefined ? { addressLine1: body.addressLine1 } : {}),
      ...(body.addressLine2 !== undefined ? { addressLine2: body.addressLine2 } : {}),
      ...(body.postalCode !== undefined ? { postalCode: body.postalCode } : {}),
      ...(body.phone !== undefined ? { phone: body.phone } : {}),
      ...(body.email !== undefined ? { email: body.email } : {}),
      ...(body.description !== undefined ? { description: body.description } : {}),
    })
    .returning();

  return c.json({ merchant: created }, 201);
});

// ─── PATCH /group/branches/:merchantId ─────────────────────────────────────────
groupRouter.patch(
  "/branches/:merchantId",
  zValidator(updateBranchSchema),
  async (c) => {
    const groupId = c.get("groupId")!;
    const merchantId = c.req.param("merchantId")!;
    const body = c.get("body") as z.infer<typeof updateBranchSchema>;

    if (Object.keys(body).length === 0) {
      return c.json({ error: "Bad Request", message: "No fields provided" }, 400);
    }

    // Verify target is in caller's group
    const [target] = await db
      .select({ id: merchants.id })
      .from(merchants)
      .where(and(eq(merchants.id, merchantId), eq(merchants.groupId, groupId)))
      .limit(1);
    if (!target) {
      return c.json({ error: "Not Found", message: "Branch not in your group" }, 404);
    }

    const [updated] = await db
      .update(merchants)
      .set({ ...body, updatedAt: new Date() })
      .where(eq(merchants.id, merchantId))
      .returning();

    return c.json({ merchant: updated });
  },
);

export { groupRouter };
