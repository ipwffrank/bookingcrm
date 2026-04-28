// Shared helpers for the operating-hours gate. The same check fires at every
// endpoint that creates or moves a booking's start_time so a non-gated edit
// path can't be used to land out-of-hours bookings.

import { db, merchants } from "@glowos/db";
import { eq } from "drizzle-orm";

export type OperatingHoursMap = Record<
  string,
  { open: string; close: string; closed: boolean }
> | null;

export interface MerchantHoursContext {
  operatingHours: OperatingHoursMap;
  timezone: string;
}

/**
 * Loads operating_hours + timezone for a merchant. Returns null/Asia-Singapore
 * defaults so callers always have a usable shape.
 */
export async function loadMerchantHoursContext(
  merchantId: string,
): Promise<MerchantHoursContext> {
  const [row] = await db
    .select({
      operatingHours: merchants.operatingHours,
      timezone: merchants.timezone,
    })
    .from(merchants)
    .where(eq(merchants.id, merchantId))
    .limit(1);
  return {
    operatingHours: row?.operatingHours ?? null,
    timezone: row?.timezone ?? "Asia/Singapore",
  };
}

/**
 * Operating-hours violation in the merchant's local timezone.
 *
 * operating_hours store merchant-local clock times — '09:00'–'19:00' means
 * 9 AM – 7 PM in the merchant's tz. The Railway server runs in UTC, so naive
 * d.getDay() / d.getHours() returns UTC values which mis-frame the comparison.
 * We use Intl.DateTimeFormat with the merchant's timezone to get the correct
 * weekday + HH:MM in that frame.
 *
 * Missing days in the operating_hours map are treated as 'closed' — a
 * merchant who configured Mon–Fri but not Sat/Sun should not silently allow
 * Saturday bookings.
 */
export function outsideHoursViolation(
  iso: string,
  operatingHours: NonNullable<OperatingHoursMap>,
  timezone: string,
): "closed" | "outside" | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;

  let weekday: string;
  let hour: number;
  let minute: number;
  try {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      weekday: "long",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const parts = fmt.formatToParts(d);
    weekday = (parts.find((p) => p.type === "weekday")?.value ?? "").toLowerCase();
    hour = parseInt(parts.find((p) => p.type === "hour")?.value ?? "", 10);
    minute = parseInt(parts.find((p) => p.type === "minute")?.value ?? "", 10);
  } catch {
    return null;
  }
  if (!weekday || Number.isNaN(hour) || Number.isNaN(minute)) return null;
  if (hour === 24) hour = 0;

  const day = operatingHours[weekday];
  if (!day || day.closed) return "closed";

  const [oh, om] = day.open.split(":").map((n) => parseInt(n, 10));
  const [ch, cm] = day.close.split(":").map((n) => parseInt(n, 10));
  if ([oh, om, ch, cm].some((n) => Number.isNaN(n))) return null;
  const open = oh * 60 + om;
  const close = ch * 60 + cm;
  const min = hour * 60 + minute;
  if (min < open || min > close) return "outside";
  return null;
}

/**
 * Helper for endpoints to assert a single start_time is within hours. Returns
 * a 403 response payload when the time is out, or null when it's fine.
 *
 * Fail-secure: if operatingHours is null/empty (merchant never configured),
 * we treat it as a hard block. The merchant has to set hours explicitly
 * before any booking can be created. Previously this returned null (allow),
 * which meant a misconfigured merchant could book any time and the user
 * couldn't tell why the gate wasn't firing.
 */
export function buildHoursViolationResponse(
  startTimeIso: string,
  ctx: MerchantHoursContext,
  serviceLabel: string = "Booking",
): { error: string; message: string } | null {
  if (!ctx.operatingHours || Object.keys(ctx.operatingHours).length === 0) {
    return {
      error: "Forbidden",
      message:
        "Operating hours are not configured for this merchant. Set them in Settings → Operating Hours first.",
    };
  }
  const v = outsideHoursViolation(startTimeIso, ctx.operatingHours, ctx.timezone);
  if (v === "closed") {
    return {
      error: "Forbidden",
      message: `${serviceLabel} falls on a day the merchant is closed.`,
    };
  }
  if (v === "outside") {
    return {
      error: "Forbidden",
      message: `${serviceLabel} is outside operating hours.`,
    };
  }
  return null;
}
