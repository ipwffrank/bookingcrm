import { Hono } from "hono";
import { eq, and, gte, lte, gt, sql, inArray } from "drizzle-orm";
import { db, bookings, clients, clientProfiles, services, staff, reviews, clientPackages, merchants } from "@glowos/db";
import { requireMerchant } from "../middleware/auth.js";
import type { AppVariables } from "../lib/types.js";
import {
  aggregateUtilization,
  aggregateCohortRetention,
  aggregateRebookLag,
  computeDigestMetrics,
} from "../lib/analytics-aggregator.js";
import { renderAnalyticsPdf, analyticsPdfFilename } from "../lib/analytics-pdf.js";

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

/**
 * Resolve the date window for an analytics request. Accepts either:
 *   from / to   explicit ISO dates (YYYY-MM-DD or full ISO timestamp)
 *   period      shorthand: '7d' | '30d' | '90d' (used as fallback)
 *
 * The previous-period bounds are calculated as a window of equal length
 * immediately preceding the current window — used by the YoY/% change
 * comparison badges throughout the analytics page.
 */
function resolveBounds(
  from: string | undefined,
  to: string | undefined,
  period: string,
): { start: Date; end: Date; prevStart: Date; prevEnd: Date } {
  if (from && to) {
    const start = new Date(from);
    const end = new Date(to);
    if (!Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime()) && start.getTime() <= end.getTime()) {
      const span = end.getTime() - start.getTime();
      const prevEnd = new Date(start.getTime() - 1);
      const prevStart = new Date(prevEnd.getTime() - span);
      return { start, end, prevStart, prevEnd };
    }
  }
  return getPeriodBounds(getPeriodDays(period));
}

function pctChange(current: number, previous: number): number | null {
  if (previous === 0) return current > 0 ? 100 : null;
  return parseFloat((((current - previous) / previous) * 100).toFixed(1));
}

// ─── GET /merchant/analytics/summary ─────────────────────────────────────────

analyticsRouter.get("/summary", requireMerchant, async (c) => {
  const merchantId = c.get("merchantId")!;
  const periodParam = c.req.query("period") ?? "30d";
  const { start, end, prevStart, prevEnd } = resolveBounds(c.req.query("from"), c.req.query("to"), periodParam);

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
  const { start, end } = resolveBounds(c.req.query("from"), c.req.query("to"), periodParam);

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
  const { start, end } = resolveBounds(c.req.query("from"), c.req.query("to"), periodParam);

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
  const { start, end } = resolveBounds(c.req.query("from"), c.req.query("to"), periodParam);

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
  const { start, end } = resolveBounds(c.req.query("from"), c.req.query("to"), periodParam);

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

// ─── GET /merchant/analytics/revenue-by-client-segment ────────────────────────
// Splits revenue into three mutually-exclusive buckets so the merchant can see
// where money is actually coming from, beyond just channel:
//   walk-in    booking_source IN ('walkin_manual', 'walkin') — physical
//              counter trade, regardless of whether the client is new or old
//   new        client's first ever non-cancelled booking at this merchant
//   returning  client has a prior non-cancelled booking
//
// Walk-in deliberately trumps new/returning — a returning customer who walks
// in still belongs in the walk-in bucket because the operational pattern is
// different (no slot held, no advance notice). The existing /booking-sources
// endpoint shows channel mix; /client-retention shows new-vs-returning
// counts. This is the missing combination: revenue × client segment.

analyticsRouter.get("/revenue-by-client-segment", requireMerchant, async (c) => {
  const merchantId = c.get("merchantId")!;
  const periodParam = c.req.query("period") ?? "30d";
  const { start, end } = resolveBounds(c.req.query("from"), c.req.query("to"), periodParam);

  // Raw SQL via db.execute — Drizzle's groupBy(sql`segment`) doesn't reliably
  // resolve to the CASE alias across all builders. CTE wrap also makes the
  // correlated EXISTS subquery against the bookings table unambiguous.
  const result = await db.execute(sql`
    WITH classified AS (
      SELECT
        CASE
          WHEN b.booking_source IN ('walkin_manual', 'walkin') THEN 'walkin'
          WHEN NOT EXISTS (
            SELECT 1 FROM bookings b2
            WHERE b2.merchant_id = b.merchant_id
              AND b2.client_id   = b.client_id
              AND b2.start_time  < b.start_time
              AND b2.status NOT IN ('cancelled', 'no_show')
          ) THEN 'new'
          ELSE 'returning'
        END AS segment,
        b.price_sgd
      FROM bookings b
      WHERE b.merchant_id = ${merchantId}
        AND b.start_time >= ${start.toISOString()}
        AND b.start_time <= ${end.toISOString()}
        AND b.status NOT IN ('cancelled', 'no_show')
    )
    SELECT
      segment,
      cast(count(*) as int) AS count,
      coalesce(sum(price_sgd::numeric), 0) AS revenue
    FROM classified
    GROUP BY segment
  `);
  const rows = (result.rows ?? []) as Array<{ segment: string; count: number; revenue: string | number }>;

  // Backfill any missing segment with zeros so the frontend doesn't need
  // null-checks per bucket.
  const byKey = new Map<string, { count: number; revenue: number }>();
  for (const r of rows) {
    byKey.set(r.segment, { count: Number(r.count), revenue: Number(r.revenue) });
  }
  const segmentDefs: Array<{ key: "new" | "returning" | "walkin"; label: string }> = [
    { key: "new",       label: "New clients" },
    { key: "returning", label: "Returning clients" },
    { key: "walkin",    label: "Walk-ins" },
  ];
  const segments = segmentDefs.map((s) => {
    const v = byKey.get(s.key) ?? { count: 0, revenue: 0 };
    return {
      key: s.key,
      label: s.label,
      bookings: v.count,
      revenue: parseFloat(v.revenue.toFixed(2)),
    };
  });
  const totalBookings = segments.reduce((sum, s) => sum + s.bookings, 0);
  const totalRevenue = segments.reduce((sum, s) => sum + s.revenue, 0);

  return c.json({
    period: periodParam,
    currency: "SGD",
    segments,
    totals: { bookings: totalBookings, revenue: parseFloat(totalRevenue.toFixed(2)) },
  });
});

// ─── GET /merchant/analytics/cancellation-rate ────────────────────────────────

analyticsRouter.get("/cancellation-rate", requireMerchant, async (c) => {
  const merchantId = c.get("merchantId")!;
  const periodParam = c.req.query("period") ?? "30d";
  const { start, end } = resolveBounds(c.req.query("from"), c.req.query("to"), periodParam);

  const [totals] = await db
    .select({
      total:     sql<number>`cast(count(*) as int)`,
      cancelled: sql<number>`cast(sum(case when ${bookings.status} = 'cancelled' then 1 else 0 end) as int)`,
      no_show:   sql<number>`cast(sum(case when ${bookings.status} = 'no_show' then 1 else 0 end) as int)`,
      completed: sql<number>`cast(sum(case when ${bookings.status} = 'completed' then 1 else 0 end) as int)`,
      confirmed: sql<number>`cast(sum(case when ${bookings.status} = 'confirmed' then 1 else 0 end) as int)`,
      in_progress: sql<number>`cast(sum(case when ${bookings.status} = 'in_progress' then 1 else 0 end) as int)`,
    })
    .from(bookings)
    .where(and(eq(bookings.merchantId, merchantId), gte(bookings.startTime, start), lte(bookings.startTime, end)));

  const total     = Number(totals?.total ?? 0);
  const cancelled = Number(totals?.cancelled ?? 0);
  const noShow    = Number(totals?.no_show ?? 0);
  const completed = Number(totals?.completed ?? 0);

  return c.json({
    period: periodParam,
    total,
    cancelled,
    no_show:          noShow,
    completed,
    confirmed:        Number(totals?.confirmed ?? 0),
    in_progress:      Number(totals?.in_progress ?? 0),
    cancellation_rate: total > 0 ? parseFloat(((cancelled / total) * 100).toFixed(1)) : 0,
    no_show_rate:      total > 0 ? parseFloat(((noShow / total) * 100).toFixed(1)) : 0,
    completion_rate:   total > 0 ? parseFloat(((completed / total) * 100).toFixed(1)) : 0,
  });
});

// ─── GET /merchant/analytics/peak-hours ──────────────────────────────────────

analyticsRouter.get("/peak-hours", requireMerchant, async (c) => {
  const merchantId = c.get("merchantId")!;
  const periodParam = c.req.query("period") ?? "30d";
  const { start, end } = resolveBounds(c.req.query("from"), c.req.query("to"), periodParam);

  const rows = await db
    .select({
      dow:  sql<number>`cast(extract(dow from ${bookings.startTime} AT TIME ZONE 'Asia/Singapore') as int)`,
      hour: sql<number>`cast(extract(hour from ${bookings.startTime} AT TIME ZONE 'Asia/Singapore') as int)`,
      count: sql<number>`cast(count(*) as int)`,
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
    .groupBy(
      sql`extract(dow from ${bookings.startTime} AT TIME ZONE 'Asia/Singapore')`,
      sql`extract(hour from ${bookings.startTime} AT TIME ZONE 'Asia/Singapore')`
    );

  return c.json({
    period: periodParam,
    // dow: 0=Sun … 6=Sat, hour: 0–23
    peak_hours: rows.map(r => ({
      dow:   Number(r.dow),
      hour:  Number(r.hour),
      count: Number(r.count),
    })),
  });
});

// ─── GET /merchant/analytics/client-retention ────────────────────────────────

analyticsRouter.get("/client-retention", requireMerchant, async (c) => {
  const merchantId = c.get("merchantId")!;
  const periodParam = c.req.query("period") ?? "30d";
  const { start, end } = resolveBounds(c.req.query("from"), c.req.query("to"), periodParam);

  // Clients with bookings in this period
  const activeInPeriod = await db
    .select({ clientId: bookings.clientId })
    .from(bookings)
    .where(
      and(
        eq(bookings.merchantId, merchantId),
        gte(bookings.startTime, start),
        lte(bookings.startTime, end),
        sql`${bookings.status} NOT IN ('cancelled', 'no_show')`
      )
    )
    .groupBy(bookings.clientId);

  const activeIds = activeInPeriod.map(r => r.clientId).filter(Boolean) as string[];

  if (activeIds.length === 0) {
    return c.json({ period: periodParam, new_clients: 0, returning_clients: 0, total_active: 0 });
  }

  // Of those, which had a booking BEFORE this period?
  const returningRows = await db
    .select({ clientId: bookings.clientId })
    .from(bookings)
    .where(
      and(
        eq(bookings.merchantId, merchantId),
        sql`${bookings.startTime} < ${start.toISOString()}`,
        sql`${bookings.clientId} IN (${sql.join(activeIds.map(id => sql`${id}::uuid`), sql`, `)})`,
        sql`${bookings.status} NOT IN ('cancelled', 'no_show')`
      )
    )
    .groupBy(bookings.clientId);

  const returningCount = returningRows.length;
  const newCount       = activeIds.length - returningCount;

  return c.json({
    period:             periodParam,
    new_clients:        newCount,
    returning_clients:  returningCount,
    total_active:       activeIds.length,
  });
});

// ─── GET /merchant/analytics/revenue-by-dow ──────────────────────────────────

analyticsRouter.get("/revenue-by-dow", requireMerchant, async (c) => {
  const merchantId = c.get("merchantId")!;
  const periodParam = c.req.query("period") ?? "30d";
  const { start, end } = resolveBounds(c.req.query("from"), c.req.query("to"), periodParam);

  const rows = await db
    .select({
      dow:     sql<number>`cast(extract(dow from ${bookings.startTime} AT TIME ZONE 'Asia/Singapore') as int)`,
      revenue: sql<number>`coalesce(sum(cast(${bookings.priceSgd} as numeric)), 0)`,
      count:   sql<number>`cast(count(*) as int)`,
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
    .groupBy(sql`extract(dow from ${bookings.startTime} AT TIME ZONE 'Asia/Singapore')`);

  const DOW_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const map = new Map(rows.map(r => [Number(r.dow), { revenue: Number(r.revenue), count: Number(r.count) }]));

  return c.json({
    period: periodParam,
    revenue_by_dow: DOW_LABELS.map((label, dow) => ({
      dow,
      label,
      revenue: parseFloat((map.get(dow)?.revenue ?? 0).toFixed(2)),
      count:   map.get(dow)?.count ?? 0,
    })),
  });
});

// ─── GET /merchant/analytics/review-distribution ──────────────────────────────

analyticsRouter.get("/review-distribution", requireMerchant, async (c) => {
  const merchantId = c.get("merchantId")!;
  const periodParam = c.req.query("period") ?? "30d";
  const { start, end } = resolveBounds(c.req.query("from"), c.req.query("to"), periodParam);

  const rows = await db
    .select({
      rating: reviews.rating,
      count: sql<number>`cast(count(*) as int)`,
    })
    .from(reviews)
    .where(
      and(
        eq(reviews.merchantId, merchantId),
        gte(reviews.createdAt, start),
        lte(reviews.createdAt, end)
      )
    )
    .groupBy(reviews.rating)
    .orderBy(sql`${reviews.rating} desc`);

  const total = rows.reduce((sum, r) => sum + Number(r.count), 0);

  const distribution = [5, 4, 3, 2, 1].map(rating => {
    const row = rows.find(r => r.rating === rating);
    const count = row ? Number(row.count) : 0;
    return {
      rating,
      count,
      percentage: total > 0 ? parseFloat(((count / total) * 100).toFixed(1)) : 0,
    };
  });

  return c.json({ period: periodParam, distribution });
});

// ─── GET /merchant/analytics/review-trend ─────────────────────────────────────

analyticsRouter.get("/review-trend", requireMerchant, async (c) => {
  const merchantId = c.get("merchantId")!;
  const periodParam = c.req.query("period") ?? "30d";
  const { start, end } = resolveBounds(c.req.query("from"), c.req.query("to"), periodParam);

  const rows = await db
    .select({
      week: sql<string>`to_char(date_trunc('week', ${reviews.createdAt}), 'YYYY-MM-DD')`,
      avgRating: sql<number>`avg(cast(${reviews.rating} as numeric))`,
      count: sql<number>`cast(count(*) as int)`,
    })
    .from(reviews)
    .where(
      and(
        eq(reviews.merchantId, merchantId),
        gte(reviews.createdAt, start),
        lte(reviews.createdAt, end)
      )
    )
    .groupBy(sql`date_trunc('week', ${reviews.createdAt})`)
    .orderBy(sql`date_trunc('week', ${reviews.createdAt}) asc`);

  return c.json({
    period: periodParam,
    trend: rows.map(r => ({
      week: r.week,
      avgRating: parseFloat(Number(r.avgRating).toFixed(1)),
      count: Number(r.count),
    })),
  });
});

// ─── GET /merchant/analytics/first-timer-roi ──────────────────────────────

analyticsRouter.get("/first-timer-roi", requireMerchant, async (c) => {
  const merchantId = c.get("merchantId")!;
  const periodParam = c.req.query("period") ?? "30d";
  const fromParam = c.req.query("from");
  const toParam = c.req.query("to");

  let start: Date;
  let end: Date;

  if (periodParam === "custom") {
    if (!fromParam || !toParam) {
      return c.json({ error: "Bad Request", message: "custom period requires from and to" }, 400);
    }
    const f = new Date(fromParam);
    const t = new Date(toParam);
    if (Number.isNaN(f.getTime()) || Number.isNaN(t.getTime()) || f.getTime() > t.getTime()) {
      return c.json({ error: "Bad Request", message: "invalid from/to dates" }, 400);
    }
    start = f;
    end = t;
  } else {
    let days: number;
    if (periodParam === "7d") days = 7;
    else if (periodParam === "30d") days = 30;
    else if (periodParam === "90d") days = 90;
    else if (periodParam === "365d") days = 365;
    else if (periodParam === "all") days = 36500;
    else return c.json({ error: "Bad Request", message: "invalid period" }, 400);
    end = new Date();
    start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
  }

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  // 1. First-timer bookings in period (with join to services for base price)
  const firstTimerRows = await db
    .select({
      bookingId: bookings.id,
      clientId: bookings.clientId,
      startTime: bookings.startTime,
      priceSgd: bookings.priceSgd,
      serviceBasePrice: services.priceSgd,
    })
    .from(bookings)
    .innerJoin(services, eq(bookings.serviceId, services.id))
    .where(
      and(
        eq(bookings.merchantId, merchantId),
        eq(bookings.firstTimerDiscountApplied, true),
        eq(bookings.status, "completed"),
        gte(bookings.startTime, start),
        lte(bookings.startTime, end)
      )
    );

  const firstTimersCount = firstTimerRows.length;

  // 2. Total discount given — sum(base_price - paid_price) across first-timer bookings
  const discountGiven = firstTimerRows.reduce((sum, r) => {
    const base = parseFloat(r.serviceBasePrice);
    const paid = parseFloat(r.priceSgd);
    return sum + Math.max(0, base - paid);
  }, 0);

  // 3. Mature cohort — first-timers whose first booking was ≥ 30d ago
  const matureRows = firstTimerRows.filter((r) => r.startTime < thirtyDaysAgo);
  const matureFirstTimersCount = matureRows.length;

  // 4. For each mature first-timer, count return visits and return revenue
  let returnedCount = 0;
  let returnRevenue = 0;
  for (const r of matureRows) {
    const laterBookings = await db
      .select({ priceSgd: bookings.priceSgd })
      .from(bookings)
      .where(
        and(
          eq(bookings.merchantId, merchantId),
          eq(bookings.clientId, r.clientId),
          eq(bookings.status, "completed"),
          gt(bookings.startTime, r.startTime)
        )
      );
    if (laterBookings.length > 0) {
      returnedCount += 1;
      returnRevenue += laterBookings.reduce(
        (s, b) => s + parseFloat(b.priceSgd),
        0
      );
    }
  }

  const returnRatePct =
    matureFirstTimersCount === 0
      ? null
      : Math.round((returnedCount / matureFirstTimersCount) * 100);

  const netRoi = returnRevenue - discountGiven;

  return c.json({
    period: periodParam,
    first_timers_count: firstTimersCount,
    discount_given_sgd: discountGiven.toFixed(2),
    mature_first_timers_count: matureFirstTimersCount,
    returned_count: returnedCount,
    return_rate_pct: returnRatePct,
    return_revenue_sgd: returnRevenue.toFixed(2),
    net_roi_sgd: netRoi.toFixed(2),
  });
});

// ─── GET /merchant/analytics/today-revenue ────────────────────────────────────

analyticsRouter.get("/today-revenue", requireMerchant, async (c) => {
  const merchantId = c.get("merchantId")!;

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

  // Completed + in-progress: sum(priceSgd) where startTime is today
  const completedRows = await db
    .select({ price: bookings.priceSgd })
    .from(bookings)
    .where(
      and(
        eq(bookings.merchantId, merchantId),
        inArray(bookings.status, ["completed", "in_progress"]),
        gte(bookings.startTime, startOfToday),
        lte(bookings.startTime, endOfToday)
      )
    );
  const completedRevenue = completedRows.reduce((s, r) => s + Number(r.price), 0);

  // Cancelled: sum(price - refund) where cancelledAt is today
  const cancelledRows = await db
    .select({ price: bookings.priceSgd, refund: bookings.refundAmountSgd })
    .from(bookings)
    .where(
      and(
        eq(bookings.merchantId, merchantId),
        eq(bookings.status, "cancelled"),
        gte(bookings.cancelledAt, startOfToday),
        lte(bookings.cancelledAt, endOfToday)
      )
    );
  const cancelledRetained = cancelledRows.reduce(
    (s, r) => s + (Number(r.price) - Number(r.refund)),
    0
  );

  // No-shows: sum(price - refund) where noShowAt is today
  const noShowRows = await db
    .select({ price: bookings.priceSgd, refund: bookings.refundAmountSgd })
    .from(bookings)
    .where(
      and(
        eq(bookings.merchantId, merchantId),
        eq(bookings.status, "no_show"),
        gte(bookings.noShowAt, startOfToday),
        lte(bookings.noShowAt, endOfToday)
      )
    );
  const noShowRetained = noShowRows.reduce(
    (s, r) => s + (Number(r.price) - Number(r.refund)),
    0
  );

  // Packages: sum(pricePaidSgd) where purchasedAt is today
  const packageRows = await db
    .select({ price: clientPackages.pricePaidSgd })
    .from(clientPackages)
    .where(
      and(
        eq(clientPackages.merchantId, merchantId),
        gte(clientPackages.purchasedAt, startOfToday),
        lte(clientPackages.purchasedAt, endOfToday)
      )
    );
  const packageRevenue = packageRows.reduce((s, r) => s + Number(r.price), 0);

  const total = completedRevenue + cancelledRetained + noShowRetained + packageRevenue;

  return c.json({
    completedRevenue: completedRevenue.toFixed(2),
    cancelledRetained: cancelledRetained.toFixed(2),
    noShowRetained: noShowRetained.toFixed(2),
    packageRevenue: packageRevenue.toFixed(2),
    total: total.toFixed(2),
  });
});

// ─── GET /merchant/analytics/staff-contribution ──────────────────────────────

function periodBounds(period: string): { start: Date; end: Date } {
  const now = new Date();
  if (period === "today") {
    return {
      start: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0),
      end:   new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999),
    };
  }
  if (period === "all") {
    return { start: new Date(0), end: now };
  }
  const days = period === "7d" ? 7 : period === "30d" ? 30 : period === "90d" ? 90 : 30;
  return { start: new Date(now.getTime() - days * 24 * 60 * 60 * 1000), end: now };
}

analyticsRouter.get("/staff-contribution", requireMerchant, async (c) => {
  const merchantId = c.get("merchantId")!;
  const period = c.req.query("period") ?? "today";
  if (!["today", "7d", "30d", "90d", "all"].includes(period)) {
    return c.json({ error: "Bad Request", message: "period must be today|7d|30d|90d|all" }, 400);
  }
  const { start, end } = periodBounds(period);

  const allStaff = await db
    .select({ id: staff.id, name: staff.name })
    .from(staff)
    .where(and(eq(staff.merchantId, merchantId), eq(staff.isActive, true)));

  if (allStaff.length === 0) {
    return c.json({ period, rows: [] });
  }

  const staffIds = allStaff.map((s) => s.id);

  const svcRows = await db
    .select({
      staffId: bookings.staffId,
      total: sql<string>`COALESCE(SUM(${services.priceSgd}), 0)`,
    })
    .from(bookings)
    .innerJoin(services, eq(bookings.serviceId, services.id))
    .where(
      and(
        eq(bookings.merchantId, merchantId),
        inArray(bookings.staffId, staffIds),
        inArray(bookings.status, ["completed", "in_progress"]),
        gte(bookings.startTime, start),
        lte(bookings.startTime, end)
      )
    )
    .groupBy(bookings.staffId);
  const svcMap = new Map(svcRows.map((r) => [r.staffId, Number(r.total)]));

  const pkgRows = await db
    .select({
      staffId: clientPackages.soldByStaffId,
      total: sql<string>`COALESCE(SUM(${clientPackages.pricePaidSgd}), 0)`,
    })
    .from(clientPackages)
    .where(
      and(
        eq(clientPackages.merchantId, merchantId),
        inArray(clientPackages.soldByStaffId, staffIds),
        gte(clientPackages.purchasedAt, start),
        lte(clientPackages.purchasedAt, end)
      )
    )
    .groupBy(clientPackages.soldByStaffId);
  const pkgMap = new Map(pkgRows.map((r) => [r.staffId!, Number(r.total)]));

  const rows = allStaff.map((s) => {
    const svc = svcMap.get(s.id) ?? 0;
    const pkg = pkgMap.get(s.id) ?? 0;
    return {
      staffId: s.id,
      staffName: s.name,
      servicesDelivered: svc.toFixed(2),
      packagesSold: pkg.toFixed(2),
      total: (svc + pkg).toFixed(2),
    };
  });

  rows.sort((a, b) => {
    const d = Number(b.total) - Number(a.total);
    return d !== 0 ? d : a.staffName.localeCompare(b.staffName);
  });

  return c.json({ period, rows });
});

// ─── Capacity utilization ──────────────────────────────────────────────────
//
// Returns headline % + by-day-of-week breakdown for the requested period.
// `headline: null` signals "no usable capacity data" (e.g. zero duties AND
// no operating hours configured) so the UI / digest / AI prompt can
// gracefully suppress the section.

analyticsRouter.get("/utilization", requireMerchant, async (c) => {
  const merchantId = c.get("merchantId")!;
  const period = c.req.query("period") ?? "30d";
  const customStart = c.req.query("start");
  const customEnd = c.req.query("end");

  const bounds = customStart && customEnd
    ? customRangeBounds(customStart, customEnd)
    : getPeriodBounds(getPeriodDays(period));

  const result = await aggregateUtilization({
    merchantId,
    periodStart: bounds.start,
    periodEnd: bounds.end,
    priorPeriodStart: bounds.prevStart,
    priorPeriodEnd: bounds.prevEnd,
  });

  return c.json({
    period: { start: bounds.start, end: bounds.end, label: period },
    headline: result.headline,
    byDayOfWeek: result.byDayOfWeek,
    guards: result.guards,
  });
});

// ─── Cohort retention ──────────────────────────────────────────────────────
//
// Returns 60-day retention for a trailing cohort (period bounds offset by
// 60 days). `headline: null` signals "insufficient sample" (cohort < 5).

analyticsRouter.get("/cohort-retention", requireMerchant, async (c) => {
  const merchantId = c.get("merchantId")!;
  const period = c.req.query("period") ?? "30d";
  const customStart = c.req.query("start");
  const customEnd = c.req.query("end");

  const bounds = customStart && customEnd
    ? customRangeBounds(customStart, customEnd)
    : getPeriodBounds(getPeriodDays(period));

  const result = await aggregateCohortRetention({
    merchantId,
    periodStart: bounds.start,
    periodEnd: bounds.end,
  });

  return c.json({
    period: { start: bounds.start, end: bounds.end, label: period },
    lookforwardDays: result.lookforwardDays,
    cohort: result.cohort,
    headline: result.headline,
    guards: result.guards,
  });
});

// ─── Rebook lag ────────────────────────────────────────────────────────────
//
// Returns 60-day rebook lag distribution for a trailing cohort. Same
// cohort definition as cohort-retention; the 60d+ bin is exactly the
// non-returners. `headline: null` signals "insufficient sample"
// (cohort < 5).

analyticsRouter.get("/rebook-lag", requireMerchant, async (c) => {
  const merchantId = c.get("merchantId")!;
  const period = c.req.query("period") ?? "30d";
  const customStart = c.req.query("start");
  const customEnd = c.req.query("end");

  const bounds = customStart && customEnd
    ? customRangeBounds(customStart, customEnd)
    : getPeriodBounds(getPeriodDays(period));

  const result = await aggregateRebookLag({
    merchantId,
    periodStart: bounds.start,
    periodEnd: bounds.end,
  });

  return c.json({
    period: { start: bounds.start, end: bounds.end, label: period },
    lookforwardDays: result.lookforwardDays,
    cohort: result.cohort,
    headline: result.headline,
    bins: result.bins,
    guards: result.guards,
  });
});

function customRangeBounds(startISO: string, endISO: string) {
  const start = new Date(startISO);
  const end = new Date(endISO);
  const span = end.getTime() - start.getTime();
  const prevStart = new Date(start.getTime() - span);
  const prevEnd = new Date(start.getTime());
  return { start, end, prevStart, prevEnd };
}

// ─── GET /merchant/analytics/export-pdf ──────────────────────────────────────
// Server-rendered PDF report. Replaces the old window.print() button which
// captured the live page DOM (with chrome, loading skeletons, etc.). Pulls
// the same aggregator data the email digest uses, plus a few dashboard-
// specific datasets, and renders a structured 1–2 page report with
// footnotes explaining each metric's derivation.

analyticsRouter.get("/export-pdf", requireMerchant, async (c) => {
  const merchantId = c.get("merchantId")!;
  const periodParam = c.req.query("period") ?? "30d";
  const fromQ = c.req.query("from");
  const toQ = c.req.query("to");
  const { start, end, prevStart, prevEnd } = resolveBounds(fromQ, toQ, periodParam);

  // Period label rendered on the cover. Format: "Last 30 days" /
  // "Last 7 days" / "1 May - 30 May 2026" for custom ranges.
  let periodLabel: string;
  if (fromQ && toQ) {
    periodLabel = `${start.toLocaleDateString("en-SG", { day: "numeric", month: "short" })} – ${end.toLocaleDateString("en-SG", { day: "numeric", month: "short", year: "numeric" })}`;
  } else if (periodParam === "7d") periodLabel = "Last 7 days";
  else if (periodParam === "90d") periodLabel = "Last 90 days";
  else periodLabel = "Last 30 days";

  const [merchant] = await db
    .select({ name: merchants.name, country: merchants.country })
    .from(merchants)
    .where(eq(merchants.id, merchantId))
    .limit(1);

  if (!merchant) {
    return c.json({ error: "Not Found", message: "Merchant not found" }, 404);
  }

  const currency: "SGD" | "MYR" | "HKD" =
    merchant.country === "MY" ? "MYR"
    : merchant.country === "HK" ? "HKD"
    : "SGD";

  // Fetch all data in parallel — same aggregator the email digest uses
  // for the headline KPIs, plus a few dashboard-specific datasets.
  const [
    metrics,
    utilization,
    cohortRetention,
    rebookLag,
    topServicesRows,
    bookingSourcesRows,
    revByDowRows,
  ] = await Promise.all([
    computeDigestMetrics({ merchantId, periodStart: start, periodEnd: end }),
    aggregateUtilization({
      merchantId,
      periodStart: start,
      periodEnd: end,
      priorPeriodStart: prevStart,
      priorPeriodEnd: prevEnd,
    }).catch(() => null),
    aggregateCohortRetention({ merchantId, periodStart: start, periodEnd: end }).catch(() => null),
    aggregateRebookLag({ merchantId, periodStart: start, periodEnd: end }).catch(() => null),
    db
      .select({
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
          sql`${bookings.status} NOT IN ('cancelled', 'no_show')`,
        ),
      )
      .groupBy(bookings.serviceId, services.name)
      .orderBy(sql`sum(cast(${bookings.priceSgd} as numeric)) desc nulls last`)
      .limit(8),
    db
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
          sql`${bookings.status} NOT IN ('cancelled', 'no_show')`,
        ),
      )
      .groupBy(bookings.bookingSource)
      .orderBy(sql`count(${bookings.id}) desc`),
    db
      .select({
        dow: sql<number>`cast(extract(dow from ${bookings.startTime} AT TIME ZONE 'Asia/Singapore') as int)`,
        revenue: sql<number>`coalesce(sum(cast(${bookings.priceSgd} as numeric)), 0)`,
        count: sql<number>`cast(count(*) as int)`,
      })
      .from(bookings)
      .where(
        and(
          eq(bookings.merchantId, merchantId),
          gte(bookings.startTime, start),
          lte(bookings.startTime, end),
          sql`${bookings.status} NOT IN ('cancelled', 'no_show')`,
        ),
      )
      .groupBy(sql`extract(dow from ${bookings.startTime} AT TIME ZONE 'Asia/Singapore')`),
  ]);

  const DOW_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const dowMap = new Map(revByDowRows.map((r) => [Number(r.dow), { revenue: Number(r.revenue), count: Number(r.count) }]));
  const revenueByDow = DOW_LABELS.map((label, dow) => ({
    dow,
    label,
    revenue: dowMap.get(dow)?.revenue ?? 0,
    count: dowMap.get(dow)?.count ?? 0,
  }));

  const pdf = await renderAnalyticsPdf({
    merchantName: merchant.name,
    currency,
    periodLabel,
    periodStart: start,
    periodEnd: end,
    metrics,
    utilization,
    cohortRetention,
    rebookLag,
    topServices: topServicesRows.map((r) => ({
      serviceName: r.service_name,
      bookingsCount: Number(r.bookings_count),
      revenue: parseFloat(Number(r.revenue).toFixed(2)),
    })),
    bookingSources: bookingSourcesRows.map((r) => ({
      source: r.source,
      count: Number(r.count),
      revenue: parseFloat(Number(r.revenue).toFixed(2)),
    })),
    revenueByDow,
  });

  const filename = analyticsPdfFilename({ merchantName: merchant.name, periodLabel });
  return new Response(new Uint8Array(pdf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": String(pdf.length),
      "Cache-Control": "no-store",
    },
  });
});

export { analyticsRouter };
