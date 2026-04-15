import { Hono } from "hono";
import { eq, and, gte, lte, sql } from "drizzle-orm";
import { db, bookings, clients, clientProfiles, services, staff, reviews } from "@glowos/db";
import { requireMerchant } from "../middleware/auth.js";
import type { AppVariables } from "../lib/types.js";

const analyticsRouter = new Hono<{ Variables: AppVariables }>();

// ─── Helpers ───────────────────────────────────────────────────────────────────

function getPeriodDays(period: string): number {
  if (period === "7d") return 7;
  if (period === "90d") return 90;
  return 30; // default 30d
}

function getPeriodBounds(days: number): { start: Date; end: Date; prevStart: Date; prevEnd: Date } {
  const end = new Date();
  const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
  const prevEnd = new Date(start.getTime() - 1);
  const prevStart = new Date(prevEnd.getTime() - days * 24 * 60 * 60 * 1000);
  return { start, end, prevStart, prevEnd };
}

function pctChange(current: number, previous: number): number | null {
  if (previous === 0) return current > 0 ? 100 : null;
  return parseFloat((((current - previous) / previous) * 100).toFixed(1));
}

// ─── GET /merchant/analytics/summary ─────────────────────────────────────────

analyticsRouter.get("/summary", requireMerchant, async (c) => {
  const merchantId = c.get("merchantId")!;
  const periodParam = c.req.query("period") ?? "30d";
  const days = getPeriodDays(periodParam);
  const { start, end, prevStart, prevEnd } = getPeriodBounds(days);

  // Current period aggregates
  const [currentAgg] = await db
    .select({
      total_bookings: sql<number>`cast(count(*) as int)`,
      total_revenue: sql<number>`coalesce(sum(cast(${bookings.priceSgd} as numeric)), 0)`,
    })
    .from(bookings)
    .where(
      and(
        eq(bookings.merchantId, merchantId),
        gte(bookings.startTime, start),
        lte(bookings.startTime, end),
        sql`${bookings.status} NOT IN ('cancelled', 'no_show')`
      )
    );

  // Previous period aggregates
  const [prevAgg] = await db
    .select({
      total_bookings: sql<number>`cast(count(*) as int)`,
      total_revenue: sql<number>`coalesce(sum(cast(${bookings.priceSgd} as numeric)), 0)`,
    })
    .from(bookings)
    .where(
      and(
        eq(bookings.merchantId, merchantId),
        gte(bookings.startTime, prevStart),
        lte(bookings.startTime, prevEnd),
        sql`${bookings.status} NOT IN ('cancelled', 'no_show')`
      )
    );

  // Active clients: distinct clients with bookings in period
  const [activeClientsResult] = await db
    .select({
      count: sql<number>`cast(count(distinct ${bookings.clientId}) as int)`,
    })
    .from(bookings)
    .where(
      and(
        eq(bookings.merchantId, merchantId),
        gte(bookings.startTime, start),
        lte(bookings.startTime, end),
        sql`${bookings.status} NOT IN ('cancelled', 'no_show')`
      )
    );

  // New clients: client profiles created during this period
  const [newClientsResult] = await db
    .select({
      count: sql<number>`cast(count(*) as int)`,
    })
    .from(clientProfiles)
    .where(
      and(
        eq(clientProfiles.merchantId, merchantId),
        gte(clientProfiles.createdAt, start),
        lte(clientProfiles.createdAt, end)
      )
    );

  // Previous period new clients
  const [prevNewClientsResult] = await db
    .select({
      count: sql<number>`cast(count(*) as int)`,
    })
    .from(clientProfiles)
    .where(
      and(
        eq(clientProfiles.merchantId, merchantId),
        gte(clientProfiles.createdAt, prevStart),
        lte(clientProfiles.createdAt, prevEnd)
      )
    );

  const totalBookings = Number(currentAgg?.total_bookings ?? 0);
  const totalRevenue = Number(currentAgg?.total_revenue ?? 0);
  const prevBookings = Number(prevAgg?.total_bookings ?? 0);
  const prevRevenue = Number(prevAgg?.total_revenue ?? 0);
  const activeClients = Number(activeClientsResult?.count ?? 0);
  const newClients = Number(newClientsResult?.count ?? 0);
  const prevNewClients = Number(prevNewClientsResult?.count ?? 0);

  const avgBookingValue = totalBookings > 0 ? totalRevenue / totalBookings : 0;
  const prevAvgBookingValue = prevBookings > 0 ? prevRevenue / prevBookings : 0;

  return c.json({
    period: periodParam,
    total_bookings: totalBookings,
    total_bookings_change: pctChange(totalBookings, prevBookings),
    total_revenue: parseFloat(totalRevenue.toFixed(2)),
    total_revenue_change: pctChange(totalRevenue, prevRevenue),
    active_clients: activeClients,
    avg_booking_value: parseFloat(avgBookingValue.toFixed(2)),
    avg_booking_value_change: pctChange(avgBookingValue, prevAvgBookingValue),
    new_clients: newClients,
    new_clients_change: pctChange(newClients, prevNewClients),
  });
});

// ─── GET /merchant/analytics/revenue ─────────────────────────────────────────

analyticsRouter.get("/revenue", requireMerchant, async (c) => {
  const merchantId = c.get("merchantId")!;
  const periodParam = c.req.query("period") ?? "30d";
  const days = getPeriodDays(periodParam);
  const { start, end } = getPeriodBounds(days);

  const rows = await db
    .select({
      date: sql<string>`to_char(date_trunc('day', ${bookings.startTime} AT TIME ZONE 'Asia/Singapore'), 'YYYY-MM-DD')`,
      revenue: sql<number>`coalesce(sum(cast(${bookings.priceSgd} as numeric)), 0)`,
      bookings_count: sql<number>`cast(count(*) as int)`,
    })
    .from(bookings)
    .where(
      and(
        eq(bookings.merchantId, merchantId),
        gte(bookings.startTime, start),
        lte(bookings.startTime, end),
        sql`${bookings.status} NOT IN ('cancelled', 'no_show')`
      )
    )
    .groupBy(sql`date_trunc('day', ${bookings.startTime} AT TIME ZONE 'Asia/Singapore')`)
    .orderBy(sql`date_trunc('day', ${bookings.startTime} AT TIME ZONE 'Asia/Singapore')`);

  return c.json({
    period: periodParam,
    revenue: rows.map((r) => ({
      date: r.date,
      revenue: parseFloat(Number(r.revenue).toFixed(2)),
      bookings_count: Number(r.bookings_count),
    })),
  });
});

// ─── GET /merchant/analytics/staff-performance ───────────────────────────────

analyticsRouter.get("/staff-performance", requireMerchant, async (c) => {
  const merchantId = c.get("merchantId")!;
  const periodParam = c.req.query("period") ?? "30d";
  const days = getPeriodDays(periodParam);
  const { start, end } = getPeriodBounds(days);

  const rows = await db
    .select({
      staff_id: bookings.staffId,
      staff_name: staff.name,
      bookings_count: sql<number>`cast(count(${bookings.id}) as int)`,
      revenue: sql<number>`coalesce(sum(cast(${bookings.priceSgd} as numeric)), 0)`,
    })
    .from(bookings)
    .innerJoin(staff, eq(bookings.staffId, staff.id))
    .where(
      and(
        eq(bookings.merchantId, merchantId),
        gte(bookings.startTime, start),
        lte(bookings.startTime, end),
        sql`${bookings.status} NOT IN ('cancelled', 'no_show')`
      )
    )
    .groupBy(bookings.staffId, staff.name)
    .orderBy(sql`sum(cast(${bookings.priceSgd} as numeric)) desc nulls last`);

  // Fetch avg ratings per staff from reviews in same period
  const ratingRows = await db
    .select({
      staff_id: bookings.staffId,
      avg_rating: sql<number>`avg(cast(${reviews.rating} as numeric))`,
    })
    .from(reviews)
    .innerJoin(bookings, eq(reviews.bookingId, bookings.id))
    .where(
      and(
        eq(bookings.merchantId, merchantId),
        gte(reviews.createdAt, start),
        lte(reviews.createdAt, end)
      )
    )
    .groupBy(bookings.staffId);

  const ratingMap = new Map(ratingRows.map((r) => [r.staff_id, r.avg_rating]));

  return c.json({
    period: periodParam,
    staff_performance: rows.map((r) => ({
      staff_id: r.staff_id,
      staff_name: r.staff_name,
      bookings_count: Number(r.bookings_count),
      revenue: parseFloat(Number(r.revenue).toFixed(2)),
      avg_rating: ratingMap.has(r.staff_id)
        ? parseFloat(Number(ratingMap.get(r.staff_id)).toFixed(1))
        : null,
    })),
  });
});

// ─── GET /merchant/analytics/top-services ────────────────────────────────────

analyticsRouter.get("/top-services", requireMerchant, async (c) => {
  const merchantId = c.get("merchantId")!;
  const periodParam = c.req.query("period") ?? "30d";
  const days = getPeriodDays(periodParam);
  const { start, end } = getPeriodBounds(days);

  const rows = await db
    .select({
      service_id: bookings.serviceId,
      service_name: services.name,
      bookings_count: sql<number>`cast(count(${bookings.id}) as int)`,
      revenue: sql<number>`coalesce(sum(cast(${bookings.priceSgd} as numeric)), 0)`,
    })
    .from(bookings)
    .innerJoin(services, eq(bookings.serviceId, services.id))
    .where(
      and(
        eq(bookings.merchantId, merchantId),
        gte(bookings.startTime, start),
        lte(bookings.startTime, end),
        sql`${bookings.status} NOT IN ('cancelled', 'no_show')`
      )
    )
    .groupBy(bookings.serviceId, services.name)
    .orderBy(sql`sum(cast(${bookings.priceSgd} as numeric)) desc nulls last`);

  return c.json({
    period: periodParam,
    top_services: rows.map((r) => ({
      service_id: r.service_id,
      service_name: r.service_name,
      bookings_count: Number(r.bookings_count),
      revenue: parseFloat(Number(r.revenue).toFixed(2)),
    })),
  });
});

// ─── GET /merchant/analytics/booking-sources ─────────────────────────────────

analyticsRouter.get("/booking-sources", requireMerchant, async (c) => {
  const merchantId = c.get("merchantId")!;
  const periodParam = c.req.query("period") ?? "30d";
  const days = getPeriodDays(periodParam);
  const { start, end } = getPeriodBounds(days);

  const rows = await db
    .select({
      source: bookings.bookingSource,
      count: sql<number>`cast(count(${bookings.id}) as int)`,
      revenue: sql<number>`coalesce(sum(cast(${bookings.priceSgd} as numeric)), 0)`,
    })
    .from(bookings)
    .where(
      and(
        eq(bookings.merchantId, merchantId),
        gte(bookings.startTime, start),
        lte(bookings.startTime, end),
        sql`${bookings.status} NOT IN ('cancelled', 'no_show')`
      )
    )
    .groupBy(bookings.bookingSource)
    .orderBy(sql`count(${bookings.id}) desc`);

  return c.json({
    period: periodParam,
    booking_sources: rows.map((r) => ({
      source: r.source,
      count: Number(r.count),
      revenue: parseFloat(Number(r.revenue).toFixed(2)),
    })),
  });
});

export { analyticsRouter };
