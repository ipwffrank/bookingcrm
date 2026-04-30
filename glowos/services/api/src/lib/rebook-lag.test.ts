import { describe, it, expect } from "vitest";
import {
  LOOKFORWARD_DAYS,
  SAMPLE_SIZE_THRESHOLD,
  BIN_DEFINITIONS,
  assignBin,
  computeMedian,
  assembleResult,
} from "./rebook-lag.js";

describe("rebook-lag constants", () => {
  it("uses 60-day lookforward window (shared with PR 6 cohort retention)", () => {
    expect(LOOKFORWARD_DAYS).toBe(60);
  });

  it("uses 5 as the sample-size threshold (shared with PR 6)", () => {
    expect(SAMPLE_SIZE_THRESHOLD).toBe(5);
  });

  it("defines 5 bins covering 0-7, 8-14, 15-30, 31-60, 60+ days", () => {
    expect(BIN_DEFINITIONS).toHaveLength(5);
    expect(BIN_DEFINITIONS.map((b) => b.id)).toEqual(["0-7d", "8-14d", "15-30d", "31-60d", "60d+"]);
  });

  it("60d+ bin is open-ended with maxDays = Infinity", () => {
    const last = BIN_DEFINITIONS[BIN_DEFINITIONS.length - 1];
    expect(last.id).toBe("60d+");
    expect(last.maxDays).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("assignBin", () => {
  it("returns '0-7d' for 0-7 day lags inclusive", () => {
    expect(assignBin(0)).toBe("0-7d");
    expect(assignBin(3)).toBe("0-7d");
    expect(assignBin(7)).toBe("0-7d");
  });

  it("returns '8-14d' for 8-14 day lags", () => {
    expect(assignBin(8)).toBe("8-14d");
    expect(assignBin(14)).toBe("8-14d");
  });

  it("returns '15-30d' for 15-30 day lags", () => {
    expect(assignBin(15)).toBe("15-30d");
    expect(assignBin(30)).toBe("15-30d");
  });

  it("returns '31-60d' for 31-60 day lags", () => {
    expect(assignBin(31)).toBe("31-60d");
    expect(assignBin(60)).toBe("31-60d");
  });

  it("returns '60d+' for lags > 60 (extreme but should never reach here in practice)", () => {
    expect(assignBin(61)).toBe("60d+");
    expect(assignBin(365)).toBe("60d+");
  });

  it("returns '60d+' for null lag (no second booking within window)", () => {
    expect(assignBin(null)).toBe("60d+");
  });
});

describe("computeMedian", () => {
  it("returns the middle value for odd count", () => {
    expect(computeMedian([10, 20, 30, 40, 50])).toBe(30);
  });

  it("returns the average of middle two for even count", () => {
    expect(computeMedian([10, 20, 30, 40, 50, 60])).toBe(35);
  });

  it("rounds to the nearest integer", () => {
    expect(computeMedian([10, 20, 30, 41, 50, 60])).toBe(36); // (30+41)/2 = 35.5 rounds to 36
  });

  it("returns null when fewer than SAMPLE_SIZE_THRESHOLD values", () => {
    expect(computeMedian([10, 20, 30, 40])).toBeNull();
    expect(computeMedian([])).toBeNull();
  });

  it("handles 5 values (boundary) — returns the 3rd sorted value", () => {
    expect(computeMedian([50, 10, 30, 40, 20])).toBe(30);
  });

  it("does not mutate the input array", () => {
    const input = [50, 10, 30, 40, 20];
    computeMedian(input);
    expect(input).toEqual([50, 10, 30, 40, 20]);
  });
});

describe("assembleResult", () => {
  const cohortInfo = {
    windowStart: new Date("2026-02-01T00:00:00Z"),
    windowEnd: new Date("2026-03-01T00:00:00Z"),
    size: 22,
  };

  it("returns headline=null + empty bins when cohort below threshold", () => {
    const r = assembleResult({
      cohort: { ...cohortInfo, size: 4 },
      lagDaysPerMember: [10, 20, null, null],
      priorMedianDays: null,
    });
    expect(r.headline).toBeNull();
    expect(r.bins).toEqual([]);
    expect(r.guards.lowSample).toBe(true);
  });

  it("populates bins + headline when cohort meets threshold and returners >= 5", () => {
    // 22 cohort members: 14 returners spread across bins, 8 non-returners (null)
    const lagDaysPerMember = [
      5,                                       // 0-7d
      10, 12,                                  // 8-14d
      18, 22, 25, 28, 30,                      // 15-30d
      33, 40, 45, 50, 55, 60,                  // 31-60d
      null, null, null, null, null, null, null, null, // 60d+
    ];

    const r = assembleResult({
      cohort: cohortInfo,
      lagDaysPerMember,
      priorMedianDays: 32,
    });

    expect(r.headline).not.toBeNull();
    expect(r.headline!.cohortSize).toBe(22);
    expect(r.headline!.returnedCount).toBe(14);
    expect(r.headline!.medianDays).toBe(29); // median of 14 values [5,10,12,18,22,25,28,30,33,40,45,50,55,60] = (28+30)/2 = 29
    expect(r.headline!.deltaVsPriorCohortDays).toBe(-3); // 29 - 32

    // Bin counts
    expect(r.bins[0]).toMatchObject({ id: "0-7d",   count: 1 });
    expect(r.bins[1]).toMatchObject({ id: "8-14d",  count: 2 });
    expect(r.bins[2]).toMatchObject({ id: "15-30d", count: 5 });
    expect(r.bins[3]).toMatchObject({ id: "31-60d", count: 6 });
    expect(r.bins[4]).toMatchObject({ id: "60d+",   count: 8 });

    // Bin pcts sum to 100 (within rounding tolerance)
    const pctSum = r.bins.reduce((a, b) => a + b.pct, 0);
    expect(pctSum).toBeCloseTo(100, 0); // within 1 of 100

    // 60d+ count equals cohortSize - returnedCount (PR 6 invariant)
    const sixtyPlus = r.bins.find((b) => b.id === "60d+")!;
    expect(sixtyPlus.count).toBe(r.headline!.cohortSize - r.headline!.returnedCount);

    expect(r.guards.lowSample).toBe(false);
    expect(r.guards.medianSuppressed).toBe(false);
  });

  it("medianSuppressed=true when returners count below threshold but cohort meets threshold", () => {
    // 10-member cohort with only 4 returners
    const lagDaysPerMember = [10, 20, 30, 40, null, null, null, null, null, null];
    const r = assembleResult({
      cohort: { ...cohortInfo, size: 10 },
      lagDaysPerMember,
      priorMedianDays: null,
    });
    expect(r.headline).not.toBeNull();
    expect(r.headline!.medianDays).toBeNull();
    expect(r.headline!.returnedCount).toBe(4);
    expect(r.headline!.cohortSize).toBe(10);
    expect(r.bins.length).toBe(5);
    expect(r.guards.lowSample).toBe(false);
    expect(r.guards.medianSuppressed).toBe(true);
  });

  it("delta is null when prior median is null", () => {
    const lagDaysPerMember = [10, 15, 20, 25, 30];
    const r = assembleResult({
      cohort: { ...cohortInfo, size: 5 },
      lagDaysPerMember,
      priorMedianDays: null,
    });
    expect(r.headline!.deltaVsPriorCohortDays).toBeNull();
  });

  it("60d+ bin includes both null lags and lags > 60", () => {
    // Edge case: a malformed member with lag = 70 (shouldn't happen because the SQL caps at 60d, but defend anyway)
    const lagDaysPerMember = [10, 15, 20, 25, 30, 70, null];
    const r = assembleResult({
      cohort: { ...cohortInfo, size: 7 },
      lagDaysPerMember,
      priorMedianDays: null,
    });
    const sixtyPlus = r.bins.find((b) => b.id === "60d+")!;
    expect(sixtyPlus.count).toBe(2); // null + 70
  });
});
