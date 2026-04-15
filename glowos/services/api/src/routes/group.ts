import { Hono } from "hono";
import { eq, inArray, and, gte, lt, sum, count, countDistinct, desc, or, ilike, sql } from "drizzle-orm";
import { db, merchants, bookings, clients } from "@glowos/db";
import { requireGroupAdmin } from "../middleware/groupAuth.js";
import type { AppVariables } from "../lib/types.js";

const groupRouter = new Hono<{ Variables: AppVariables }>();

groupRouter.use("*", requireGroupAdmin);

function parseDateRange(fromStr: string | undefined, toStr: string | undefined): { from: Date; to: Date } {
  const now = new Date();
  const from = fromStr ? new Date(fromStr) : new Date(now.getFullYear(), now.getMonth(), 1);
  const to = toStr ? new Date(toStr) : now;
  return { from, to };
}

// ─── GET /group/overview ────────────────────────────────────────────────────────
groupRouter.get("/overview", async (c) => {
  const groupId = c.get("groupId")!;
  const { from, to } = parseDateRange(c.req.query("from"), c.req.query("to"));

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
    .groupBy(bookings.merchantId);

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
    .groupBy(bookings.merchantId);

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
    })).sort((a, b) => b.revenue - a.revenue),
    opsHealth: opsRows.map((r) => ({
      merchantId: r.merchantId,
      name: nameMap[r.merchantId] ?? "Unknown",
      bookingCount: r.bookingCount,
    })).sort((a, b) => b.bookingCount - a.bookingCount),
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
  const { from, to } = parseDateRange(c.req.query("from"), c.req.query("to"));

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
  const { from, to } = parseDateRange(c.req.query("from"), c.req.query("to"));

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
  const page = Math.max(1, parseInt(c.req.query("page") ?? "1", 10));
  const limit = Math.min(50, Math.max(1, parseInt(c.req.query("limit") ?? "20", 10)));
  const offset = (page - 1) * limit;

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
    .innerJoin(bookings, and(eq(clients.id, bookings.clientId), eq(bookings.status, "completed")))
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

export { groupRouter };
