import { and, eq, inArray, gte, lte } from "drizzle-orm";
import {
  db,
  services,
  staff,
  staffServices,
  staffHours,
  bookings,
  merchants,
  merchantClosures,
} from "@glowos/db";
import { addMinutes, parseISO, format, startOfDay, endOfDay, getDay } from "date-fns";
import { getCache, setCache, deleteCache } from "./redis.js";

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface AvailableSlot {
  start_time: string; // ISO datetime
  end_time: string;
  staff_id: string;
  staff_name: string;
}

interface TimeRange {
  start: Date;
  end: Date;
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Given a date string (YYYY-MM-DD) and a time string from the DB ("HH:MM:SS" or "HH:MM"),
 * return a Date object combining them.
 * Drizzle returns time columns as "HH:MM:SS"; we take only HH:MM to avoid
 * constructing an invalid ISO string like "T09:00:00:00" which makes parseISO
 * return Invalid Date and causes generateTimeSlots to loop forever.
 */
function combineDateAndTime(dateStr: string, timeStr: string): Date {
  const [hh, mm] = timeStr.split(":");
  return parseISO(`${dateStr}T${hh}:${mm}:00`);
}

/**
 * Generate candidate time slots every `intervalMinutes` minutes within
 * [workStart, workEnd), where each slot has length `slotDurationMinutes`.
 */
function generateTimeSlots(
  workStart: Date,
  workEnd: Date,
  slotDurationMinutes: number,
  intervalMinutes: number
): TimeRange[] {
  // Guard: invalid dates or zero interval would cause an infinite loop
  if (
    isNaN(workStart.getTime()) ||
    isNaN(workEnd.getTime()) ||
    workEnd <= workStart ||
    intervalMinutes <= 0 ||
    slotDurationMinutes <= 0
  ) {
    return [];
  }

  const slots: TimeRange[] = [];
  let cursor = workStart;
  const MAX_SLOTS = 500; // safety cap — a full day at 1-min intervals is ~1440

  while (slots.length < MAX_SLOTS) {
    const slotEnd = addMinutes(cursor, slotDurationMinutes);
    if (slotEnd > workEnd) break;
    slots.push({ start: new Date(cursor), end: slotEnd });
    cursor = addMinutes(cursor, intervalMinutes);
  }

  return slots;
}

/**
 * Returns true if [slotStart, slotStart + durationMinutes) overlaps any booking.
 */
function overlapsWithBookings(
  slotStart: Date,
  slotDurationMinutes: number,
  existingBookings: Array<{ startTime: Date; endTime: Date }>
): boolean {
  const slotEnd = addMinutes(slotStart, slotDurationMinutes);
  for (const bk of existingBookings) {
    if (slotStart < bk.endTime && slotEnd > bk.startTime) return true;
  }
  return false;
}

/**
 * Returns true if [slotStart, slotStart + durationMinutes) overlaps any active lease.
 */
function overlapsWithLeases(
  slotStart: Date,
  slotDurationMinutes: number,
  activeLeases: Array<{ startTime: Date; endTime: Date }>
): boolean {
  const slotEnd = addMinutes(slotStart, slotDurationMinutes);
  for (const lease of activeLeases) {
    if (slotStart < lease.endTime && slotEnd > lease.startTime) return true;
  }
  return false;
}

/**
 * Invalidates all cached availability keys for a given merchant slug.
 */
export async function invalidateAvailabilityCache(merchantSlug: string): Promise<void> {
  await deleteCache(`avail:${merchantSlug}:*`);
}

/**
 * Invalidates all cached availability keys for a merchant looked up by merchantId.
 */
export async function invalidateAvailabilityCacheByMerchantId(merchantId: string): Promise<void> {
  const [merchant] = await db
    .select({ slug: merchants.slug })
    .from(merchants)
    .where(eq(merchants.id, merchantId))
    .limit(1);

  if (merchant) {
    await invalidateAvailabilityCache(merchant.slug);
  }
}

// ─── Main availability function ────────────────────────────────────────────────

export async function getAvailability(params: {
  merchantSlug: string;
  serviceId: string;
  staffId?: string; // 'any' or specific UUID
  date: string; // YYYY-MM-DD
}): Promise<AvailableSlot[]> {
  const { merchantSlug, serviceId, date } = params;
  const staffIdParam = params.staffId ?? "any";

  // 1. Build cache key and check Redis first
  const cacheKey = `avail:${merchantSlug}:${serviceId}:${staffIdParam}:${date}`;
  const cached = await getCache(cacheKey);
  if (cached) {
    return JSON.parse(cached) as AvailableSlot[];
  }

  // 2. Load merchant by slug
  const [merchant] = await db
    .select({ id: merchants.id, operatingHours: merchants.operatingHours })
    .from(merchants)
    .where(eq(merchants.slug, merchantSlug))
    .limit(1);

  if (!merchant) return [];

  // 2a. Check merchant operating hours
  if (merchant.operatingHours) {
    const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const requestedDate = new Date(params.date + 'T00:00:00');
    const dayName = dayNames[requestedDate.getDay()];
    const dayHours = merchant.operatingHours[dayName];

    if (dayHours && dayHours.closed) {
      await setCache(cacheKey, JSON.stringify([]), 30);
      return []; // Business is closed on this day
    }
  }

  // 2b. Check for closures on this date
  const closures = await db
    .select({
      isFullDay: merchantClosures.isFullDay,
      startTime: merchantClosures.startTime,
      endTime: merchantClosures.endTime,
    })
    .from(merchantClosures)
    .where(
      and(
        eq(merchantClosures.merchantId, merchant.id),
        eq(merchantClosures.date, date)
      )
    );

  // If any full-day closure exists, no slots available
  if (closures.some((cl) => cl.isFullDay)) {
    await setCache(cacheKey, JSON.stringify([]), 30);
    return [];
  }

  // Build partial closure ranges for later filtering
  const closureRanges: TimeRange[] = closures
    .filter((cl) => !cl.isFullDay && cl.startTime && cl.endTime)
    .map((cl) => ({
      start: combineDateAndTime(date, cl.startTime!),
      end: combineDateAndTime(date, cl.endTime!),
    }));

  // 3. Load service (duration + buffer = total slot duration)
  const [service] = await db
    .select({
      id: services.id,
      durationMinutes: services.durationMinutes,
      bufferMinutes: services.bufferMinutes,
      isActive: services.isActive,
    })
    .from(services)
    .where(and(eq(services.id, serviceId), eq(services.merchantId, merchant.id)))
    .limit(1);

  if (!service || !service.isActive) return [];

  const totalDuration = service.durationMinutes + service.bufferMinutes;

  // 4. Load staff list
  let staffList: Array<{ id: string; name: string }> = [];

  if (staffIdParam === "any") {
    // All active staff that can perform this service
    const rows = await db
      .select({ id: staff.id, name: staff.name })
      .from(staff)
      .innerJoin(staffServices, eq(staffServices.staffId, staff.id))
      .where(
        and(
          eq(staff.merchantId, merchant.id),
          eq(staff.isActive, true),
          eq(staffServices.serviceId, serviceId)
        )
      );
    staffList = rows;
  } else {
    const rows = await db
      .select({ id: staff.id, name: staff.name })
      .from(staff)
      .innerJoin(staffServices, eq(staffServices.staffId, staff.id))
      .where(
        and(
          eq(staff.id, staffIdParam),
          eq(staff.merchantId, merchant.id),
          eq(staff.isActive, true),
          eq(staffServices.serviceId, serviceId)
        )
      );
    staffList = rows;
  }

  if (staffList.length === 0) return [];

  // 5. Determine day of week for this date (0=Sunday, 6=Saturday)
  const parsedDate = parseISO(date);
  const dayOfWeek = getDay(parsedDate);

  // 6. Load existing bookings and active leases for the date range
  const dayStart = startOfDay(parsedDate);
  const dayEnd = endOfDay(parsedDate);
  const staffIds = staffList.map((s) => s.id);

  const existingBookingsRaw = await db
    .select({ staffId: bookings.staffId, startTime: bookings.startTime, endTime: bookings.endTime })
    .from(bookings)
    .where(
      and(
        inArray(bookings.staffId, staffIds),
        inArray(bookings.status, ["confirmed", "in_progress"] as const),
        gte(bookings.startTime, dayStart),
        lte(bookings.startTime, dayEnd)
      )
    );

  // Slot leases are not yet implemented (slot_leases table not yet created).
  // Set to empty array so availability falls back to booking-only conflict detection.
  const activeLeasesRaw: Array<{ staffId: string; startTime: Date; endTime: Date }> = [];

  // 7. For each staff member, compute free slots
  const allSlots: AvailableSlot[] = [];

  for (const member of staffList) {
    // Load working hours for this day
    const [hours] = await db
      .select({
        startTime: staffHours.startTime,
        endTime: staffHours.endTime,
        isWorking: staffHours.isWorking,
      })
      .from(staffHours)
      .where(
        and(eq(staffHours.staffId, member.id), eq(staffHours.dayOfWeek, dayOfWeek))
      )
      .limit(1);

    if (!hours || !hours.isWorking) continue;

    const workStart = combineDateAndTime(date, hours.startTime);
    const workEnd = combineDateAndTime(date, hours.endTime);

    const memberBookings = existingBookingsRaw
      .filter((b) => b.staffId === member.id)
      .map((b) => ({ startTime: b.startTime, endTime: b.endTime }));

    const memberLeases = activeLeasesRaw
      .filter((l) => l.staffId === member.id)
      .map((l) => ({ startTime: l.startTime, endTime: l.endTime }));

    const candidates = generateTimeSlots(workStart, workEnd, totalDuration, 30);

    for (const slot of candidates) {
      // Check partial closures
      const overlapsClosures = closureRanges.some((cl) => {
        const slotEnd = addMinutes(slot.start, totalDuration);
        return slot.start < cl.end && slotEnd > cl.start;
      });

      if (
        !overlapsClosures &&
        !overlapsWithBookings(slot.start, totalDuration, memberBookings) &&
        !overlapsWithLeases(slot.start, totalDuration, memberLeases)
      ) {
        allSlots.push({
          start_time: slot.start.toISOString(),
          end_time: slot.end.toISOString(),
          staff_id: member.id,
          staff_name: member.name,
        });
      }
    }
  }

  // 8. Cache and return
  await setCache(cacheKey, JSON.stringify(allSlots), 30);
  return allSlots;
}
