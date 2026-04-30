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
import { type RebookLagBin, BIN_DEFINITIONS } from "./rebook-lag.js";

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

/**
 * Merge per-branch rebook-lag bins into group-level bins. Bin counts
 * sum across branches; percentages are recomputed at the group level
 * against the total cohort size (sum of all per-branch bin counts).
 *
 * Returns 5 zero-count bins when given an empty array — useful as a
 * suppress-everything fallback.
 */
export function mergeRebookLagBins(perBranchBins: RebookLagBin[][]): RebookLagBin[] {
  const counts: Record<RebookLagBin["id"], number> = {
    "0-7d": 0, "8-14d": 0, "15-30d": 0, "31-60d": 0, "60d+": 0,
  };
  for (const bins of perBranchBins) {
    for (const bin of bins) {
      counts[bin.id] += bin.count;
    }
  }
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  return BIN_DEFINITIONS.map((def) => ({
    ...def,
    count: counts[def.id],
    pct: total > 0 ? Math.round((counts[def.id] / total) * 1000) / 10 : 0,
  }));
}
