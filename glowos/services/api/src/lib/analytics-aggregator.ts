import { and, eq, gte, lte, inArray, sql } from "drizzle-orm";
import { db, bookings, reviews, merchants, staff, staffDuties } from "@glowos/db";
import {
  type UtilizationResult,
  UTILIZATION_BOOKING_STATUSES,
  selectDenominatorSource,
  groupBookingsByDow,
  buildDowBuckets,
  assembleResult,
  computeUtilizationPct,
} from "./utilization.js";
import {
  type CohortRetentionResult,
  LOOKFORWARD_DAYS as COHORT_LOOKFORWARD_DAYS,
  computeCohortWindow,
  computeRetentionPct as computeCohortRetentionPct,
  assembleResult as assembleCohortResult,
} from "./cohort-retention.js";
import {
  type RebookLagResult,
  LOOKFORWARD_DAYS as REBOOK_LOOKFORWARD_DAYS,
  computeMedian as computeRebookLagMedian,
  assembleResult as assembleRebookLagResult,
} from "./rebook-lag.js";
import {
  type GroupRollupResult,
  type RateCounts,
  weightedRate,
  mergeRebookLagBins,
} from "./group-rollup.js";

/**
 * Numeric aggregator for the Analytics Digest email reports. Returns the
 * five PR 1 KPIs for a single merchant over a date range, plus the
 * equivalent prior-period values so we can compute deltas in the email.
 *
 * Kept separate from the existing /merchant/analytics routes so the
 * worker doesn't pull HTTP middleware into its execution path. If we
 * find the queries diverging from the dashboard analytics page we'll
 * unify them later — for now they're a parallel implementation.
 */

export interface DigestMetrics {
  merchantId: string;
  periodStart: Date;
  periodEnd: Date;
  // Current period
  revenueSgd: number;
  bookingsCount: number;
  noShowRate: number; // 0..1
  noShowsCount: number;
  cancelledCount: number;
  firstTimerReturnRatePct: number | null; // null when sample too small
  firstTimerSampleSize: number;
  reviewsCount: number;
  averageRating: number | null; // null when no reviews
  // Prior period — same fields, used by the email to render deltas.
  prior: {
    revenueSgd: number;
    bookingsCount: number;
    noShowRate: number;
    noShowsCount: number;
    cancelledCount: number;
    firstTimerReturnRatePct: number | null;
    firstTimerSampleSize: number;
    reviewsCount: number;
    averageRating: number | null;
  };
  // Tactical highlights (PR 1 surfaces these in the email; PR 2 will
  // also feed them into the AI prompt for suggestion generation).
  highlights: {
    busiestDay: { date: string; bookings: number } | null;
    quietestDay: { date: string; bookings: number } | null;
    topServiceByRevenue: { name: string; revenueSgd: number } | null;
  };
}

interface ComputeArgs {
  merchantId: string;
  periodStart: Date;
  periodEnd: Date;
}

/**
 * Compute one period's KPIs against `bookings` + `reviews`. Excludes
 * cancelled and no-show bookings from revenue + bookings count, but
 * counts them separately so the no-show/cancel rates can be derived.
 */
async function computeOne({ merchantId, periodStart, periodEnd }: ComputeArgs) {
  const [agg] = await db
    .select({
      revenueSgd: sql<string>`coalesce(sum(case when ${bookings.status} not in ('cancelled', 'no_show') then cast(${bookings.priceSgd} as numeric) else 0 end), 0)`,
      bookingsCount: sql<number>`cast(count(case when ${bookings.status} not in ('cancelled', 'no_show') then 1 end) as int)`,
      noShowsCount: sql<number>`cast(count(case when ${bookings.status} = 'no_show' then 1 end) as int)`,
      cancelledCount: sql<number>`cast(count(case when ${bookings.status} = 'cancelled' then 1 end) as int)`,
      // Total of (completed + no_show) — the denominator for no-show rate.
      // Excludes cancelled because those weren't expected at the chair.
      attendedOrNoShowCount: sql<number>`cast(count(case when ${bookings.status} in ('completed', 'no_show') then 1 end) as int)`,
    })
    .from(bookings)
    .where(
      and(
        eq(bookings.merchantId, merchantId),
        gte(bookings.startTime, periodStart),
        lte(bookings.startTime, periodEnd),
      ),
    );

  const [reviewAgg] = await db
    .select({
      reviewsCount: sql<number>`cast(count(*) as int)`,
      averageRating: sql<string | null>`avg(${reviews.rating})`,
    })
    .from(reviews)
    .where(
      and(
        eq(reviews.merchantId, merchantId),
        gte(reviews.createdAt, periodStart),
        lte(reviews.createdAt, periodEnd),
      ),
    );

  const noShowRate =
    agg.attendedOrNoShowCount > 0
      ? agg.noShowsCount / agg.attendedOrNoShowCount
      : 0;

  return {
    revenueSgd: parseFloat(agg.revenueSgd ?? "0"),
    bookingsCount: agg.bookingsCount ?? 0,
    noShowsCount: agg.noShowsCount ?? 0,
    cancelledCount: agg.cancelledCount ?? 0,
    noShowRate,
    reviewsCount: reviewAgg.reviewsCount ?? 0,
    averageRating:
      reviewAgg.averageRating === null
        ? null
        : parseFloat(reviewAgg.averageRating),
  };
}

/**
 * First-timer return rate over the period. A first-timer is a client
 * whose first-ever completed booking at this merchant fell within the
 * period. They've "returned" if they have ≥ 1 completed booking
 * strictly after that first one (any time before the period end).
 *
 * We don't gate on the discount flag here (the dashboard's FirstTimerROI
 * route does — but the digest is interested in retention behaviour, not
 * the discount programme effectiveness specifically).
 */
async function computeFirstTimerReturn({
  merchantId,
  periodStart,
  periodEnd,
}: ComputeArgs): Promise<{ ratePct: number | null; sampleSize: number }> {
  // Sub-select: each client's earliest completed booking at this merchant.
  // Filter to those whose earliest fell inside [periodStart, periodEnd].
  // Then check whether they have a later completed booking (any time).
  const rows = await db.execute<{
    sample_size: number;
    returned: number;
  }>(sql`
    WITH first_visits AS (
      SELECT
        client_id,
        MIN(start_time) AS first_at
      FROM bookings
      WHERE merchant_id = ${merchantId}
        AND status = 'completed'
      GROUP BY client_id
    ),
    cohort AS (
      SELECT client_id, first_at
      FROM first_visits
      WHERE first_at >= ${periodStart}
        AND first_at <= ${periodEnd}
    )
    SELECT
      COUNT(*) AS sample_size,
      COUNT(*) FILTER (
        WHERE EXISTS (
          SELECT 1 FROM bookings b2
          WHERE b2.merchant_id = ${merchantId}
            AND b2.client_id = cohort.client_id
            AND b2.status = 'completed'
            AND b2.start_time > cohort.first_at
        )
      ) AS returned
    FROM cohort
  `);

  const row = rows.rows[0];
  if (!row) return { ratePct: null, sampleSize: 0 };
  const sampleSize = Number(row.sample_size ?? 0);
  const returned = Number(row.returned ?? 0);
  // Suppress the metric below 5 first-timers — the rate is too noisy to
  // act on. Email surfaces "—" instead of a misleading percentage.
  if (sampleSize < 5) return { ratePct: null, sampleSize };
  return { ratePct: Math.round((returned / sampleSize) * 100), sampleSize };
}

/**
 * Tactical highlights — the day with the most/fewest bookings (excluding
 * cancelled), and the top service by revenue. Used to seed concrete
 * lines in the email body ("Best day: Sat 26 Apr — 14 bookings").
 */
async function computeHighlights({
  merchantId,
  periodStart,
  periodEnd,
}: ComputeArgs) {
  // Day-by-day booking count.
  const days = await db.execute<{
    day: string;
    count: number;
  }>(sql`
    SELECT
      to_char(date_trunc('day', start_time AT TIME ZONE 'Asia/Singapore'), 'YYYY-MM-DD') AS day,
      COUNT(*)::int AS count
    FROM bookings
    WHERE merchant_id = ${merchantId}
      AND start_time >= ${periodStart}
      AND start_time <= ${periodEnd}
      AND status NOT IN ('cancelled', 'no_show')
    GROUP BY day
    ORDER BY count DESC
  `);

  let busiest: { date: string; bookings: number } | null = null;
  let quietest: { date: string; bookings: number } | null = null;
  if (days.rows.length > 0) {
    const sorted = days.rows;
    const top = sorted[0]!;
    const bot = sorted[sorted.length - 1]!;
    busiest = { date: top.day, bookings: Number(top.count) };
    if (sorted.length > 1) {
      quietest = { date: bot.day, bookings: Number(bot.count) };
    }
  }

  // Top service by revenue.
  const svcRows = await db.execute<{
    service_id: string;
    name: string | null;
    revenue: string;
  }>(sql`
    SELECT
      b.service_id,
      s.name,
      SUM(CAST(b.price_sgd AS numeric))::text AS revenue
    FROM bookings b
    LEFT JOIN services s ON s.id = b.service_id
    WHERE b.merchant_id = ${merchantId}
      AND b.start_time >= ${periodStart}
      AND b.start_time <= ${periodEnd}
      AND b.status NOT IN ('cancelled', 'no_show')
    GROUP BY b.service_id, s.name
    ORDER BY SUM(CAST(b.price_sgd AS numeric)) DESC NULLS LAST
    LIMIT 1
  `);

  const topService =
    svcRows.rows.length > 0 && svcRows.rows[0]!.name
      ? {
          name: svcRows.rows[0]!.name!,
          revenueSgd: parseFloat(svcRows.rows[0]!.revenue ?? "0"),
        }
      : null;

  return { busiestDay: busiest, quietestDay: quietest, topServiceByRevenue: topService };
}

/**
 * Public entry point. Returns the metric set for one merchant + period,
 * along with the equivalent prior period so the email template can show
 * "12% vs prior week" badges.
 */
export async function computeDigestMetrics(args: ComputeArgs): Promise<DigestMetrics> {
  const span = args.periodEnd.getTime() - args.periodStart.getTime();
  const priorEnd = new Date(args.periodStart.getTime() - 1);
  const priorStart = new Date(priorEnd.getTime() - span);

  const [current, prior, ftCurrent, ftPrior, highlights] = await Promise.all([
    computeOne(args),
    computeOne({ merchantId: args.merchantId, periodStart: priorStart, periodEnd: priorEnd }),
    computeFirstTimerReturn(args),
    computeFirstTimerReturn({ merchantId: args.merchantId, periodStart: priorStart, periodEnd: priorEnd }),
    computeHighlights(args),
  ]);

  return {
    merchantId: args.merchantId,
    periodStart: args.periodStart,
    periodEnd: args.periodEnd,
    revenueSgd: current.revenueSgd,
    bookingsCount: current.bookingsCount,
    noShowRate: current.noShowRate,
    noShowsCount: current.noShowsCount,
    cancelledCount: current.cancelledCount,
    firstTimerReturnRatePct: ftCurrent.ratePct,
    firstTimerSampleSize: ftCurrent.sampleSize,
    reviewsCount: current.reviewsCount,
    averageRating: current.averageRating,
    prior: {
      revenueSgd: prior.revenueSgd,
      bookingsCount: prior.bookingsCount,
      noShowRate: prior.noShowRate,
      noShowsCount: prior.noShowsCount,
      cancelledCount: prior.cancelledCount,
      firstTimerReturnRatePct: ftPrior.ratePct,
      firstTimerSampleSize: ftPrior.sampleSize,
      reviewsCount: prior.reviewsCount,
      averageRating: prior.averageRating,
    },
    highlights,
  };
}

/**
 * Resolve the period bounds for a config's frequency at a given "fire
 * moment" (in the merchant's local time). All boundaries are at local
 * midnight (00:00:00) and the upper bound is INCLUSIVE — callers use
 * lte(startTime, periodEnd) so a booking that started exactly at the
 * edge counts.
 *
 *   weekly   → previous Mon..Sun (sends on Mon 09:00 by convention)
 *   monthly  → previous calendar month
 *   yearly   → previous calendar year
 */
export function resolvePeriodForFrequency(args: {
  frequency: "weekly" | "monthly" | "yearly";
  fireAt: Date; // The moment the cron fired in merchant local tz.
}): { periodStart: Date; periodEnd: Date } {
  const { frequency, fireAt } = args;
  const f = new Date(fireAt);
  if (frequency === "weekly") {
    // Previous full week = the 7 days BEFORE the most recent Monday.
    const dow = f.getUTCDay(); // 0=Sun..6=Sat
    const daysSinceMon = dow === 0 ? 6 : dow - 1; // 0 if Mon
    const thisWeekMon = new Date(f);
    thisWeekMon.setUTCDate(f.getUTCDate() - daysSinceMon);
    thisWeekMon.setUTCHours(0, 0, 0, 0);
    const prevWeekMon = new Date(thisWeekMon);
    prevWeekMon.setUTCDate(thisWeekMon.getUTCDate() - 7);
    const prevWeekSun = new Date(thisWeekMon);
    prevWeekSun.setUTCMilliseconds(-1);
    return { periodStart: prevWeekMon, periodEnd: prevWeekSun };
  }
  if (frequency === "monthly") {
    const firstOfThisMonth = new Date(Date.UTC(f.getUTCFullYear(), f.getUTCMonth(), 1));
    const firstOfPrevMonth = new Date(Date.UTC(f.getUTCFullYear(), f.getUTCMonth() - 1, 1));
    const lastOfPrevMonth = new Date(firstOfThisMonth.getTime() - 1);
    return { periodStart: firstOfPrevMonth, periodEnd: lastOfPrevMonth };
  }
  // yearly
  const firstOfThisYear = new Date(Date.UTC(f.getUTCFullYear(), 0, 1));
  const firstOfPrevYear = new Date(Date.UTC(f.getUTCFullYear() - 1, 0, 1));
  const lastOfPrevYear = new Date(firstOfThisYear.getTime() - 1);
  return { periodStart: firstOfPrevYear, periodEnd: lastOfPrevYear };
}

/**
 * Look up the merchant timezone (defaults to Asia/Singapore if unset).
 */
export async function getMerchantTimezone(merchantId: string): Promise<string> {
  const [m] = await db
    .select({ timezone: merchants.timezone })
    .from(merchants)
    .where(eq(merchants.id, merchantId))
    .limit(1);
  return m?.timezone ?? "Asia/Singapore";
}

// ─── Utilization aggregator ──────────────────────────────────────────────
//
// Pulls bookings + duties + operating hours, pushes math to pure helpers
// in `utilization.ts`. Wrapped in a try/catch that returns a suppress-
// everything result so a digest never fails because of utilization compute.

export async function aggregateUtilization(args: {
  merchantId: string;
  periodStart: Date;
  periodEnd: Date;
  priorPeriodStart: Date;
  priorPeriodEnd: Date;
}): Promise<UtilizationResult> {
  try {
    return await aggregateUtilizationInner(args);
  } catch (err) {
    console.error("[utilization] aggregation failed — returning null result", {
      merchantId: args.merchantId,
      error: err instanceof Error ? err.message : String(err),
    });
    return { headline: null, byDayOfWeek: [], guards: { lowSampleDows: [] } };
  }
}

async function aggregateUtilizationInner(args: {
  merchantId: string;
  periodStart: Date;
  periodEnd: Date;
  priorPeriodStart: Date;
  priorPeriodEnd: Date;
}): Promise<UtilizationResult> {
  const merchantTz = await getMerchantTimezone(args.merchantId);

  // Local-date strings (YYYY-MM-DD in merchant tz) for duty range.
  const localStartDate = formatDateInTz(args.periodStart, merchantTz);
  const localEndDate = formatDateInTz(args.periodEnd, merchantTz);
  const priorLocalStartDate = formatDateInTz(args.priorPeriodStart, merchantTz);
  const priorLocalEndDate = formatDateInTz(args.priorPeriodEnd, merchantTz);

  // Bookings (current period) — startTime in UTC, status filtered.
  const currentBookings = await db
    .select({
      startTime: bookings.startTime,
      durationMinutes: bookings.durationMinutes,
    })
    .from(bookings)
    .where(
      and(
        eq(bookings.merchantId, args.merchantId),
        gte(bookings.startTime, args.periodStart),
        lte(bookings.startTime, args.periodEnd),
        inArray(bookings.status, [...UTILIZATION_BOOKING_STATUSES]),
      ),
    );

  // Bookings (prior period) — for delta only.
  const priorBookings = await db
    .select({
      startTime: bookings.startTime,
      durationMinutes: bookings.durationMinutes,
    })
    .from(bookings)
    .where(
      and(
        eq(bookings.merchantId, args.merchantId),
        gte(bookings.startTime, args.priorPeriodStart),
        lte(bookings.startTime, args.priorPeriodEnd),
        inArray(bookings.status, [...UTILIZATION_BOOKING_STATUSES]),
      ),
    );

  // Duties (current period) — date in merchant local, time-of-day fields.
  const duties = await db
    .select({
      date: staffDuties.date,
      startTime: staffDuties.startTime,
      endTime: staffDuties.endTime,
    })
    .from(staffDuties)
    .where(
      and(
        eq(staffDuties.merchantId, args.merchantId),
        gte(staffDuties.date, localStartDate),
        lte(staffDuties.date, localEndDate),
      ),
    );

  // Decide denominator source.
  const periodDays = Math.max(
    1,
    Math.ceil((args.periodEnd.getTime() - args.periodStart.getTime()) / 86_400_000),
  );
  const dutyDayKeys = new Set(duties.map((d) => d.date));
  const source = selectDenominatorSource({
    daysWithDuties: dutyDayKeys.size,
    periodDays,
  });

  // Booked totals + by-DoW.
  const bookedByDow = groupBookingsByDow({ bookings: currentBookings, merchantTz });
  const totalBooked = bookedByDow.reduce((a, b) => a + b, 0);
  const bookingsCountByDow = countBookingsByDow({ bookings: currentBookings, merchantTz });

  // Available totals + by-DoW (branch on source).
  let availableByDow: number[];
  if (source === "duties") {
    availableByDow = computeAvailableByDowFromDuties({ duties, merchantTz });
  } else {
    availableByDow = await computeAvailableByDowFromOperatingHours({
      merchantId: args.merchantId,
      periodStart: args.periodStart,
      periodEnd: args.periodEnd,
      merchantTz,
    });
  }
  const totalAvailable = availableByDow.reduce((a, b) => a + b, 0);

  // Prior-period headline pct for delta (no DoW slice).
  const priorBookedTotal = priorBookings.reduce((a, b) => a + b.durationMinutes, 0);
  const priorAvailableTotal = await computePriorPeriodAvailable({
    merchantId: args.merchantId,
    priorLocalStartDate,
    priorLocalEndDate,
    priorPeriodStart: args.priorPeriodStart,
    priorPeriodEnd: args.priorPeriodEnd,
    merchantTz,
    source,
  });
  const priorHeadlinePct = computeUtilizationPct(priorBookedTotal, priorAvailableTotal);

  return assembleResult({
    bookedMinutes: totalBooked,
    availableMinutes: totalAvailable,
    denominatorSource: source,
    priorUtilizationPct: priorHeadlinePct,
    byDow: buildDowBuckets({ bookedByDow, availableByDow, bookingsCountByDow }),
  });
}

// ─── Utilization helpers ─────────────────────────────────────────────────

const DOW_BY_WEEKDAY_LABEL: Record<string, number> = {
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
};

/** YYYY-MM-DD in the given tz. */
function formatDateInTz(d: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function dowFromLocalDate(dateStr: string, tz: string): number | undefined {
  // dateStr is YYYY-MM-DD in merchant local. Construct a midday timestamp
  // in that tz so the dow is unambiguous regardless of UTC offset.
  const [y, m, d] = dateStr.split("-").map(Number);
  if (!y || !m || !d) return undefined;
  // Create a UTC midday — close enough that any tz lookup lands on the
  // intended date.
  const midday = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" });
  return DOW_BY_WEEKDAY_LABEL[fmt.format(midday)];
}

function countBookingsByDow(args: {
  bookings: Array<{ startTime: Date }>;
  merchantTz: string;
}): number[] {
  const counts = [0, 0, 0, 0, 0, 0, 0];
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: args.merchantTz,
    weekday: "short",
  });
  for (const b of args.bookings) {
    const d = DOW_BY_WEEKDAY_LABEL[fmt.format(b.startTime)];
    if (d !== undefined) counts[d]++;
  }
  return counts;
}

/** Parse "HH:MM" or "HH:MM:SS" to total minutes since midnight. null if invalid. */
function parseTimeOfDay(s: string | null | undefined): number | null {
  if (!s) return null;
  const m = s.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const mm = parseInt(m[2], 10);
  if (h < 0 || h > 23 || mm < 0 || mm > 59) return null;
  return h * 60 + mm;
}

function computeAvailableByDowFromDuties(args: {
  duties: Array<{ date: string; startTime: string; endTime: string }>;
  merchantTz: string;
}): number[] {
  const buckets = [0, 0, 0, 0, 0, 0, 0];
  for (const d of args.duties) {
    const start = parseTimeOfDay(d.startTime);
    const end = parseTimeOfDay(d.endTime);
    if (start === null || end === null || end <= start) continue;
    const dow = dowFromLocalDate(d.date, args.merchantTz);
    if (dow === undefined) continue;
    buckets[dow] += end - start;
  }
  return buckets;
}

async function computeAvailableByDowFromOperatingHours(args: {
  merchantId: string;
  periodStart: Date;
  periodEnd: Date;
  merchantTz: string;
}): Promise<number[]> {
  const [m] = await db
    .select({ operatingHours: merchants.operatingHours })
    .from(merchants)
    .where(eq(merchants.id, args.merchantId))
    .limit(1);
  if (!m?.operatingHours) return [0, 0, 0, 0, 0, 0, 0];

  const [staffCountRow] = await db
    .select({ count: sql<number>`cast(count(*) as int)` })
    .from(staff)
    .where(
      and(
        eq(staff.merchantId, args.merchantId),
        eq(staff.isPubliclyVisible, true),
        eq(staff.isAnyAvailable, false),
      ),
    );
  const headcount = staffCountRow?.count ?? 0;
  if (headcount === 0) return [0, 0, 0, 0, 0, 0, 0];

  // operating_hours can be keyed either by 3-letter abbrev (mon, tue, ...) or
  // by long-form name (monday, tuesday, ...). The UI's settings page writes
  // long-form; some seed scripts wrote 3-letter. Handle both shapes by
  // checking both keys per dow.
  const dowKeys: Array<[string, string]> = [
    ["sun", "sunday"], ["mon", "monday"], ["tue", "tuesday"],
    ["wed", "wednesday"], ["thu", "thursday"], ["fri", "friday"], ["sat", "saturday"],
  ];
  const buckets = [0, 0, 0, 0, 0, 0, 0];
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: args.merchantTz,
    weekday: "short",
  });

  // Walk each calendar day in the period (UTC stride is fine — the dow is
  // still computed in the merchant tz).
  for (
    let cursor = new Date(args.periodStart.getTime());
    cursor < args.periodEnd;
    cursor = new Date(cursor.getTime() + 86_400_000)
  ) {
    const dow = DOW_BY_WEEKDAY_LABEL[fmt.format(cursor)];
    if (dow === undefined) continue;
    const ohRaw = m.operatingHours as Record<string, { open?: string; close?: string; closed?: boolean } | null>;
    const dayConfig = ohRaw[dowKeys[dow][0]] ?? ohRaw[dowKeys[dow][1]];
    if (!dayConfig || dayConfig.closed) continue;
    const open = parseTimeOfDay(dayConfig.open);
    const close = parseTimeOfDay(dayConfig.close);
    if (open === null || close === null || close <= open) continue;
    buckets[dow] += (close - open) * headcount;
  }
  return buckets;
}

async function computePriorPeriodAvailable(args: {
  merchantId: string;
  priorLocalStartDate: string;
  priorLocalEndDate: string;
  priorPeriodStart: Date;
  priorPeriodEnd: Date;
  merchantTz: string;
  source: "duties" | "estimated";
}): Promise<number> {
  if (args.source === "duties") {
    const duties = await db
      .select({
        date: staffDuties.date,
        startTime: staffDuties.startTime,
        endTime: staffDuties.endTime,
      })
      .from(staffDuties)
      .where(
        and(
          eq(staffDuties.merchantId, args.merchantId),
          gte(staffDuties.date, args.priorLocalStartDate),
          lte(staffDuties.date, args.priorLocalEndDate),
        ),
      );
    return computeAvailableByDowFromDuties({ duties, merchantTz: args.merchantTz })
      .reduce((a, b) => a + b, 0);
  }
  const byDow = await computeAvailableByDowFromOperatingHours({
    merchantId: args.merchantId,
    periodStart: args.priorPeriodStart,
    periodEnd: args.priorPeriodEnd,
    merchantTz: args.merchantTz,
  });
  return byDow.reduce((a, b) => a + b, 0);
}

// ─── Cohort retention aggregator ─────────────────────────────────────────
//
// Issues two SQL queries (current cohort + prior cohort) using the same
// CTE shape as `computeFirstTimerReturn`, then assembles via the pure
// helpers in `cohort-retention.ts`. Wrapped in try/catch so a digest
// never fails because of cohort-retention compute.

export async function aggregateCohortRetention(args: {
  merchantId: string;
  periodStart: Date;
  periodEnd: Date;
}): Promise<CohortRetentionResult> {
  try {
    return await aggregateCohortRetentionInner(args);
  } catch (err) {
    console.error("[cohort-retention] aggregation failed — returning null result", {
      merchantId: args.merchantId,
      error: err instanceof Error ? err.message : String(err),
    });
    // Return a valid-shaped result with headline=null so consumers omit
    // the section gracefully. Cohort window reported as the trailing
    // window we WOULD have used so the UI's "insufficient sample" copy
    // can still cite the right date range.
    const cohortWindow = computeCohortWindow({
      periodStart: args.periodStart,
      periodEnd: args.periodEnd,
    });
    return {
      lookforwardDays: COHORT_LOOKFORWARD_DAYS,
      cohort: { windowStart: cohortWindow.windowStart, windowEnd: cohortWindow.windowEnd, size: 0 },
      headline: null,
      guards: { lowSample: true },
    };
  }
}

async function aggregateCohortRetentionInner(args: {
  merchantId: string;
  periodStart: Date;
  periodEnd: Date;
}): Promise<CohortRetentionResult> {
  const cohortWindow = computeCohortWindow({
    periodStart: args.periodStart,
    periodEnd: args.periodEnd,
  });

  const periodLenMs = args.periodEnd.getTime() - args.periodStart.getTime();
  const priorCohortStart = new Date(cohortWindow.windowStart.getTime() - periodLenMs);
  const priorCohortEnd = new Date(cohortWindow.windowEnd.getTime() - periodLenMs);

  // Run both queries in parallel — they're independent.
  const [current, prior] = await Promise.all([
    queryCohort({ merchantId: args.merchantId, cohortStart: cohortWindow.windowStart, cohortEnd: cohortWindow.windowEnd }),
    queryCohort({ merchantId: args.merchantId, cohortStart: priorCohortStart, cohortEnd: priorCohortEnd }),
  ]);

  const priorRetentionPct = computeCohortRetentionPct(prior.returned, prior.sampleSize);

  return assembleCohortResult({
    cohort: {
      windowStart: cohortWindow.windowStart,
      windowEnd: cohortWindow.windowEnd,
      size: current.sampleSize,
    },
    returnedCount: current.returned,
    priorRetentionPct,
  });
}

/**
 * Cohort query — finds first-timers whose earliest 'completed' booking
 * fell in [cohortStart, cohortEnd] AND whose lookforward window has
 * already elapsed (`first_at + LOOKFORWARD_DAYS <= NOW()`). For each
 * cohort member, checks for a 'completed' return within that lookforward.
 */
async function queryCohort(args: {
  merchantId: string;
  cohortStart: Date;
  cohortEnd: Date;
}): Promise<{ sampleSize: number; returned: number }> {
  const rows = await db.execute<{
    sample_size: number;
    returned: number;
  }>(sql`
    WITH first_visits AS (
      SELECT
        client_id,
        MIN(start_time) AS first_at
      FROM bookings
      WHERE merchant_id = ${args.merchantId}
        AND status = 'completed'
      GROUP BY client_id
    ),
    cohort AS (
      SELECT client_id, first_at
      FROM first_visits
      WHERE first_at >= ${args.cohortStart}
        AND first_at <= ${args.cohortEnd}
        AND first_at + (${COHORT_LOOKFORWARD_DAYS} * INTERVAL '1 day') <= NOW()
    )
    SELECT
      COUNT(*) AS sample_size,
      COUNT(*) FILTER (
        WHERE EXISTS (
          SELECT 1 FROM bookings b2
          WHERE b2.merchant_id = ${args.merchantId}
            AND b2.client_id = cohort.client_id
            AND b2.status = 'completed'
            AND b2.start_time > cohort.first_at
            AND b2.start_time <= cohort.first_at + (${COHORT_LOOKFORWARD_DAYS} * INTERVAL '1 day')
        )
      ) AS returned
    FROM cohort
  `);
  const row = rows.rows[0];
  if (!row) return { sampleSize: 0, returned: 0 };
  return {
    sampleSize: Number(row.sample_size ?? 0),
    returned: Number(row.returned ?? 0),
  };
}

// ─── Rebook lag aggregator ────────────────────────────────────────────────
//
// Issues two SQL queries (current cohort + prior cohort) — same cohort
// definition as PR 6, but returns per-cohort-member lag-days instead of
// just a returned/not-returned bit. Wrapped in try/catch so a digest
// never fails because of rebook-lag compute.

export async function aggregateRebookLag(args: {
  merchantId: string;
  periodStart: Date;
  periodEnd: Date;
}): Promise<RebookLagResult> {
  try {
    return await aggregateRebookLagInner(args);
  } catch (err) {
    console.error("[rebook-lag] aggregation failed — returning null result", {
      merchantId: args.merchantId,
      error: err instanceof Error ? err.message : String(err),
    });
    const cohortWindow = computeCohortWindow({
      periodStart: args.periodStart,
      periodEnd: args.periodEnd,
    });
    return {
      lookforwardDays: REBOOK_LOOKFORWARD_DAYS,
      cohort: { windowStart: cohortWindow.windowStart, windowEnd: cohortWindow.windowEnd, size: 0 },
      headline: null,
      bins: [],
      guards: { lowSample: true, medianSuppressed: false },
    };
  }
}

async function aggregateRebookLagInner(args: {
  merchantId: string;
  periodStart: Date;
  periodEnd: Date;
}): Promise<RebookLagResult> {
  const cohortWindow = computeCohortWindow({
    periodStart: args.periodStart,
    periodEnd: args.periodEnd,
  });

  const periodLenMs = args.periodEnd.getTime() - args.periodStart.getTime();
  const priorCohortStart = new Date(cohortWindow.windowStart.getTime() - periodLenMs);
  const priorCohortEnd = new Date(cohortWindow.windowEnd.getTime() - periodLenMs);

  // Run both queries in parallel.
  const [current, prior] = await Promise.all([
    queryRebookLagCohort({
      merchantId: args.merchantId,
      cohortStart: cohortWindow.windowStart,
      cohortEnd: cohortWindow.windowEnd,
    }),
    queryRebookLagCohort({
      merchantId: args.merchantId,
      cohortStart: priorCohortStart,
      cohortEnd: priorCohortEnd,
    }),
  ]);

  // Prior median (for delta only — no bins needed for prior).
  const priorReturnerLags = prior.lagDaysPerMember.filter(
    (l): l is number => l !== null && l <= 60,
  );
  const priorMedianDays = computeRebookLagMedian(priorReturnerLags);

  return assembleRebookLagResult({
    cohort: {
      windowStart: cohortWindow.windowStart,
      windowEnd: cohortWindow.windowEnd,
      size: current.lagDaysPerMember.length,
    },
    lagDaysPerMember: current.lagDaysPerMember,
    priorMedianDays,
  });
}

/**
 * Cohort + lag-days query — finds first-timers whose earliest 'completed'
 * booking fell in [cohortStart, cohortEnd] AND whose lookforward window
 * has elapsed. For each cohort member, returns the lag (in days) to
 * their second 'completed' booking within 60 days of the first, or NULL
 * if no such booking exists.
 */
export async function queryRebookLagCohort(args: {
  merchantId: string;
  cohortStart: Date;
  cohortEnd: Date;
}): Promise<{ lagDaysPerMember: Array<number | null> }> {
  const rows = await db.execute<{ lag_days: number | null }>(sql`
    WITH first_visits AS (
      SELECT
        client_id,
        MIN(start_time) AS first_at
      FROM bookings
      WHERE merchant_id = ${args.merchantId}
        AND status = 'completed'
      GROUP BY client_id
    ),
    cohort AS (
      SELECT client_id, first_at
      FROM first_visits
      WHERE first_at >= ${args.cohortStart}
        AND first_at <= ${args.cohortEnd}
        AND first_at + (${REBOOK_LOOKFORWARD_DAYS} * INTERVAL '1 day') <= NOW()
    ),
    second_visits AS (
      SELECT
        c.client_id,
        c.first_at,
        (
          SELECT MIN(b2.start_time)
          FROM bookings b2
          WHERE b2.merchant_id = ${args.merchantId}
            AND b2.client_id = c.client_id
            AND b2.status = 'completed'
            AND b2.start_time > c.first_at
            AND b2.start_time <= c.first_at + (${REBOOK_LOOKFORWARD_DAYS} * INTERVAL '1 day')
        ) AS second_at
      FROM cohort c
    )
    SELECT
      CASE
        WHEN second_at IS NULL THEN NULL
        ELSE FLOOR(EXTRACT(EPOCH FROM (second_at - first_at)) / 86400)::int
      END AS lag_days
    FROM second_visits
  `);

  return {
    lagDaysPerMember: rows.rows.map((r) =>
      r.lag_days === null || r.lag_days === undefined ? null : Number(r.lag_days),
    ),
  };
}

// ─── Group resolution ────────────────────────────────────────────────────
//
// Returns the active branches in a group. Used by all four
// `aggregate*ForGroup` wrappers as the first step.

export async function resolveBranchesForGroup(groupId: string): Promise<Array<{
  merchantId: string;
  merchantName: string;
  timezone: string;
}>> {
  const rows = await db
    .select({
      merchantId: merchants.id,
      merchantName: merchants.name,
      timezone: merchants.timezone,
    })
    .from(merchants)
    .where(eq(merchants.groupId, groupId))
    .orderBy(merchants.name);

  return rows;
}

// ─── Group-rollup: digest metrics ────────────────────────────────────────
//
// Calls computeDigestMetrics in parallel for each branch in the group,
// then composes a group-level DigestMetrics via weighted aggregation.
// Per-branch results are returned alongside for the email/PDF/AI prompt
// to render the per-branch comparison table.

export async function computeDigestMetricsForGroup(args: {
  groupId: string;
  periodStart: Date;
  periodEnd: Date;
}): Promise<GroupRollupResult<DigestMetrics>> {
  const branches = await resolveBranchesForGroup(args.groupId);
  if (branches.length === 0) {
    return {
      group: emptyDigestMetrics(args.groupId, args.periodStart, args.periodEnd),
      perBranch: [],
    };
  }

  const perBranchSettled = await Promise.allSettled(
    branches.map((b) =>
      computeDigestMetrics({
        merchantId: b.merchantId,
        periodStart: args.periodStart,
        periodEnd: args.periodEnd,
      }),
    ),
  );

  const perBranch: GroupRollupResult<DigestMetrics>["perBranch"] = [];
  const successfulBranches: DigestMetrics[] = [];
  perBranchSettled.forEach((r, i) => {
    if (r.status === "fulfilled") {
      successfulBranches.push(r.value);
      perBranch.push({
        merchantId: branches[i].merchantId,
        merchantName: branches[i].merchantName,
        metrics: r.value,
      });
    } else {
      console.warn("[group-rollup] computeDigestMetrics failed for branch — omitting", {
        merchantId: branches[i].merchantId,
        error: r.reason instanceof Error ? r.reason.message : String(r.reason),
      });
    }
  });

  if (successfulBranches.length === 0) {
    return {
      group: emptyDigestMetrics(args.groupId, args.periodStart, args.periodEnd),
      perBranch,
    };
  }

  const sumNum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  const m = successfulBranches;

  const noShowCounts: RateCounts[] = m.map((x) => ({
    numerator: x.noShowsCount,
    denominator: x.noShowRate > 0 ? Math.round(x.noShowsCount / x.noShowRate) : x.bookingsCount + x.noShowsCount,
  }));
  const noShowRate = weightedRate(noShowCounts) ?? 0;

  const ftCounts: RateCounts[] = m
    .filter((x) => x.firstTimerReturnRatePct !== null)
    .map((x) => ({
      numerator: Math.round((x.firstTimerReturnRatePct! / 100) * x.firstTimerSampleSize),
      denominator: x.firstTimerSampleSize,
    }));
  const ftRate = weightedRate(ftCounts);
  const ftRatePct = ftRate === null ? null : Math.round(ftRate * 1000) / 10;
  const ftSampleSize = sumNum(m.map((x) => x.firstTimerSampleSize));

  const ratingCounts: RateCounts[] = m
    .filter((x) => x.averageRating !== null && x.reviewsCount > 0)
    .map((x) => ({
      numerator: x.averageRating! * x.reviewsCount,
      denominator: x.reviewsCount,
    }));
  const avgRating = weightedRate(ratingCounts);

  const allBusiestDays = m.map((x) => x.highlights.busiestDay).filter((d) => d !== null) as Array<{ date: string; bookings: number }>;
  const allQuietestDays = m.map((x) => x.highlights.quietestDay).filter((d) => d !== null) as Array<{ date: string; bookings: number }>;

  const serviceRevenue = new Map<string, number>();
  for (const branch of m) {
    if (branch.highlights.topServiceByRevenue) {
      const ts = branch.highlights.topServiceByRevenue;
      serviceRevenue.set(ts.name, (serviceRevenue.get(ts.name) ?? 0) + ts.revenueSgd);
    }
  }
  let topService: { name: string; revenueSgd: number } | null = null;
  for (const [name, rev] of serviceRevenue) {
    if (topService === null || rev > topService.revenueSgd) {
      topService = { name, revenueSgd: rev };
    }
  }

  const priorNoShowCounts: RateCounts[] = m.map((x) => ({
    numerator: x.prior.noShowsCount,
    denominator: x.prior.noShowRate > 0 ? Math.round(x.prior.noShowsCount / x.prior.noShowRate) : x.prior.bookingsCount + x.prior.noShowsCount,
  }));
  const priorFtCounts: RateCounts[] = m
    .filter((x) => x.prior.firstTimerReturnRatePct !== null)
    .map((x) => ({
      numerator: Math.round((x.prior.firstTimerReturnRatePct! / 100) * x.prior.firstTimerSampleSize),
      denominator: x.prior.firstTimerSampleSize,
    }));
  const priorRatingCounts: RateCounts[] = m
    .filter((x) => x.prior.averageRating !== null && x.prior.reviewsCount > 0)
    .map((x) => ({ numerator: x.prior.averageRating! * x.prior.reviewsCount, denominator: x.prior.reviewsCount }));

  const groupResult: DigestMetrics = {
    merchantId: args.groupId,
    periodStart: args.periodStart,
    periodEnd: args.periodEnd,
    revenueSgd: sumNum(m.map((x) => x.revenueSgd)),
    bookingsCount: sumNum(m.map((x) => x.bookingsCount)),
    noShowRate,
    noShowsCount: sumNum(m.map((x) => x.noShowsCount)),
    cancelledCount: sumNum(m.map((x) => x.cancelledCount)),
    firstTimerReturnRatePct: ftRatePct,
    firstTimerSampleSize: ftSampleSize,
    reviewsCount: sumNum(m.map((x) => x.reviewsCount)),
    averageRating: avgRating === null ? null : Math.round(avgRating * 10) / 10,
    prior: {
      revenueSgd: sumNum(m.map((x) => x.prior.revenueSgd)),
      bookingsCount: sumNum(m.map((x) => x.prior.bookingsCount)),
      noShowRate: weightedRate(priorNoShowCounts) ?? 0,
      noShowsCount: sumNum(m.map((x) => x.prior.noShowsCount)),
      cancelledCount: sumNum(m.map((x) => x.prior.cancelledCount)),
      firstTimerReturnRatePct: (() => {
        const r = weightedRate(priorFtCounts);
        return r === null ? null : Math.round(r * 1000) / 10;
      })(),
      firstTimerSampleSize: sumNum(m.map((x) => x.prior.firstTimerSampleSize)),
      reviewsCount: sumNum(m.map((x) => x.prior.reviewsCount)),
      averageRating: (() => {
        const r = weightedRate(priorRatingCounts);
        return r === null ? null : Math.round(r * 10) / 10;
      })(),
    },
    highlights: {
      busiestDay: allBusiestDays.length > 0
        ? allBusiestDays.reduce((max, d) => d.bookings > max.bookings ? d : max)
        : null,
      quietestDay: allQuietestDays.length > 0
        ? allQuietestDays.reduce((min, d) => d.bookings < min.bookings ? d : min)
        : null,
      topServiceByRevenue: topService,
    },
  };

  return { group: groupResult, perBranch };
}

/** Empty result shape for the zero-active-branch case. */
function emptyDigestMetrics(groupId: string, periodStart: Date, periodEnd: Date): DigestMetrics {
  return {
    merchantId: groupId,
    periodStart,
    periodEnd,
    revenueSgd: 0,
    bookingsCount: 0,
    noShowRate: 0,
    noShowsCount: 0,
    cancelledCount: 0,
    firstTimerReturnRatePct: null,
    firstTimerSampleSize: 0,
    reviewsCount: 0,
    averageRating: null,
    prior: {
      revenueSgd: 0, bookingsCount: 0, noShowRate: 0, noShowsCount: 0,
      cancelledCount: 0, firstTimerReturnRatePct: null, firstTimerSampleSize: 0,
      reviewsCount: 0, averageRating: null,
    },
    highlights: { busiestDay: null, quietestDay: null, topServiceByRevenue: null },
  };
}

// ─── Group-rollup: utilization ───────────────────────────────────────────

export async function aggregateUtilizationForGroup(args: {
  groupId: string;
  periodStart: Date;
  periodEnd: Date;
  priorPeriodStart: Date;
  priorPeriodEnd: Date;
}): Promise<GroupRollupResult<UtilizationResult>> {
  const branches = await resolveBranchesForGroup(args.groupId);
  if (branches.length === 0) {
    return {
      group: { headline: null, byDayOfWeek: [], guards: { lowSampleDows: [] } },
      perBranch: [],
    };
  }

  const perBranchSettled = await Promise.allSettled(
    branches.map((b) =>
      aggregateUtilization({
        merchantId: b.merchantId,
        periodStart: args.periodStart,
        periodEnd: args.periodEnd,
        priorPeriodStart: args.priorPeriodStart,
        priorPeriodEnd: args.priorPeriodEnd,
      }),
    ),
  );

  const perBranch: GroupRollupResult<UtilizationResult>["perBranch"] = [];
  const successful: UtilizationResult[] = [];
  perBranchSettled.forEach((r, i) => {
    if (r.status === "fulfilled") {
      successful.push(r.value);
      perBranch.push({
        merchantId: branches[i].merchantId,
        merchantName: branches[i].merchantName,
        metrics: r.value,
      });
    } else {
      console.warn("[group-rollup] aggregateUtilization failed for branch — omitting", {
        merchantId: branches[i].merchantId,
        error: r.reason instanceof Error ? r.reason.message : String(r.reason),
      });
    }
  });

  const withHeadline = successful.filter((r) => r.headline !== null);
  if (withHeadline.length === 0) {
    return {
      group: { headline: null, byDayOfWeek: [], guards: { lowSampleDows: [] } },
      perBranch,
    };
  }

  const totalBooked = withHeadline.reduce((sum, r) => sum + r.headline!.bookedMinutes, 0);
  const totalAvailable = withHeadline.reduce((sum, r) => sum + r.headline!.availableMinutes, 0);
  const groupPct = totalAvailable > 0
    ? Math.round((totalBooked / totalAvailable) * 1000) / 10
    : null;

  const dowBuckets = [0, 1, 2, 3, 4, 5, 6].map((dow) => {
    let booked = 0;
    let available = 0;
    let bookings = 0;
    for (const r of withHeadline) {
      const branchDow = r.byDayOfWeek.find((b) => b.dow === dow);
      if (branchDow) {
        booked += branchDow.bookedMinutes;
        available += branchDow.availableMinutes;
        bookings += Math.round(branchDow.bookedMinutes / 60);
      }
    }
    return {
      dow,
      label: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][dow],
      bookedMinutes: booked,
      availableMinutes: available,
      utilizationPct: available > 0 ? Math.round((booked / available) * 1000) / 10 : null,
      lowSample: bookings < 10,
    };
  });

  const sourceCounts = { duties: 0, estimated: 0 };
  for (const r of withHeadline) sourceCounts[r.headline!.denominatorSource]++;
  const denominatorSource: "duties" | "estimated" =
    sourceCounts.duties >= sourceCounts.estimated ? "duties" : "estimated";

  const priorBookedTotal = withHeadline.reduce((sum, r) => {
    if (r.headline?.deltaVsPriorPp !== null && r.headline?.deltaVsPriorPp !== undefined) {
      const priorPct = r.headline.utilizationPct - r.headline.deltaVsPriorPp;
      return sum + (priorPct / 100) * r.headline.availableMinutes;
    }
    return sum;
  }, 0);
  const priorAvailableTotal = totalAvailable;
  const priorPct = priorAvailableTotal > 0
    ? Math.round((priorBookedTotal / priorAvailableTotal) * 1000) / 10
    : null;
  const deltaVsPriorPp = (groupPct !== null && priorPct !== null)
    ? Math.round((groupPct - priorPct) * 10) / 10
    : null;

  return {
    group: {
      headline: groupPct === null
        ? null
        : {
            utilizationPct: groupPct,
            bookedMinutes: totalBooked,
            availableMinutes: totalAvailable,
            denominatorSource,
            deltaVsPriorPp,
          },
      byDayOfWeek: dowBuckets,
      guards: {
        lowSampleDows: dowBuckets.filter((b) => b.lowSample).map((b) => b.label),
      },
    },
    perBranch,
  };
}

// ─── Group-rollup: cohort retention ──────────────────────────────────────

export async function aggregateCohortRetentionForGroup(args: {
  groupId: string;
  periodStart: Date;
  periodEnd: Date;
}): Promise<GroupRollupResult<CohortRetentionResult>> {
  const branches = await resolveBranchesForGroup(args.groupId);
  if (branches.length === 0) {
    const cohortWindow = computeCohortWindow({ periodStart: args.periodStart, periodEnd: args.periodEnd });
    return {
      group: {
        lookforwardDays: COHORT_LOOKFORWARD_DAYS,
        cohort: { windowStart: cohortWindow.windowStart, windowEnd: cohortWindow.windowEnd, size: 0 },
        headline: null,
        guards: { lowSample: true },
      },
      perBranch: [],
    };
  }

  const perBranchSettled = await Promise.allSettled(
    branches.map((b) =>
      aggregateCohortRetention({
        merchantId: b.merchantId,
        periodStart: args.periodStart,
        periodEnd: args.periodEnd,
      }),
    ),
  );

  const perBranch: GroupRollupResult<CohortRetentionResult>["perBranch"] = [];
  const successful: CohortRetentionResult[] = [];
  perBranchSettled.forEach((r, i) => {
    if (r.status === "fulfilled") {
      successful.push(r.value);
      perBranch.push({
        merchantId: branches[i].merchantId,
        merchantName: branches[i].merchantName,
        metrics: r.value,
      });
    }
  });

  const totalCohortSize = successful.reduce((sum, r) => sum + r.cohort.size, 0);
  const totalReturned = successful
    .filter((r) => r.headline !== null)
    .reduce((sum, r) => sum + r.headline!.returnedCount, 0);

  const cohortWindow = computeCohortWindow({ periodStart: args.periodStart, periodEnd: args.periodEnd });

  if (totalCohortSize < 5) {
    return {
      group: {
        lookforwardDays: COHORT_LOOKFORWARD_DAYS,
        cohort: { windowStart: cohortWindow.windowStart, windowEnd: cohortWindow.windowEnd, size: totalCohortSize },
        headline: null,
        guards: { lowSample: true },
      },
      perBranch,
    };
  }

  const groupPct = computeCohortRetentionPct(totalReturned, totalCohortSize);

  const priorPcts = successful
    .filter((r) => r.headline !== null && r.headline.deltaVsPriorCohortPp !== null)
    .map((r) => ({
      branchPriorPct: r.headline!.retentionPct - r.headline!.deltaVsPriorCohortPp!,
      branchCohortSize: r.cohort.size,
    }));
  let priorPct: number | null = null;
  if (priorPcts.length > 0) {
    const totalPriorWeight = priorPcts.reduce((s, p) => s + p.branchCohortSize, 0);
    if (totalPriorWeight > 0) {
      const weighted = priorPcts.reduce(
        (s, p) => s + (p.branchPriorPct * p.branchCohortSize),
        0,
      );
      priorPct = Math.round((weighted / totalPriorWeight) * 10) / 10;
    }
  }
  const deltaVsPrior = (groupPct !== null && priorPct !== null)
    ? Math.round((groupPct - priorPct) * 10) / 10
    : null;

  return {
    group: {
      lookforwardDays: COHORT_LOOKFORWARD_DAYS,
      cohort: { windowStart: cohortWindow.windowStart, windowEnd: cohortWindow.windowEnd, size: totalCohortSize },
      headline: groupPct === null ? null : {
        retentionPct: groupPct,
        returnedCount: totalReturned,
        cohortSize: totalCohortSize,
        deltaVsPriorCohortPp: deltaVsPrior,
      },
      guards: { lowSample: false },
    },
    perBranch,
  };
}

// ─── Group-rollup: rebook lag ────────────────────────────────────────────

export async function aggregateRebookLagForGroup(args: {
  groupId: string;
  periodStart: Date;
  periodEnd: Date;
}): Promise<GroupRollupResult<RebookLagResult>> {
  const branches = await resolveBranchesForGroup(args.groupId);
  if (branches.length === 0) {
    const cohortWindow = computeCohortWindow({ periodStart: args.periodStart, periodEnd: args.periodEnd });
    return {
      group: {
        lookforwardDays: REBOOK_LOOKFORWARD_DAYS,
        cohort: { windowStart: cohortWindow.windowStart, windowEnd: cohortWindow.windowEnd, size: 0 },
        headline: null,
        bins: [],
        guards: { lowSample: true, medianSuppressed: false },
      },
      perBranch: [],
    };
  }

  const perBranchSettled = await Promise.allSettled(
    branches.map((b) =>
      aggregateRebookLag({
        merchantId: b.merchantId,
        periodStart: args.periodStart,
        periodEnd: args.periodEnd,
      }),
    ),
  );

  const perBranch: GroupRollupResult<RebookLagResult>["perBranch"] = [];
  const successful: RebookLagResult[] = [];
  perBranchSettled.forEach((r, i) => {
    if (r.status === "fulfilled") {
      successful.push(r.value);
      perBranch.push({
        merchantId: branches[i].merchantId,
        merchantName: branches[i].merchantName,
        metrics: r.value,
      });
    }
  });

  const cohortWindow = computeCohortWindow({ periodStart: args.periodStart, periodEnd: args.periodEnd });
  const periodLenMs = args.periodEnd.getTime() - args.periodStart.getTime();
  const priorCohortStart = new Date(cohortWindow.windowStart.getTime() - periodLenMs);
  const priorCohortEnd = new Date(cohortWindow.windowEnd.getTime() - periodLenMs);

  const rawLagsPerBranchSettled = await Promise.allSettled(
    branches.map((b) =>
      queryRebookLagCohort({
        merchantId: b.merchantId,
        cohortStart: cohortWindow.windowStart,
        cohortEnd: cohortWindow.windowEnd,
      }),
    ),
  );
  const allLagDays: Array<number | null> = [];
  rawLagsPerBranchSettled.forEach((r) => {
    if (r.status === "fulfilled") {
      allLagDays.push(...r.value.lagDaysPerMember);
    }
  });

  const totalCohortSize = allLagDays.length;
  if (totalCohortSize < 5) {
    return {
      group: {
        lookforwardDays: REBOOK_LOOKFORWARD_DAYS,
        cohort: { windowStart: cohortWindow.windowStart, windowEnd: cohortWindow.windowEnd, size: totalCohortSize },
        headline: null,
        bins: [],
        guards: { lowSample: true, medianSuppressed: false },
      },
      perBranch,
    };
  }

  const returnerLags = allLagDays.filter((l): l is number => l !== null && l <= 60);
  const groupMedian = computeRebookLagMedian(returnerLags);
  const groupBins = mergeRebookLagBins(successful.map((r) => r.bins));

  const priorRawLagsSettled = await Promise.allSettled(
    branches.map((b) =>
      queryRebookLagCohort({
        merchantId: b.merchantId,
        cohortStart: priorCohortStart,
        cohortEnd: priorCohortEnd,
      }),
    ),
  );
  const allPriorLagDays: Array<number | null> = [];
  priorRawLagsSettled.forEach((r) => {
    if (r.status === "fulfilled") {
      allPriorLagDays.push(...r.value.lagDaysPerMember);
    }
  });
  const priorReturnerLags = allPriorLagDays.filter((l): l is number => l !== null && l <= 60);
  const priorMedian = computeRebookLagMedian(priorReturnerLags);

  const deltaVsPrior = (groupMedian !== null && priorMedian !== null)
    ? groupMedian - priorMedian
    : null;

  return {
    group: {
      lookforwardDays: REBOOK_LOOKFORWARD_DAYS,
      cohort: { windowStart: cohortWindow.windowStart, windowEnd: cohortWindow.windowEnd, size: totalCohortSize },
      headline: {
        medianDays: groupMedian,
        deltaVsPriorCohortDays: deltaVsPrior,
        returnedCount: returnerLags.length,
        cohortSize: totalCohortSize,
      },
      bins: groupBins,
      guards: { lowSample: false, medianSuppressed: groupMedian === null },
    },
    perBranch,
  };
}
