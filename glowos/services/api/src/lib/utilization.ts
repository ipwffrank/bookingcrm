/**
 * Pure helpers for capacity-utilization computation. DB-querying logic
 * lives in `analytics-aggregator.ts`'s `aggregateUtilization`; this file
 * holds the math + business-rule decisions so they can be unit-tested
 * without a database.
 */

export type DenominatorSource = "duties" | "estimated";

export interface DowBucket {
  dow: number; // 0 = Sun ... 6 = Sat
  label: string;
  bookedMinutes: number;
  availableMinutes: number;
  utilizationPct: number | null; // null when availableMinutes is 0
  lowSample: boolean; // true when bookings count for this dow < LOW_SAMPLE_BOOKINGS_PER_DOW
}

export interface UtilizationHeadline {
  utilizationPct: number;
  bookedMinutes: number;
  availableMinutes: number;
  denominatorSource: DenominatorSource;
  deltaVsPriorPp: number | null; // null when prior is null
}

export interface UtilizationResult {
  headline: UtilizationHeadline | null; // null when availableMinutes is 0
  byDayOfWeek: DowBucket[];
  guards: { lowSampleDows: string[] }; // human-readable labels of low-sample DoWs
}

/** Booking statuses that consume staff capacity. */
export const UTILIZATION_BOOKING_STATUSES = ["completed", "confirmed", "no_show"] as const;
export type UtilizationBookingStatus = (typeof UTILIZATION_BOOKING_STATUSES)[number];

/** Threshold (>=) for picking duties vs estimated denominator. */
export const DUTY_COVERAGE_THRESHOLD = 0.5;

/** Threshold below which a per-DoW slice is marked low-sample. */
export const LOW_SAMPLE_BOOKINGS_PER_DOW = 10;

/**
 * Pick the denominator source. Duty-roster minutes are higher fidelity but
 * many merchants don't fill in duties consistently. We use duties when at
 * least half the period's days have at least one duty entry, else fall
 * back to operating-hours × publicly-visible-headcount.
 */
export function selectDenominatorSource(args: {
  daysWithDuties: number;
  periodDays: number;
}): DenominatorSource {
  if (args.periodDays <= 0) return "estimated";
  const coverage = args.daysWithDuties / args.periodDays;
  return coverage >= DUTY_COVERAGE_THRESHOLD ? "duties" : "estimated";
}
