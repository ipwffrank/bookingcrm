import { and, eq, lt, gt, inArray, notInArray, or } from "drizzle-orm";
import { addMinutes } from "date-fns";
import { db, bookings, services } from "@glowos/db";

export type Conflict = {
  conflictingBookingId: string;
  staffId: string;
  startTime: Date;
  endTime: Date;
};

/**
 * Returns the first conflicting booking if the proposed (staffId, start, end)
 * overlaps any confirmed/in_progress booking on the same staff, excluding
 * bookings whose ids are in `excludeBookingIds`.
 *
 * Note: this helper checks the *primary* staff column only. For services with
 * pre/post buffers and a secondary staff member, use `findBookingConflict`
 * which understands split windows owned by secondary staff.
 */
export async function findStaffConflict(params: {
  merchantId: string;
  staffId: string;
  startTime: Date;
  endTime: Date;
  excludeBookingIds: string[];
}): Promise<Conflict | null> {
  const conds = [
    eq(bookings.merchantId, params.merchantId),
    eq(bookings.staffId, params.staffId),
    inArray(bookings.status, ["confirmed", "in_progress"] as const),
    lt(bookings.startTime, params.endTime),
    gt(bookings.endTime, params.startTime),
  ];
  if (params.excludeBookingIds.length > 0) {
    conds.push(notInArray(bookings.id, params.excludeBookingIds));
  }
  const [hit] = await db
    .select({
      id: bookings.id,
      staffId: bookings.staffId,
      startTime: bookings.startTime,
      endTime: bookings.endTime,
    })
    .from(bookings)
    .where(and(...conds))
    .limit(1);
  if (!hit) return null;
  return {
    conflictingBookingId: hit.id,
    staffId: hit.staffId,
    startTime: hit.startTime,
    endTime: hit.endTime,
  };
}

// ─── Buffer-aware conflict detection ────────────────────────────────────────

export interface StaffWindow {
  staffId: string;
  startTime: Date;
  endTime: Date;
}

/**
 * Compute the per-staff blocked time windows for a booking-shaped object.
 *
 * Time geometry (when secondary is set):
 *   - Primary blocked  : [start + preBuf, start + preBuf + serviceDur)
 *   - Secondary blocked: [start, start + preBuf) ∪ [start + preBuf + serviceDur, start + total)
 *
 * When secondary is null:
 *   - Primary blocked for the entire [start, start + total) window — matches
 *     the legacy single-staff behavior.
 *
 * `total` is `preBuf + serviceDurationMinutes + postBuf` (the legacy
 * `bufferMinutes` is treated as additional shared time always blocking the
 * primary; callers add it to `serviceDurationMinutes` before passing in).
 */
export function getStaffBlockedWindows(b: {
  startTime: Date;
  staffId: string;
  secondaryStaffId: string | null;
  serviceDurationMinutes: number; // duration that blocks the primary
  preBufferMinutes: number;
  postBufferMinutes: number;
}): StaffWindow[] {
  const windows: StaffWindow[] = [];
  const start = b.startTime;
  const primaryStart = addMinutes(start, b.preBufferMinutes);
  const primaryEnd = addMinutes(primaryStart, b.serviceDurationMinutes);
  const totalEnd = addMinutes(primaryEnd, b.postBufferMinutes);

  if (b.secondaryStaffId) {
    // Primary owns only the service-duration window
    windows.push({ staffId: b.staffId, startTime: primaryStart, endTime: primaryEnd });
    if (b.preBufferMinutes > 0) {
      windows.push({ staffId: b.secondaryStaffId, startTime: start, endTime: primaryStart });
    }
    if (b.postBufferMinutes > 0) {
      windows.push({
        staffId: b.secondaryStaffId,
        startTime: primaryEnd,
        endTime: totalEnd,
      });
    }
  } else {
    // No secondary — primary is blocked for the full span
    windows.push({ staffId: b.staffId, startTime: start, endTime: totalEnd });
  }
  return windows;
}

/**
 * Buffer-aware conflict detection. Returns the first conflicting booking if
 * the proposed booking's primary or secondary windows overlap any other
 * booking's windows for the same staff.
 *
 * Implementation: scope to confirmed/in_progress bookings whose total span
 * overlaps the candidate's total span (cheap SQL prefilter), then materialize
 * each existing booking's per-staff windows and compare against the
 * candidate's per-staff windows.
 */
export async function findBookingConflict(params: {
  merchantId: string;
  candidate: {
    staffId: string;
    secondaryStaffId: string | null;
    startTime: Date;
    serviceDurationMinutes: number;
    preBufferMinutes: number;
    postBufferMinutes: number;
  };
  excludeBookingIds: string[];
}): Promise<Conflict | null> {
  const { candidate } = params;
  const candWindows = getStaffBlockedWindows(candidate);
  if (candWindows.length === 0) return null;

  // Total candidate span — the union of all candidate windows.
  const candStart = candidate.startTime;
  const candEnd = addMinutes(
    candStart,
    candidate.preBufferMinutes +
      candidate.serviceDurationMinutes +
      candidate.postBufferMinutes,
  );

  const involvedStaffIds = Array.from(
    new Set(candWindows.map((w) => w.staffId)),
  );

  const conds = [
    eq(bookings.merchantId, params.merchantId),
    inArray(bookings.status, ["confirmed", "in_progress"] as const),
    // SQL-side prefilter: the existing booking's [start,end] must overlap the
    // candidate's full span. This catches all bookings whose windows could
    // possibly conflict — the in-memory check then enforces window-level
    // overlap for the right staff IDs.
    lt(bookings.startTime, candEnd),
    gt(bookings.endTime, candStart),
    // Limit to bookings that touch one of the candidate's involved staff via
    // either primary or secondary slot. Using OR on uuids, both columns are
    // indexed (staffId via bookings_staff_start_time_idx; secondary not yet
    // indexed but the prefilter above already narrows the row count to a day).
    or(
      inArray(bookings.staffId, involvedStaffIds),
      inArray(bookings.secondaryStaffId, involvedStaffIds),
    )!,
  ];
  if (params.excludeBookingIds.length > 0) {
    conds.push(notInArray(bookings.id, params.excludeBookingIds));
  }

  // Pull just enough to reconstruct the existing booking's windows. We join
  // services to get pre/post buffer minutes; bookings.durationMinutes is the
  // pure service duration (blocks the primary).
  const candidates = await db
    .select({
      id: bookings.id,
      staffId: bookings.staffId,
      secondaryStaffId: bookings.secondaryStaffId,
      startTime: bookings.startTime,
      endTime: bookings.endTime,
      durationMinutes: bookings.durationMinutes,
      preBufferMinutes: services.preBufferMinutes,
      postBufferMinutes: services.postBufferMinutes,
    })
    .from(bookings)
    .innerJoin(services, eq(bookings.serviceId, services.id))
    .where(and(...conds));

  for (const ex of candidates) {
    const exWindows = getStaffBlockedWindows({
      startTime: ex.startTime,
      staffId: ex.staffId,
      secondaryStaffId: ex.secondaryStaffId ?? null,
      // Existing booking's primary-blocked duration. We use the service's
      // current pre/post + the booking's durationMinutes (which already
      // captures the legacy bufferMinutes baked in at booking time).
      serviceDurationMinutes:
        ex.durationMinutes -
        // Subtract pre/post since the bookings.durationMinutes column is the
        // pure service duration (see services route — durationMinutes set to
        // svc.durationMinutes only). This is defensive: if a future writer
        // bakes pre/post into bookings.durationMinutes, the subtraction
        // prevents double-counting. Today the value is 0 anyway.
        0,
      preBufferMinutes: ex.preBufferMinutes,
      postBufferMinutes: ex.postBufferMinutes,
    });

    for (const c of candWindows) {
      for (const e of exWindows) {
        if (c.staffId !== e.staffId) continue;
        if (c.startTime < e.endTime && c.endTime > e.startTime) {
          return {
            conflictingBookingId: ex.id,
            staffId: c.staffId,
            startTime: e.startTime,
            endTime: e.endTime,
          };
        }
      }
    }
  }

  return null;
}
