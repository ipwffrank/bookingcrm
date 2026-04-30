/**
 * Pure helpers for 60-day cohort retention computation. DB-querying logic
 * lives in `analytics-aggregator.ts`'s `aggregateCohortRetention`; this
 * file holds the math + business-rule decisions so they can be unit
 * tested without a database.
 *
 * Cohort retention answers: of clients whose first 'completed' booking
 * fell in the trailing cohort window (period bounds offset by the
 * lookforward), what fraction had a follow-up 'completed' booking within
 * the lookforward window?
 */

export interface CohortInfo {
  windowStart: Date;
  windowEnd: Date;
  size: number;
}

export interface CohortRetentionHeadline {
  retentionPct: number;
  returnedCount: number;
  cohortSize: number;
  deltaVsPriorCohortPp: number | null;
}

export interface CohortRetentionResult {
  lookforwardDays: number;
  cohort: CohortInfo;
  headline: CohortRetentionHeadline | null;
  guards: { lowSample: boolean };
}

/** Days a first-timer has to come back to count as "retained". */
export const LOOKFORWARD_DAYS = 60;

/** Cohort smaller than this → headline suppressed (rate too noisy). */
export const SAMPLE_SIZE_THRESHOLD = 5;

/** ms in 60 days — used in cohort-window math + lookforward filter. */
const LOOKFORWARD_MS = LOOKFORWARD_DAYS * 24 * 60 * 60 * 1000;

/**
 * Trailing cohort window = period bounds shifted backward by the
 * lookforward duration. Each cohort member from this window has had
 * `LOOKFORWARD_DAYS` to potentially return.
 */
export function computeCohortWindow(args: {
  periodStart: Date;
  periodEnd: Date;
}): { windowStart: Date; windowEnd: Date } {
  return {
    windowStart: new Date(args.periodStart.getTime() - LOOKFORWARD_MS),
    windowEnd: new Date(args.periodEnd.getTime() - LOOKFORWARD_MS),
  };
}

/**
 * Retention pct as `(returned / cohortSize) * 100`, rounded to 1 decimal.
 * Returns null when cohort is below the sample-size threshold — signals
 * "too noisy to act on" upstream.
 */
export function computeRetentionPct(
  returnedCount: number,
  cohortSize: number,
): number | null {
  if (cohortSize < SAMPLE_SIZE_THRESHOLD) return null;
  return Math.round((returnedCount / cohortSize) * 1000) / 10;
}

/** Percentage-point delta. null if either side is null. */
export function computeDeltaVsPrior(
  current: number | null,
  prior: number | null,
): number | null {
  if (current === null || prior === null) return null;
  return Math.round((current - prior) * 10) / 10;
}

/**
 * Assemble the final CohortRetentionResult from the pre-aggregated
 * pieces. Returns headline=null when the cohort is below the sample-size
 * threshold — the "insufficient sample" signal that propagates to the UI
 * / digest / AI prompt so they can suppress the section gracefully.
 */
export function assembleResult(args: {
  cohort: CohortInfo;
  returnedCount: number;
  priorRetentionPct: number | null;
}): CohortRetentionResult {
  const retentionPct = computeRetentionPct(args.returnedCount, args.cohort.size);
  if (retentionPct === null) {
    return {
      lookforwardDays: LOOKFORWARD_DAYS,
      cohort: args.cohort,
      headline: null,
      guards: { lowSample: true },
    };
  }
  return {
    lookforwardDays: LOOKFORWARD_DAYS,
    cohort: args.cohort,
    headline: {
      retentionPct,
      returnedCount: args.returnedCount,
      cohortSize: args.cohort.size,
      deltaVsPriorCohortPp: computeDeltaVsPrior(retentionPct, args.priorRetentionPct),
    },
    guards: { lowSample: false },
  };
}
