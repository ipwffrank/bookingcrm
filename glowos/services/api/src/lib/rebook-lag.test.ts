import { describe, it, expect } from "vitest";
import {
  LOOKFORWARD_DAYS,
  SAMPLE_SIZE_THRESHOLD,
  BIN_DEFINITIONS,
  assignBin,
  computeMedian,
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
