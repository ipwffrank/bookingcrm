import { describe, it, expect } from "vitest";
import {
  LOOKFORWARD_DAYS,
  SAMPLE_SIZE_THRESHOLD,
  BIN_DEFINITIONS,
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
