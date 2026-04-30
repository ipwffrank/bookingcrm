import { describe, it, expect } from "vitest";
import {
  LOOKFORWARD_DAYS,
  SAMPLE_SIZE_THRESHOLD,
  computeCohortWindow,
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
