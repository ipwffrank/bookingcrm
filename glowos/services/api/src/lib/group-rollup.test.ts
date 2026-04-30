import { describe, it, expect } from "vitest";
import type { BranchInfo, RateCounts, GroupRollupResult } from "./group-rollup.js";

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
