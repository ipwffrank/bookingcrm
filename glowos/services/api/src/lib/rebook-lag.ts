/**
 * Pure helpers for rebook-lag distribution computation. DB-querying logic
 * lives in `analytics-aggregator.ts`'s `aggregateRebookLag`; this file
 * holds the math + business-rule decisions so they can be unit-tested
 * without a database.
 *
 * Rebook lag answers: of clients whose first 'completed' booking fell in
 * the trailing cohort window (period bounds offset by the lookforward),
 * AT WHAT INTERVAL (in days) did they make their second 'completed'
 * booking? Result is binned into 5 fixed intervals + a "didn't return"
 * bucket, plus a headline median over the returners.
 *
 * Designed to compose with PR 6 cohort retention: same cohort, same
 * window math. The "60d+" bin count equals exactly `cohortSize -
 * returnedCount` from the cohort retention metric.
 */

export interface RebookLagBin {
  id: "0-7d" | "8-14d" | "15-30d" | "31-60d" | "60d+";
  label: string;
  minDays: number;
  maxDays: number; // Number.POSITIVE_INFINITY for the open-ended bucket
  count: number;
  pct: number; // 0..100, one decimal
}

export interface RebookLagHeadline {
  medianDays: number | null; // null when returners < SAMPLE_SIZE_THRESHOLD
  deltaVsPriorCohortDays: number | null;
  returnedCount: number;
  cohortSize: number;
}

export interface RebookLagResult {
  lookforwardDays: number;
  cohort: { windowStart: Date; windowEnd: Date; size: number };
  headline: RebookLagHeadline | null; // null when cohort < SAMPLE_SIZE_THRESHOLD
  bins: RebookLagBin[];
  guards: { lowSample: boolean; medianSuppressed: boolean };
}

/** Days a first-timer has to come back to count as "retained". Shared with PR 6. */
export const LOOKFORWARD_DAYS = 60;

/** Cohort smaller than this → entire result suppressed. Same as PR 6. */
export const SAMPLE_SIZE_THRESHOLD = 5;

/**
 * Bin definitions. Ordered for histogram rendering left-to-right.
 * The "60d+" bin is open-ended on the right and represents BOTH:
 *   - cohort members with no second booking, AND
 *   - cohort members whose second booking fell beyond the lookforward
 * (mathematically equivalent — both produce a null lag in the aggregator).
 */
export const BIN_DEFINITIONS: ReadonlyArray<Omit<RebookLagBin, "count" | "pct">> = [
  { id: "0-7d",   label: "0-7 days",              minDays: 0,  maxDays: 7  },
  { id: "8-14d",  label: "8-14 days",             minDays: 8,  maxDays: 14 },
  { id: "15-30d", label: "15-30 days",            minDays: 15, maxDays: 30 },
  { id: "31-60d", label: "31-60 days",            minDays: 31, maxDays: 60 },
  { id: "60d+",   label: "didn't return in 60d",  minDays: 61, maxDays: Number.POSITIVE_INFINITY },
];

/**
 * Assign a lag-days value to one of the 5 bins. `null` (no second
 * booking within the lookforward window) → "60d+" bucket. Boundary
 * values land in the lower bin (e.g. 7 → "0-7d", 8 → "8-14d") since
 * `maxDays` is inclusive.
 */
export function assignBin(lagDays: number | null): RebookLagBin["id"] {
  if (lagDays === null) return "60d+";
  for (const bin of BIN_DEFINITIONS) {
    if (lagDays >= bin.minDays && lagDays <= bin.maxDays) return bin.id;
  }
  // Shouldn't reach here — Number.POSITIVE_INFINITY catches everything.
  return "60d+";
}
