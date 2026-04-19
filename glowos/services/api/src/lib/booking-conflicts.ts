import { and, eq, ne, or, lt, gt, inArray } from "drizzle-orm";
import { db, bookings } from "@glowos/db";

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
    conds.push(
      or(
        ...params.excludeBookingIds.map((id) => ne(bookings.id, id))
      )!
    );
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
