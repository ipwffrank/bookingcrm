import { describe, it, expect } from "vitest";
import type { BranchInfo, RateCounts, GroupRollupResult } from "./group-rollup.js";
import { weightedRate, mergeRebookLagBins } from "./group-rollup.js";
import type { RebookLagBin } from "./rebook-lag.js";

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

describe("mergeRebookLagBins", () => {
  const branchA: RebookLagBin[] = [
    { id: "0-7d",   label: "0-7 days",              minDays: 0,  maxDays: 7,  count: 1, pct: 4.5  },
    { id: "8-14d",  label: "8-14 days",             minDays: 8,  maxDays: 14, count: 2, pct: 9.1  },
    { id: "15-30d", label: "15-30 days",            minDays: 15, maxDays: 30, count: 5, pct: 22.7 },
    { id: "31-60d", label: "31-60 days",            minDays: 31, maxDays: 60, count: 6, pct: 27.3 },
    { id: "60d+",   label: "didn't return in 60d",  minDays: 61, maxDays: Infinity, count: 8, pct: 36.4 },
  ];
  const branchB: RebookLagBin[] = [
    { id: "0-7d",   label: "0-7 days",              minDays: 0,  maxDays: 7,  count: 0, pct: 0    },
    { id: "8-14d",  label: "8-14 days",             minDays: 8,  maxDays: 14, count: 1, pct: 8.3  },
    { id: "15-30d", label: "15-30 days",            minDays: 15, maxDays: 30, count: 3, pct: 25.0 },
    { id: "31-60d", label: "31-60 days",            minDays: 31, maxDays: 60, count: 4, pct: 33.3 },
    { id: "60d+",   label: "didn't return in 60d",  minDays: 61, maxDays: Infinity, count: 4, pct: 33.3 },
  ];

  it("sums bin counts across branches", () => {
    const merged = mergeRebookLagBins([branchA, branchB]);
    expect(merged.find((b) => b.id === "0-7d")!.count).toBe(1);
    expect(merged.find((b) => b.id === "8-14d")!.count).toBe(3);
    expect(merged.find((b) => b.id === "15-30d")!.count).toBe(8);
    expect(merged.find((b) => b.id === "31-60d")!.count).toBe(10);
    expect(merged.find((b) => b.id === "60d+")!.count).toBe(12);
  });

  it("recomputes percentages at the group level (not summed)", () => {
    const merged = mergeRebookLagBins([branchA, branchB]);
    const totalCount = 1 + 3 + 8 + 10 + 12; // 34
    expect(merged.find((b) => b.id === "0-7d")!.pct).toBeCloseTo(100 * 1 / totalCount, 1);
    expect(merged.find((b) => b.id === "31-60d")!.pct).toBeCloseTo(100 * 10 / totalCount, 1);
    const total = merged.reduce((a, b) => a + b.pct, 0);
    expect(total).toBeCloseTo(100, 0);
  });

  it("preserves bin order (0-7d, 8-14d, 15-30d, 31-60d, 60d+)", () => {
    const merged = mergeRebookLagBins([branchA, branchB]);
    expect(merged.map((b) => b.id)).toEqual(["0-7d", "8-14d", "15-30d", "31-60d", "60d+"]);
  });

  it("returns 5 zero-count bins on empty input", () => {
    const merged = mergeRebookLagBins([]);
    expect(merged).toHaveLength(5);
    for (const bin of merged) {
      expect(bin.count).toBe(0);
      expect(bin.pct).toBe(0);
    }
  });

  it("handles a single branch (passes through)", () => {
    const merged = mergeRebookLagBins([branchA]);
    for (const bin of merged) {
      const matching = branchA.find((b) => b.id === bin.id)!;
      expect(bin.count).toBe(matching.count);
      expect(bin.pct).toBeCloseTo(matching.pct, 1);
    }
  });
});
