import { describe, it, expect } from "vitest";
import {
  UTILIZATION_BOOKING_STATUSES,
  DUTY_COVERAGE_THRESHOLD,
  LOW_SAMPLE_BOOKINGS_PER_DOW,
  selectDenominatorSource,
} from "./utilization.js";

describe("utilization constants", () => {
  it("exports the three statuses that consume capacity", () => {
    expect(UTILIZATION_BOOKING_STATUSES).toEqual(["completed", "confirmed", "no_show"]);
  });

  it("uses 0.5 (50%) duty coverage threshold", () => {
    expect(DUTY_COVERAGE_THRESHOLD).toBe(0.5);
  });

  it("uses 10 bookings as low-sample DoW threshold", () => {
    expect(LOW_SAMPLE_BOOKINGS_PER_DOW).toBe(10);
  });
});

describe("selectDenominatorSource", () => {
  it("returns 'duties' when duty-day coverage is above threshold", () => {
    expect(selectDenominatorSource({ daysWithDuties: 16, periodDays: 30 })).toBe("duties");
  });

  it("returns 'duties' when duty-day coverage is exactly threshold (>=)", () => {
    // Spec: ">= 0.5" → boundary picks duties
    expect(selectDenominatorSource({ daysWithDuties: 15, periodDays: 30 })).toBe("duties");
  });

  it("returns 'estimated' when duty-day coverage is below threshold", () => {
    expect(selectDenominatorSource({ daysWithDuties: 14, periodDays: 30 })).toBe("estimated");
  });

  it("returns 'estimated' when no duties exist", () => {
    expect(selectDenominatorSource({ daysWithDuties: 0, periodDays: 30 })).toBe("estimated");
  });

  it("returns 'estimated' when periodDays is 0 (defensive)", () => {
    expect(selectDenominatorSource({ daysWithDuties: 0, periodDays: 0 })).toBe("estimated");
  });
});
