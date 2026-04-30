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
