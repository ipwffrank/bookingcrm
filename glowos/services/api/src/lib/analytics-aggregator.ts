import { and, eq, gte, lte, sql } from "drizzle-orm";
import { db, bookings, reviews, merchants } from "@glowos/db";

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
