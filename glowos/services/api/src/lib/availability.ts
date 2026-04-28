import { and, eq, inArray, gte, lte, or } from "drizzle-orm";
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
import { getStaffBlockedWindows, type StaffWindow } from "./booking-conflicts.js";

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface AvailableSlot {
  start_time: string; // ISO datetime
  end_time: string;
  staff_id: string;
  staff_name: string;
  /**
   * Auto-assigned secondary staff for services with pre/post buffers. The
   * widget will pass this back when creating the booking so the secondary
   * persists. Null for services with no buffers, and slot is dropped
   * entirely if a secondary couldn't be found for a buffered service.
   */
  secondary_staff_id?: string | null;
  secondary_staff_name?: string | null;
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
function combineDateAndTime(dateStr: string, timeStr: string, timezone?: string): Date {
  const [hh, mm] = timeStr.split(":");
  if (timezone) {
    // Staff hours are in the merchant's local timezone (e.g., 09:00 SGT).
    // We need to find the UTC equivalent of "dateStr at hh:mm in timezone".
    //
    // Strategy: create a UTC Date at hh:mm, check what Intl says that is in
    // the target timezone, then compute the offset and adjust.
    const utcGuess = new Date(Date.UTC(
      parseInt(dateStr.slice(0, 4)),
      parseInt(dateStr.slice(5, 7)) - 1,
      parseInt(dateStr.slice(8, 10)),
      parseInt(hh),
      parseInt(mm)
    ));
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone, hour: "numeric", minute: "2-digit", hour12: false,
    }).formatToParts(utcGuess);
    const localHour = parseInt(parts.find(p => p.type === "hour")?.value ?? "0");
    const localMin = parseInt(parts.find(p => p.type === "minute")?.value ?? "0");
    // offset = how far the timezone is from UTC, in minutes
    let offsetMin = (localHour * 60 + localMin) - (parseInt(hh) * 60 + parseInt(mm));
    if (offsetMin > 12 * 60) offsetMin -= 24 * 60;
    if (offsetMin < -12 * 60) offsetMin += 24 * 60;
    // To get hh:mm in local tz, subtract offset from UTC guess
    return new Date(utcGuess.getTime() - offsetMin * 60 * 1000);
  }
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
    .select({ id: merchants.id, operatingHours: merchants.operatingHours, timezone: merchants.timezone })
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
      start: combineDateAndTime(date, cl.startTime!, merchant.timezone),
      end: combineDateAndTime(date, cl.endTime!, merchant.timezone),
    }));

  // 3. Load service (duration + buffer = total slot duration)
  const [service] = await db
    .select({
      id: services.id,
      durationMinutes: services.durationMinutes,
      bufferMinutes: services.bufferMinutes,
      preBufferMinutes: services.preBufferMinutes,
      postBufferMinutes: services.postBufferMinutes,
      isActive: services.isActive,
    })
    .from(services)
    .where(and(eq(services.id, serviceId), eq(services.merchantId, merchant.id)))
    .limit(1);

  if (!service || !service.isActive) return [];

  // Total slot length on the calendar:
  //   pre-buffer  + service-duration + legacy-shared-buffer + post-buffer
  // The legacy `bufferMinutes` is treated as extra time always blocking the
  // primary (so we lump it into the primary's window via serviceDurationForConflict).
  const serviceDurationForConflict = service.durationMinutes + service.bufferMinutes;
  const totalDuration =
    service.preBufferMinutes + serviceDurationForConflict + service.postBufferMinutes;
  const hasBuffers = service.preBufferMinutes > 0 || service.postBufferMinutes > 0;

  // 4. Load staff list
  let staffList: Array<{ id: string; name: string }> = [];

  if (staffIdParam === "any") {
    // Any-available pool: active staff who perform this service AND are
    // flagged is_any_available. Merchants can opt staff in/out of this pool
    // (e.g. a premium-only specialist is kept out). is_publicly_visible is
    // also enforced so the synthetic placeholder staff row — if one exists —
    // is never matched here.
    const rows = await db
      .select({ id: staff.id, name: staff.name })
      .from(staff)
      .innerJoin(staffServices, eq(staffServices.staffId, staff.id))
      .where(
        and(
          eq(staff.merchantId, merchant.id),
          eq(staff.isActive, true),
          eq(staff.isPubliclyVisible, true),
          eq(staff.isAnyAvailable, true),
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
  // Parse as local date (not UTC) to get correct day-of-week
  const [yr, mo, dy] = date.split("-").map(Number);
  const parsedDate = new Date(yr, mo - 1, dy);
  const dayOfWeek = parsedDate.getDay();

  // 6. Load existing bookings and active leases for the date range
  // Use timezone-aware day boundaries so we query the correct UTC range
  const dayStart = combineDateAndTime(date, "00:00", merchant.timezone);
  const dayEnd = combineDateAndTime(date, "23:59", merchant.timezone);
  const staffIds = staffList.map((s) => s.id);

  // For buffer-aware conflict detection we also need to load bookings where
  // a candidate staff is the SECONDARY (e.g. they'd be blocked during pre or
  // post buffer of someone else's booking). We also need each booking's
  // service buffers + secondaryStaffId to materialize windows.
  //
  // For services with buffers, we additionally need to consider ALL active
  // staff in the merchant as candidate secondaries — so we widen the load
  // to bookings touching any of the merchant's staff, scoped by date.
  const candidateSecondaryPool = hasBuffers
    ? await db
        .select({ id: staff.id, name: staff.name })
        .from(staff)
        .where(
          and(
            eq(staff.merchantId, merchant.id),
            eq(staff.isActive, true),
            eq(staff.isPubliclyVisible, true),
          ),
        )
    : [];

  const allInvolvedStaffIds = hasBuffers
    ? Array.from(new Set([...staffIds, ...candidateSecondaryPool.map((s) => s.id)]))
    : staffIds;

  const existingBookingsRaw = allInvolvedStaffIds.length === 0
    ? []
    : await db
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
        .where(
          and(
            or(
              inArray(bookings.staffId, allInvolvedStaffIds),
              inArray(bookings.secondaryStaffId, allInvolvedStaffIds),
            )!,
            inArray(bookings.status, ["confirmed", "in_progress"] as const),
            gte(bookings.startTime, dayStart),
            lte(bookings.startTime, dayEnd)
          )
        );

  // Materialize per-staff blocked windows for every existing booking. The
  // map is keyed by staffId so each candidate slot can do an O(k) overlap
  // check against just the windows for its assigned staff.
  const blockedByStaff = new Map<string, StaffWindow[]>();
  for (const b of existingBookingsRaw) {
    // bookings.durationMinutes today is set to svc.durationMinutes (pure
    // service duration). We add the legacy bufferMinutes back from the
    // service join? No — durationMinutes here represents the primary's
    // blocked window length. For correctness with the existing data we use
    // (endTime - startTime) - preBuf - postBuf to derive the "primary
    // duration" the booking was originally created with (handles legacy
    // bufferMinutes baked into endTime).
    const totalSpanMin =
      Math.round((b.endTime.getTime() - b.startTime.getTime()) / 60000);
    const primaryDurationMin = Math.max(
      0,
      totalSpanMin - b.preBufferMinutes - b.postBufferMinutes,
    );
    const windows = getStaffBlockedWindows({
      startTime: b.startTime,
      staffId: b.staffId,
      secondaryStaffId: b.secondaryStaffId ?? null,
      serviceDurationMinutes: primaryDurationMin,
      preBufferMinutes: b.preBufferMinutes,
      postBufferMinutes: b.postBufferMinutes,
    });
    for (const w of windows) {
      if (!blockedByStaff.has(w.staffId)) blockedByStaff.set(w.staffId, []);
      blockedByStaff.get(w.staffId)!.push(w);
    }
  }

  // Slot leases are not yet implemented (slot_leases table not yet created).
  // Set to empty array so availability falls back to booking-only conflict detection.
  const activeLeasesRaw: Array<{ staffId: string; startTime: Date; endTime: Date }> = [];

  // Helper: does the proposed [start, end) for `staffId` overlap any
  // existing blocked window for that staff?
  function staffBusyDuring(staffId: string, start: Date, end: Date): boolean {
    const wins = blockedByStaff.get(staffId);
    if (!wins) return false;
    for (const w of wins) {
      if (start < w.endTime && end > w.startTime) return true;
    }
    return false;
  }

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

    const workStart = combineDateAndTime(date, hours.startTime, merchant.timezone);
    const workEnd = combineDateAndTime(date, hours.endTime, merchant.timezone);

    const memberLeases = activeLeasesRaw
      .filter((l) => l.staffId === member.id)
      .map((l) => ({ startTime: l.startTime, endTime: l.endTime }));

    const candidates = generateTimeSlots(workStart, workEnd, totalDuration, 30);

    for (const slot of candidates) {
      const slotEnd = addMinutes(slot.start, totalDuration);

      // Check partial closures
      const overlapsClosures = closureRanges.some(
        (cl) => slot.start < cl.end && slotEnd > cl.start,
      );
      if (overlapsClosures) continue;

      if (overlapsWithLeases(slot.start, totalDuration, memberLeases)) continue;

      // Compute the candidate windows for this slot. When the service has
      // buffers we'll auto-assign the first available secondary; when no
      // secondary fits, the slot is dropped.
      const primaryStart = addMinutes(slot.start, service.preBufferMinutes);
      const primaryEnd = addMinutes(primaryStart, serviceDurationForConflict);

      // Primary must be free during the primary window
      if (staffBusyDuring(member.id, primaryStart, primaryEnd)) continue;

      let chosenSecondaryId: string | null = null;
      let chosenSecondaryName: string | null = null;

      if (hasBuffers) {
        // Look for a secondary free during BOTH the pre-buffer window
        // (if any) and the post-buffer window (if any). The secondary
        // must not be the primary.
        for (const sec of candidateSecondaryPool) {
          if (sec.id === member.id) continue;
          if (
            service.preBufferMinutes > 0 &&
            staffBusyDuring(sec.id, slot.start, primaryStart)
          ) {
            continue;
          }
          if (
            service.postBufferMinutes > 0 &&
            staffBusyDuring(sec.id, primaryEnd, slotEnd)
          ) {
            continue;
          }
          chosenSecondaryId = sec.id;
          chosenSecondaryName = sec.name;
          break;
        }
        if (!chosenSecondaryId) {
          // For merchants with no other publicly-visible staff (solo
          // practitioner), fall back to single-staff behavior: keep the
          // slot with secondary=null. getStaffBlockedWindows already
          // handles secondaryStaffId=null by blocking the primary for
          // the full span, so future availability stays correct.
          // For multi-staff merchants where every secondary was busy,
          // keep the strict drop.
          const hasAnyOtherStaff = candidateSecondaryPool.some(
            (s) => s.id !== member.id,
          );
          if (hasAnyOtherStaff) continue;
        }
      }

      allSlots.push({
        start_time: slot.start.toISOString(),
        end_time: slot.end.toISOString(),
        staff_id: member.id,
        staff_name: member.name,
        secondary_staff_id: chosenSecondaryId,
        secondary_staff_name: chosenSecondaryName,
      });
    }
  }

  // 8. Cache and return
  await setCache(cacheKey, JSON.stringify(allSlots), 30);
  return allSlots;
}
