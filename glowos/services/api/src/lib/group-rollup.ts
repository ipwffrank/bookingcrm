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
