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

const DOW_BY_WEEKDAY_LABEL: Record<string, number> = {
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
};

/**
 * Bucket booking minutes into a 7-element array indexed by day-of-week
 * (0 = Sun ... 6 = Sat) in the merchant's local timezone. Uses
 * Intl.DateTimeFormat for tz conversion to avoid pulling in date-fns.
 */
export function groupBookingsByDow(args: {
  bookings: Array<{ scheduledAt: Date; durationMinutes: number }>;
  merchantTz: string;
}): number[] {
  const buckets = [0, 0, 0, 0, 0, 0, 0];
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: args.merchantTz,
    weekday: "short",
  });
  for (const b of args.bookings) {
    const dow = DOW_BY_WEEKDAY_LABEL[fmt.format(b.scheduledAt)];
    if (dow !== undefined) buckets[dow] += b.durationMinutes;
  }
  return buckets;
}

const DOW_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * Compute booked / available × 100, rounded to one decimal. Returns null
 * when the denominator is 0 (signals "no capacity data" upstream).
 */
export function computeUtilizationPct(
  bookedMinutes: number,
  availableMinutes: number,
): number | null {
  if (availableMinutes <= 0) return null;
  return Math.round((bookedMinutes / availableMinutes) * 1000) / 10;
}

/**
 * Build the 7-element DowBucket[] array. Pure: takes pre-aggregated
 * per-dow values; lowSample flag is set per the LOW_SAMPLE_BOOKINGS_PER_DOW
 * threshold so consumers can de-emphasize unreliable slices.
 */
export function buildDowBuckets(args: {
  bookedByDow: number[];
  availableByDow: number[];
  bookingsCountByDow: number[];
}): DowBucket[] {
  return DOW_LABELS.map((label, dow) => ({
    dow,
    label,
    bookedMinutes: args.bookedByDow[dow] ?? 0,
    availableMinutes: args.availableByDow[dow] ?? 0,
    utilizationPct: computeUtilizationPct(
      args.bookedByDow[dow] ?? 0,
      args.availableByDow[dow] ?? 0,
    ),
    lowSample: (args.bookingsCountByDow[dow] ?? 0) < LOW_SAMPLE_BOOKINGS_PER_DOW,
  }));
}
