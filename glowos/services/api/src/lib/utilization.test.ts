import { describe, it, expect } from "vitest";
import {
  UTILIZATION_BOOKING_STATUSES,
  DUTY_COVERAGE_THRESHOLD,
  LOW_SAMPLE_BOOKINGS_PER_DOW,
  selectDenominatorSource,
  groupBookingsByDow,
  computeUtilizationPct,
  buildDowBuckets,
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

describe("groupBookingsByDow", () => {
  it("buckets a single booking into the correct dow", () => {
    // 2026-04-29T03:00:00Z = 11am SGT Wed (UTC+8)
    const booked = groupBookingsByDow({
      bookings: [
        { scheduledAt: new Date("2026-04-29T03:00:00Z"), durationMinutes: 60 },
      ],
      merchantTz: "Asia/Singapore",
    });
    expect(booked[3]).toBe(60); // Wed
    expect(booked[0]).toBe(0);
    expect(booked[6]).toBe(0);
    expect(booked.reduce((a, b) => a + b, 0)).toBe(60);
  });

  it("respects merchant timezone for dow boundary", () => {
    // 2026-04-30T15:30:00Z = Thu 23:30 SGT but Fri 00:30 KST
    const inSgt = groupBookingsByDow({
      bookings: [{ scheduledAt: new Date("2026-04-30T15:30:00Z"), durationMinutes: 30 }],
      merchantTz: "Asia/Singapore",
    });
    expect(inSgt[4]).toBe(30); // Thursday in SGT

    const inKst = groupBookingsByDow({
      bookings: [{ scheduledAt: new Date("2026-04-30T15:30:00Z"), durationMinutes: 30 }],
      merchantTz: "Asia/Seoul",
    });
    expect(inKst[5]).toBe(30); // Friday in KST
  });

  it("sums multiple bookings on the same dow", () => {
    const booked = groupBookingsByDow({
      bookings: [
        { scheduledAt: new Date("2026-04-29T03:00:00Z"), durationMinutes: 60 }, // Wed 11am SGT
        { scheduledAt: new Date("2026-04-29T07:00:00Z"), durationMinutes: 30 }, // Wed 3pm SGT
      ],
      merchantTz: "Asia/Singapore",
    });
    expect(booked[3]).toBe(90);
  });

  it("returns 7 zeros for empty bookings", () => {
    const booked = groupBookingsByDow({ bookings: [], merchantTz: "Asia/Singapore" });
    expect(booked).toEqual([0, 0, 0, 0, 0, 0, 0]);
  });
});

describe("computeUtilizationPct", () => {
  it("returns the percentage when both inputs are positive", () => {
    expect(computeUtilizationPct(60, 100)).toBe(60);
  });
  it("returns null when available is 0", () => {
    expect(computeUtilizationPct(60, 0)).toBeNull();
  });
  it("returns 0 when booked is 0 and available is positive", () => {
    expect(computeUtilizationPct(0, 100)).toBe(0);
  });
  it("rounds to 1 decimal place", () => {
    expect(computeUtilizationPct(1, 3)).toBe(33.3);
  });
});

describe("buildDowBuckets", () => {
  it("flags dows with <10 bookings as lowSample", () => {
    const buckets = buildDowBuckets({
      bookedByDow:    [60, 600, 60, 600, 60, 600, 60],
      availableByDow: [480, 480, 480, 480, 480, 480, 480],
      bookingsCountByDow: [3, 12, 4, 15, 5, 14, 2],
    });
    expect(buckets[0].lowSample).toBe(true);
    expect(buckets[0].label).toBe("Sun");
    expect(buckets[0].utilizationPct).toBeCloseTo(12.5, 1);
    expect(buckets[1].lowSample).toBe(false);
    expect(buckets[1].utilizationPct).toBe(125); // raw, uncapped
  });

  it("returns null utilizationPct for dows with 0 available", () => {
    const buckets = buildDowBuckets({
      bookedByDow:    [0, 0, 0, 0, 0, 0, 0],
      availableByDow: [0, 480, 480, 480, 480, 480, 480],
      bookingsCountByDow: [0, 12, 12, 12, 12, 12, 12],
    });
    expect(buckets[0].utilizationPct).toBeNull();
    expect(buckets[1].utilizationPct).toBe(0);
  });
});
