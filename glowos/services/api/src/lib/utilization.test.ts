import { describe, it, expect } from "vitest";
import {
  UTILIZATION_BOOKING_STATUSES,
  DUTY_COVERAGE_THRESHOLD,
  LOW_SAMPLE_BOOKINGS_PER_DOW,
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
