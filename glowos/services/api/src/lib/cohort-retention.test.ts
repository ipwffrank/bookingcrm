import { describe, it, expect } from "vitest";
import {
  LOOKFORWARD_DAYS,
  SAMPLE_SIZE_THRESHOLD,
  computeCohortWindow,
  computeRetentionPct,
} from "./cohort-retention.js";

describe("cohort-retention constants", () => {
  it("uses 60-day lookforward window", () => {
    expect(LOOKFORWARD_DAYS).toBe(60);
  });

  it("uses 5 as the cohort sample-size threshold", () => {
    expect(SAMPLE_SIZE_THRESHOLD).toBe(5);
  });
});

describe("computeCohortWindow", () => {
  it("offsets the period by LOOKFORWARD_DAYS to derive the trailing cohort", () => {
    const periodStart = new Date("2026-04-01T00:00:00Z");
    const periodEnd = new Date("2026-05-01T00:00:00Z");
    const w = computeCohortWindow({ periodStart, periodEnd });
    // 2026-04-01 - 60d = 2026-01-31 (Feb 2026 has 28 days)
    expect(w.windowStart.toISOString()).toBe("2026-01-31T00:00:00.000Z");
    // 2026-05-01 - 60d = 2026-03-02
    expect(w.windowEnd.toISOString()).toBe("2026-03-02T00:00:00.000Z");
  });

  it("preserves period span exactly", () => {
    const periodStart = new Date("2026-04-01T00:00:00Z");
    const periodEnd = new Date("2026-04-30T00:00:00Z");
    const w = computeCohortWindow({ periodStart, periodEnd });
    expect(w.windowEnd.getTime() - w.windowStart.getTime()).toBe(periodEnd.getTime() - periodStart.getTime());
  });
});

describe("computeRetentionPct", () => {
  it("returns the percentage rounded to 1 decimal", () => {
    expect(computeRetentionPct(14, 22)).toBeCloseTo(63.6, 1);
  });

  it("returns null when cohort size is below SAMPLE_SIZE_THRESHOLD", () => {
    expect(computeRetentionPct(2, 4)).toBeNull();
  });

  it("returns 0 when no one returned but cohort meets threshold", () => {
    expect(computeRetentionPct(0, 10)).toBe(0);
  });

  it("returns 100 when everyone returned", () => {
    expect(computeRetentionPct(10, 10)).toBe(100);
  });

  it("returns null when cohort size is exactly 0", () => {
    expect(computeRetentionPct(0, 0)).toBeNull();
  });
});
