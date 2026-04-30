import { describe, it, expect } from "vitest";
import type { BranchInfo, RateCounts, GroupRollupResult } from "./group-rollup.js";
import { weightedRate } from "./group-rollup.js";

describe("group-rollup types", () => {
  it("BranchInfo accepts a merchantId + merchantName", () => {
    const b: BranchInfo = { merchantId: "abc", merchantName: "Aura Orchard" };
    expect(b.merchantId).toBe("abc");
  });

  it("RateCounts is a numerator/denominator pair", () => {
    const r: RateCounts = { numerator: 14, denominator: 22 };
    expect(r.numerator / r.denominator).toBeCloseTo(0.636, 2);
  });

  it("GroupRollupResult<T> wraps a group T plus per-branch T entries", () => {
    type Foo = { x: number };
    const r: GroupRollupResult<Foo> = {
      group: { x: 10 },
      perBranch: [{ merchantId: "a", merchantName: "A", metrics: { x: 4 } }],
    };
    expect(r.group.x).toBe(10);
    expect(r.perBranch[0].metrics.x).toBe(4);
  });
});

describe("weightedRate", () => {
  it("sums numerators and denominators, returns the ratio", () => {
    expect(weightedRate([
      { numerator: 10, denominator: 100 },
      { numerator: 50, denominator: 100 },
    ])).toBeCloseTo(0.3, 4);
  });

  it("ignores branches with zero denominator (no data, not zero rate)", () => {
    expect(weightedRate([
      { numerator: 14, denominator: 22 },
      { numerator: 0, denominator: 0 },
    ])).toBeCloseTo(0.6364, 4);
  });

  it("returns null when ALL branches have zero denominator", () => {
    expect(weightedRate([
      { numerator: 0, denominator: 0 },
      { numerator: 0, denominator: 0 },
    ])).toBeNull();
  });

  it("returns null on empty input", () => {
    expect(weightedRate([])).toBeNull();
  });

  it("handles single branch correctly", () => {
    expect(weightedRate([{ numerator: 8, denominator: 20 }])).toBeCloseTo(0.4, 4);
  });

  it("survives skewed branch sizes (large branch dominates)", () => {
    expect(weightedRate([
      { numerator: 5, denominator: 10 },
      { numerator: 90, denominator: 1000 },
    ])).toBeCloseTo(0.0941, 3);
  });
});
