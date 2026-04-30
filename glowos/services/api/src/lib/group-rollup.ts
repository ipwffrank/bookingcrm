/**
 * Pure helpers for group-scope analytics rollups. The DB-touching
 * `aggregate*ForGroup` wrappers in `analytics-aggregator.ts` collect
 * per-branch results, then compose them via these helpers.
 *
 * All rate metrics use weighted aggregation — combine numerators and
 * denominators across branches, then compute the rate. NEVER take the
 * mean of per-branch rates (that gives the wrong answer when branches
 * have different sizes).
 */

export interface BranchInfo {
  merchantId: string;
  merchantName: string;
}

/** Pair of raw counts → numerator and denominator for a weighted rate. */
export interface RateCounts {
  numerator: number;
  denominator: number;
}

export interface GroupRollupResult<T> {
  group: T;
  perBranch: Array<{
    merchantId: string;
    merchantName: string;
    metrics: T;
  }>;
}

/**
 * Compute a weighted rate from per-branch numerator/denominator pairs.
 * Sums numerators and denominators across all branches with positive
 * denominators, then divides. Returns null if no branch has a positive
 * denominator (signals "no data for this metric in any branch").
 *
 * This is the canonical group-rollup math for any rate metric:
 *   noShowRate, retentionPct, utilizationPct, firstTimerReturnRate, etc.
 *
 * It deliberately avoids "mean of per-branch rates" — a 5-booking branch
 * and a 500-booking branch would otherwise have equal weight, distorting
 * the group rate.
 */
export function weightedRate(counts: RateCounts[]): number | null {
  let totalNum = 0;
  let totalDen = 0;
  for (const c of counts) {
    if (c.denominator <= 0) continue;
    totalNum += c.numerator;
    totalDen += c.denominator;
  }
  if (totalDen <= 0) return null;
  return totalNum / totalDen;
}
