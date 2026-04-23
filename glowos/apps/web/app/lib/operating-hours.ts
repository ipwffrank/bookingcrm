/**
 * Derive the calendar-display hour range for a merchant from their
 * operating_hours map.
 *
 * Takes the earliest `open` across non-closed days and the latest `close`,
 * then widens by 1 hour (rounded to the hour) on each side so users can
 * still see the just-before-open / just-after-close gaps at a glance.
 * Falls back to a conservative 7:00–22:00 window if no hours are set.
 *
 * Time strings are assumed HH:MM or HH:MM:SS in the merchant's local tz —
 * FullCalendar is tz-agnostic about slot ranges, so we just treat them as
 * local-clock hours.
 */

export type OperatingHoursMap = Record<
  string,
  { open: string; close: string; closed: boolean }
> | null
  | undefined;

const DEFAULT_START_HOUR = 7;
const DEFAULT_END_HOUR = 22;
const MIN_WINDOW_HOURS = 6; // Don't render an absurdly thin view

function parseHour(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = value.match(/^(\d{1,2}):(\d{2})/);
  if (!match || !match[1] || !match[2]) return null;
  const h = parseInt(match[1], 10);
  const m = parseInt(match[2], 10);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h + m / 60;
}

export function computeCalendarRange(hours: OperatingHoursMap): {
  startHour: number;
  endHour: number;
  slotMinTime: string;
  slotMaxTime: string;
} {
  let earliestOpen: number | null = null;
  let latestClose: number | null = null;

  if (hours) {
    for (const entry of Object.values(hours)) {
      if (!entry || entry.closed) continue;
      const open = parseHour(entry.open);
      const close = parseHour(entry.close);
      if (open !== null && (earliestOpen === null || open < earliestOpen)) {
        earliestOpen = open;
      }
      if (close !== null && (latestClose === null || close > latestClose)) {
        latestClose = close;
      }
    }
  }

  let startHour =
    earliestOpen !== null ? Math.max(0, Math.floor(earliestOpen - 1)) : DEFAULT_START_HOUR;
  let endHour =
    latestClose !== null ? Math.min(24, Math.ceil(latestClose + 1)) : DEFAULT_END_HOUR;

  // Guarantee a readable minimum window.
  if (endHour - startHour < MIN_WINDOW_HOURS) {
    const pad = Math.ceil((MIN_WINDOW_HOURS - (endHour - startHour)) / 2);
    startHour = Math.max(0, startHour - pad);
    endHour = Math.min(24, endHour + pad);
  }

  const pad2 = (n: number) => n.toString().padStart(2, "0");
  return {
    startHour,
    endHour,
    slotMinTime: `${pad2(startHour)}:00:00`,
    slotMaxTime: `${pad2(endHour)}:00:00`,
  };
}
