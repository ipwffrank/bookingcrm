/**
 * Unit tests for the buffer-aware conflict-detection helpers.
 *
 * `getStaffBlockedWindows` is a pure function so we exercise it without any
 * mocking. Coverage focuses on the three time-geometry branches called out
 * in the spec: secondary set + buffers, secondary set + no buffers (degenerate),
 * and secondary null (legacy single-staff behavior).
 */
import { describe, it, expect } from "vitest";
import { getStaffBlockedWindows } from "./booking-conflicts.js";

const T0 = new Date("2026-05-01T10:00:00Z");

describe("getStaffBlockedWindows", () => {
  it("splits windows when secondary is set and buffers > 0", () => {
    // 15-min pre, 30-min service, 15-min post — total 60 min span
    const windows = getStaffBlockedWindows({
      startTime: T0,
      staffId: "primary-1",
      secondaryStaffId: "secondary-1",
      serviceDurationMinutes: 30,
      preBufferMinutes: 15,
      postBufferMinutes: 15,
    });

    // Expect 3 windows: secondary pre, primary, secondary post
    expect(windows).toHaveLength(3);

    const primary = windows.find((w) => w.staffId === "primary-1");
    expect(primary).toBeDefined();
    expect(primary!.startTime.toISOString()).toBe("2026-05-01T10:15:00.000Z");
    expect(primary!.endTime.toISOString()).toBe("2026-05-01T10:45:00.000Z");

    const secWindows = windows.filter((w) => w.staffId === "secondary-1");
    expect(secWindows).toHaveLength(2);
    // Pre-buffer window
    expect(secWindows[0].startTime.toISOString()).toBe("2026-05-01T10:00:00.000Z");
    expect(secWindows[0].endTime.toISOString()).toBe("2026-05-01T10:15:00.000Z");
    // Post-buffer window
    expect(secWindows[1].startTime.toISOString()).toBe("2026-05-01T10:45:00.000Z");
    expect(secWindows[1].endTime.toISOString()).toBe("2026-05-01T11:00:00.000Z");
  });

  it("primary blocks the entire span when secondary is null", () => {
    // Same buffers, no secondary -> primary owns the whole 60-min window
    const windows = getStaffBlockedWindows({
      startTime: T0,
      staffId: "primary-1",
      secondaryStaffId: null,
      serviceDurationMinutes: 30,
      preBufferMinutes: 15,
      postBufferMinutes: 15,
    });

    expect(windows).toHaveLength(1);
    expect(windows[0].staffId).toBe("primary-1");
    expect(windows[0].startTime.toISOString()).toBe("2026-05-01T10:00:00.000Z");
    expect(windows[0].endTime.toISOString()).toBe("2026-05-01T11:00:00.000Z");
  });

  it("omits buffer windows when those buffers are 0", () => {
    // Pre buffer only — secondary should NOT get a post window
    const windows = getStaffBlockedWindows({
      startTime: T0,
      staffId: "primary-1",
      secondaryStaffId: "secondary-1",
      serviceDurationMinutes: 30,
      preBufferMinutes: 15,
      postBufferMinutes: 0,
    });

    expect(windows).toHaveLength(2);
    const sec = windows.filter((w) => w.staffId === "secondary-1");
    expect(sec).toHaveLength(1);
    expect(sec[0].startTime.toISOString()).toBe("2026-05-01T10:00:00.000Z");
    expect(sec[0].endTime.toISOString()).toBe("2026-05-01T10:15:00.000Z");
  });

  it("conflict — secondary blocked during pre-buffer of another booking", () => {
    // Booking A: 10:00-11:00 with primary M, secondary K, pre 15, service 30, post 15.
    // K is therefore blocked 10:00-10:15 and 10:45-11:00.
    // Try to book another for K starting at 10:00 (overlaps K's pre-buffer).
    const aWindows = getStaffBlockedWindows({
      startTime: T0,
      staffId: "M",
      secondaryStaffId: "K",
      serviceDurationMinutes: 30,
      preBufferMinutes: 15,
      postBufferMinutes: 15,
    });
    const candidate = getStaffBlockedWindows({
      startTime: T0, // 10:00
      staffId: "K", // K is the candidate's primary
      secondaryStaffId: null,
      serviceDurationMinutes: 15,
      preBufferMinutes: 0,
      postBufferMinutes: 0,
    });

    // candidate has 1 window for K spanning 10:00-10:15 — that overlaps A's
    // secondary pre-window for K (10:00-10:15).
    let overlap = false;
    for (const a of aWindows) {
      for (const c of candidate) {
        if (a.staffId !== c.staffId) continue;
        if (c.startTime < a.endTime && c.endTime > a.startTime) {
          overlap = true;
        }
      }
    }
    expect(overlap).toBe(true);
  });

  it("no conflict — primary free during own pre-buffer when secondary owns it", () => {
    // Booking A as above. Primary M is blocked 10:15-10:45 only.
    // Try to book another for M from 10:00-10:15 — should be free.
    const aWindows = getStaffBlockedWindows({
      startTime: T0,
      staffId: "M",
      secondaryStaffId: "K",
      serviceDurationMinutes: 30,
      preBufferMinutes: 15,
      postBufferMinutes: 15,
    });
    const candidate = getStaffBlockedWindows({
      startTime: T0, // 10:00
      staffId: "M",
      secondaryStaffId: null,
      serviceDurationMinutes: 15,
      preBufferMinutes: 0,
      postBufferMinutes: 0,
    });

    let overlap = false;
    for (const a of aWindows) {
      for (const c of candidate) {
        if (a.staffId !== c.staffId) continue;
        if (c.startTime < a.endTime && c.endTime > a.startTime) {
          overlap = true;
        }
      }
    }
    expect(overlap).toBe(false);
  });
});
