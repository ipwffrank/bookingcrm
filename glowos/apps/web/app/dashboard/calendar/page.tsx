'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import Link from 'next/link';
import { apiFetch } from '../../lib/api';
import { BookingForm } from '../bookings/BookingForm';
import { CheckoutModal } from '../components/CheckoutModal';
import { computeCalendarRange } from '../../lib/operating-hours';
import FullCalendar from '@fullcalendar/react';
import timeGridPlugin from '@fullcalendar/timegrid';
import dayGridPlugin from '@fullcalendar/daygrid';
import interactionPlugin from '@fullcalendar/interaction';
import type { EventInput, DatesSetArg, EventClickArg, EventDropArg } from '@fullcalendar/core';

// ─── Grid constants (static) ───────────────────────────────────────────────────
// DAY_START_H / DAY_END_H defaults; the actual per-merchant range is derived
// inside the component from their operating_hours and overrides these at runtime.
const DEFAULT_DAY_START_H = 7;
const DEFAULT_DAY_END_H   = 22;
const SNAP_MIN    = 15;

// ─── Types ─────────────────────────────────────────────────────────────────────
interface Staff { id: string; name: string; }

interface Duty {
  id: string; staffId: string; date: string;
  startTime: string; endTime: string; notes: string | null;
}

interface Booking {
  id: string; staffId: string | null; clientId: string | null;
  startTime: string; endTime: string; status: string;
  clientName: string | null; serviceName: string | null; staffName: string | null;
  priceSgd: string | null;
}

interface ServiceHistoryItem {
  serviceName: string | null;
  staffName: string | null;
  date: string;
  price: string;
  status: string;
}

interface ClientSnippet {
  profileId: string;
  totalVisits: number;
  totalSpendSgd: string;
  lastVisitAt: string | null;
  vipTier: string | null;
  notes: string | null;
  marketingOptIn: boolean;
  clientName: string | null;
  clientEmail: string | null;
  clientPhone: string;
  serviceHistory: ServiceHistoryItem[];
}

interface RawBookingRow {
  booking:     { id: string; staffId: string | null; clientId: string; startTime: string; endTime: string; status: string; priceSgd: string };
  service:     { name: string } | null;
  staffMember: { name: string } | null;
  client:      { id: string; name: string | null } | null;
}

interface DragViz { entityId: string; entityType: 'duty' | 'booking'; staffId: string; startMin: number; endMin: number; }

// ─── Constants ─────────────────────────────────────────────────────────────────
// Event blocks: single ink for bookings, sage for duties, danger-tint for closures.
// Staff identity in the grid comes from column position + title text, not a per-
// staff hue — the rainbow palette competed with status signals and pushed the
// calendar out of the 3-tone system.
const BOOKING_BG = '#1a2313';
const DUTY_BG = '#6b8e5a';
const CLOSURE_BG = 'rgba(184, 64, 58, 0.08)';
const CLOSURE_BORDER = 'rgba(184, 64, 58, 0.25)';
const UNASSIGNED_BG = 'rgba(26, 35, 19, 0.55)';

// Staff avatar circles in column headers still benefit from small visual
// differentiation. A 4-slot ink-opacity ramp gives enough contrast for a quick
// scan without reintroducing colored chrome.
const AVATAR_GREYS = [
  'rgba(26, 35, 19, 0.92)',
  'rgba(26, 35, 19, 0.72)',
  'rgba(26, 35, 19, 0.52)',
  'rgba(26, 35, 19, 0.35)',
];

const STATUS_META: Record<string, { label: string; cls: string }> = {
  confirmed:   { label: 'Confirmed',   cls: 'bg-tone-sage/5 text-tone-sage' },
  completed:   { label: 'Completed',   cls: 'bg-grey-15 text-grey-75' },
  cancelled:   { label: 'Cancelled',   cls: 'bg-semantic-danger/5 text-semantic-danger' },
  no_show:     { label: 'No Show',     cls: 'bg-semantic-warn/5 text-semantic-warn' },
  in_progress: { label: 'In Progress', cls: 'bg-grey-5 text-tone-ink' },
};

// ─── Static helpers (no PX_PER_MIN dependency) ────────────────────────────────
function timeStrToMin(t: string) {
  const [h, m] = t.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}
function minToStr(min: number) {
  return `${Math.floor(min / 60).toString().padStart(2, '0')}:${(min % 60).toString().padStart(2, '0')}`;
}
function isoToLocalMin(iso: string) {
  const d = new Date(iso);
  return d.getHours() * 60 + d.getMinutes();
}
function snap(min: number)                        { return Math.round(min / SNAP_MIN) * SNAP_MIN; }
function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }

// ─── Component ─────────────────────────────────────────────────────────────────
export default function CalendarPage() {
  const [date,       setDate]       = useState(() => new Date());
  const [staffList,  setStaffList]  = useState<Staff[]>([]);
  const [duties,     setDuties]     = useState<Duty[]>([]);
  const [bookings,   setBookings]   = useState<Booking[]>([]);
  const [loading,    setLoading]    = useState(false);
  const [density,    setDensity]    = useState<'compact' | 'comfortable'>('comfortable');
  const [viewMode,   setViewMode]   = useState<'day' | 'week' | 'month'>('day');
  const [closureTitle, setClosureTitle] = useState<string | null>(null);
  const [fcRange, setFcRange] = useState<{ start: string; end: string } | null>(null);
  const [editBookingId, setEditBookingId] = useState<string | null>(null);
  const [allClosures, setAllClosures] = useState<Array<{ id: string; date: string; title: string; isFullDay: boolean; startTime: string | null; endTime: string | null }>>([]);
  const [operatingHours, setOperatingHours] = useState<Record<string, { open: string; close: string; closed: boolean }> | null>(null);

  // Modals
  const [selBooking,    setSelBooking]    = useState<Booking | null>(null);
  // Checkout modal — opened by Complete (in_progress) or Checkout Now (confirmed).
  // Same component as the dashboard, so loyalty redemption + payment method
  // flow is consistent everywhere completion happens.
  const [checkoutBookingId, setCheckoutBookingId] = useState<string | null>(null);
  const [clientSnippet, setClientSnippet] = useState<ClientSnippet | null>(null);
  const [snippetLoading, setSnippetLoading] = useState(false);
  const [showReschedule,   setShowReschedule]   = useState(false);
  const [rescheduleForm,   setRescheduleForm]   = useState({ date: '', time: '' });
  const [rescheduleSaving, setRescheduleSaving] = useState(false);
  const [rescheduleError,  setRescheduleError]  = useState<string | null>(null);
  const [showDutyModal, setShowDutyModal] = useState(false);
  const [editDuty,      setEditDuty]      = useState<Duty | null>(null);
  const [dutyForm,      setDutyForm]      = useState({ staffId: '', date: '', startTime: '09:00', endTime: '17:00', notes: '' });
  const [dutyError,     setDutyError]     = useState<string | null>(null);
  const [dutySaving,    setDutySaving]    = useState(false);

  // Client search
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<{ id: string; clientId: string; name: string | null; phone: string; email: string | null }[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [clientBookings, setClientBookings] = useState<{ id: string; startTime: string; endTime: string; status: string; serviceName: string; staffName: string }[] | null>(null);
  const [selectedClient, setSelectedClient] = useState<{ name: string; phone: string } | null>(null);
  const searchRef = useRef<HTMLDivElement>(null);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Drag — refs for zero-overhead mousemove, bump state for visual re-renders
  type DragData =
    | { entityType: 'duty'; type: 'move' | 'resize'; duty: Duty; startY: number; origStart: number; origEnd: number; }
    | { entityType: 'booking'; type: 'move' | 'resize'; booking: Booking; startY: number; origStart: number; origEnd: number; };
  const dragData = useRef<DragData | null>(null);
  const dragVizR = useRef<DragViz | null>(null);
  const [, bump] = useState(0);
  const colRefs  = useRef<Record<string, HTMLDivElement | null>>({});
  const loadRef  = useRef<() => Promise<void>>(async () => {});
  const ppmRef   = useRef(2); // kept in sync with ppm for stable drag effect
  const dateRef  = useRef(''); // kept in sync with dateStr for stable drag effect

  // ── Dynamic grid helpers (depend on density + merchant operating hours) ─────
  // Pulls the visible day range from the merchant's operating_hours so each
  // merchant sees a calendar focused on their own trading hours, not a
  // one-size-fits-all 7am–10pm window.
  const calendarRange = computeCalendarRange(operatingHours);
  const DAY_START_H = calendarRange.startHour;
  const DAY_END_H = calendarRange.endHour;
  const ppm      = density === 'compact' ? 1.5 : 2;   // px per minute
  const totalPx  = (DAY_END_H - DAY_START_H) * 60 * ppm;
  const topPx    = (min: number) => (min - DAY_START_H * 60) * ppm;
  const heightPx = (sm: number, em: number) => Math.max(ppm * 15, (em - sm) * ppm);

  useEffect(() => { ppmRef.current = ppm; }, [ppm]);

  const dateStr = date.toISOString().slice(0, 10);
  useEffect(() => { dateRef.current = dateStr; }, [dateStr]);

  // ── Data ──────────────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [sd, dd, bd, cd] = await Promise.all([
        apiFetch('/merchant/staff'),
        apiFetch(`/merchant/duties?from=${dateStr}&to=${dateStr}`),
        apiFetch(`/merchant/bookings?from=${dateStr}&to=${dateStr}`).catch(() => ({ bookings: [] })),
        apiFetch(`/merchant/closures?from=${dateStr}&to=${dateStr}`).catch(() => ({ closures: [] })),
      ]);
      const closures = cd.closures ?? [];
      const fullDayClosure = closures.find((c: { isFullDay: boolean; title: string }) => c.isFullDay);
      setClosureTitle(fullDayClosure ? fullDayClosure.title : null);
      setStaffList(sd.staff ?? []);
      setDuties(dd.duties ?? []);
      setBookings(
        ((bd.bookings ?? []) as RawBookingRow[]).map(r => ({
          id:          r.booking.id,
          staffId:     r.booking.staffId ?? null,
          clientId:    r.booking.clientId ?? null,
          startTime:   r.booking.startTime,
          endTime:     r.booking.endTime,
          status:      r.booking.status,
          clientName:  r.client?.name ?? null,
          serviceName: r.service?.name ?? null,
          staffName:   r.staffMember?.name ?? null,
          priceSgd:    r.booking.priceSgd ?? null,
        }))
      );
    } finally { setLoading(false); }
  }, [dateStr]);

  const loadRange = useCallback(async (from: string, to: string) => {
    setLoading(true);
    try {
      const [sd, dd, bd, cd] = await Promise.all([
        apiFetch('/merchant/staff'),
        apiFetch(`/merchant/duties?from=${from}&to=${to}`),
        apiFetch(`/merchant/bookings?from=${from}&to=${to}`).catch(() => ({ bookings: [] })),
        apiFetch(`/merchant/closures?from=${from}&to=${to}`).catch(() => ({ closures: [] })),
      ]);
      setStaffList(((sd as any).staff ?? []).filter((s: any) => !s.isAnyAvailable));
      setDuties((dd as any).duties ?? []);
      setBookings(
        (((bd as any).bookings ?? []) as RawBookingRow[]).map(r => ({
          id:          r.booking.id,
          staffId:     r.booking.staffId ?? null,
          clientId:    r.booking.clientId ?? null,
          startTime:   r.booking.startTime,
          endTime:     r.booking.endTime,
          status:      r.booking.status,
          clientName:  r.client?.name ?? null,
          serviceName: r.service?.name ?? null,
          staffName:   r.staffMember?.name ?? null,
          priceSgd:    r.booking.priceSgd ?? null,
        }))
      );
      const closureList = (cd as any).closures ?? [];
      setClosureTitle(closureList.length > 0 ? closureList[0].title : null);
      setAllClosures(closureList);
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadRef.current = load; }, [load]);
  useEffect(() => { load(); }, [load]);

  // Fetch merchant operating hours once — used as the occupancy denominator
  // when a staff has no duty rostered for the day.
  useEffect(() => {
    apiFetch('/merchant/me')
      .then((d: any) => setOperatingHours(d?.merchant?.operatingHours ?? null))
      .catch(() => {});
  }, []);

  // ── Keyboard shortcuts ────────────────────────────────────────────────────────
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      switch (e.key) {
        case 'b': case 'B':
          setEditDuty(null); setDutyError(null);
          setDutyForm({ staffId: '', date: dateStr, startTime: '09:00', endTime: '17:00', notes: '' });
          setShowDutyModal(true);
          break;
        case 'ArrowLeft':  e.preventDefault(); setDate(d => { const n = new Date(d); n.setDate(n.getDate() - 1); return n; }); break;
        case 'ArrowRight': e.preventDefault(); setDate(d => { const n = new Date(d); n.setDate(n.getDate() + 1); return n; }); break;
        case 't': case 'T': setDate(new Date()); break;
        case 'c': case 'C': setDensity(d => d === 'compact' ? 'comfortable' : 'compact'); break;
        case 'Escape':
          setShowDutyModal(false); setSelBooking(null); setDutyError(null);
          break;
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dateStr]);

  // ── Occupancy ─────────────────────────────────────────────────────────────────
  // Denominator preference: staff duty > merchant operating hours for the day >
  // calendar view window (DAY_START_H .. DAY_END_H). Numerator is total booked minutes.
  function denominatorMin(staffId: string): number {
    const d = duties.find(d => d.staffId === staffId);
    if (d) return timeStrToMin(d.endTime) - timeStrToMin(d.startTime);
    if (operatingHours) {
      const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
      const key = dayNames[date.getDay()];
      const oh = key ? operatingHours[key] : undefined;
      if (oh && !oh.closed && oh.open && oh.close) {
        const mins = timeStrToMin(oh.close) - timeStrToMin(oh.open);
        if (mins > 0) return mins;
      }
    }
    return (DAY_END_H - DAY_START_H) * 60;
  }
  function occupancy(staffId: string): { bookedMin: number; denomMin: number; pct: number } {
    const sb = bookings.filter(b => b.staffId === staffId);
    const bookedMin = sb.reduce((acc, b) => acc + isoToLocalMin(b.endTime) - isoToLocalMin(b.startTime), 0);
    const denomMin = denominatorMin(staffId);
    const pct = denomMin > 0 ? clamp(Math.round((bookedMin / denomMin) * 100), 0, 100) : 0;
    return { bookedMin, denomMin, pct };
  }
  function fmtHours(mins: number): string {
    if (mins <= 0) return '0h';
    const h = mins / 60;
    return h >= 1 ? `${h.toFixed(h % 1 === 0 ? 0 : 1)}h` : `${mins}m`;
  }

  // ── Drag ─────────────────────────────────────────────────────────────────────
  function startDrag(e: React.MouseEvent, duty: Duty, type: 'move' | 'resize') {
    e.preventDefault();
    e.stopPropagation();
    dragData.current = { entityType: 'duty', type, duty, startY: e.clientY, origStart: timeStrToMin(duty.startTime), origEnd: timeStrToMin(duty.endTime) };
    dragVizR.current = { entityId: duty.id, entityType: 'duty', staffId: duty.staffId, startMin: timeStrToMin(duty.startTime), endMin: timeStrToMin(duty.endTime) };
    bump(n => n + 1);
  }

  function startBookingDrag(e: React.MouseEvent, booking: Booking, type: 'move' | 'resize') {
    if (booking.status === 'cancelled' || booking.status === 'completed' || booking.status === 'no_show') return;
    e.preventDefault();
    e.stopPropagation();
    const startMin = isoToLocalMin(booking.startTime);
    const endMin   = isoToLocalMin(booking.endTime);
    dragData.current = { entityType: 'booking', type, booking, startY: e.clientY, origStart: startMin, origEnd: endMin };
    dragVizR.current = { entityId: booking.id, entityType: 'booking', staffId: booking.staffId ?? '', startMin, endMin };
    bump(n => n + 1);
  }

  // Stable mouse event listeners (runs once — uses ppmRef for current ppm)
  useEffect(() => {
    function staffAtX(clientX: number): string {
      for (const [staffId, el] of Object.entries(colRefs.current)) {
        if (!el) continue;
        const r = el.getBoundingClientRect();
        if (clientX >= r.left && clientX <= r.right) return staffId;
      }
      return dragVizR.current?.staffId ?? '';
    }

    function onMove(e: MouseEvent) {
      const d = dragData.current;
      if (!d) return;
      const deltaMin = (e.clientY - d.startY) / ppmRef.current;

      if (d.type === 'move') {
        const dur = d.origEnd - d.origStart;
        const newStart = clamp(snap(d.origStart + deltaMin), DAY_START_H * 60, DAY_END_H * 60 - dur);
        // Bookings stay in same column; duties can cross columns
        const newStaffId = d.entityType === 'booking' ? (d.booking.staffId ?? '') : staffAtX(e.clientX);
        const entityId   = d.entityType === 'duty' ? d.duty.id : d.booking.id;
        dragVizR.current = { entityId, entityType: d.entityType, staffId: newStaffId, startMin: newStart, endMin: newStart + dur };
      } else {
        const newEnd = clamp(snap(d.origEnd + deltaMin), d.origStart + SNAP_MIN, DAY_END_H * 60);
        dragVizR.current = { ...dragVizR.current!, endMin: newEnd };
      }
      bump(n => n + 1);
    }

    async function onUp() {
      const d   = dragData.current;
      const viz = dragVizR.current;
      dragData.current = null;
      dragVizR.current = null;
      bump(n => n + 1);
      if (!d || !viz) return;

      let noChange: boolean;
      if (d.entityType === 'booking') {
        noChange = viz.startMin === d.origStart && viz.endMin === d.origEnd;
      } else {
        noChange = viz.startMin === d.origStart && viz.endMin === d.origEnd && viz.staffId === d.duty.staffId;
      }
      if (noChange) return;

      try {
        if (d.entityType === 'booking') {
          const cur = dateRef.current;
          const [y, mo, dd] = cur.split('-').map(Number);
          const newStart = new Date(y, mo - 1, dd, Math.floor(viz.startMin / 60), viz.startMin % 60, 0, 0);
          const newEnd   = new Date(y, mo - 1, dd, Math.floor(viz.endMin / 60),   viz.endMin % 60,   0, 0);
          await apiFetch(`/merchant/bookings/${d.booking.id}/reschedule`, {
            method: 'PATCH',
            body: JSON.stringify({ start_time: newStart.toISOString(), end_time: newEnd.toISOString() }),
          });
        } else {
          const body: Record<string, string> = {
            date:       d.duty.date,        // use duty's own date (fixes stale dateStr)
            start_time: minToStr(viz.startMin),
            end_time:   minToStr(viz.endMin),
          };
          if (viz.staffId !== d.duty.staffId) body.staff_id = viz.staffId;
          await apiFetch(`/merchant/duties/${d.duty.id}`, { method: 'PATCH', body: JSON.stringify(body) });
        }
      } finally {
        await loadRef.current();
      }
    }

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup',   onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup',   onUp);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Reschedule ────────────────────────────────────────────────────────────────
  async function handleReschedule() {
    if (!selBooking || !rescheduleForm.date || !rescheduleForm.time) return;
    setRescheduleSaving(true);
    setRescheduleError(null);
    try {
      const [y, mo, dd] = rescheduleForm.date.split('-').map(Number);
      const [h, m]      = rescheduleForm.time.split(':').map(Number);
      const newStart    = new Date(y, mo - 1, dd, h, m, 0, 0); // local time → UTC via toISOString
      await apiFetch(`/merchant/bookings/${selBooking.id}/reschedule`, {
        method: 'PATCH',
        body: JSON.stringify({ start_time: newStart.toISOString() }),
      });
      setShowReschedule(false);
      setSelBooking(null);
      setClientSnippet(null);
      // Navigate to the new date so the booking is visible
      setDate(newStart);
      await load();
    } catch (err) {
      setRescheduleError(err instanceof Error ? err.message : 'Failed to reschedule');
    } finally {
      setRescheduleSaving(false);
    }
  }

  // ── Client snippet fetch ──────────────────────────────────────────────────────
  async function openBooking(b: Booking) {
    setSelBooking(b);
    setClientSnippet(null);
    setShowReschedule(false);
    setRescheduleError(null);
    if (!b.clientId) return;
    setSnippetLoading(true);
    try {
      const data = await apiFetch(`/merchant/clients/for-client/${b.clientId}`);
      setClientSnippet({
        profileId:     data.profile.id,
        totalVisits:   data.profile.totalVisits,
        totalSpendSgd: data.profile.totalSpendSgd,
        lastVisitAt:   data.profile.lastVisitAt,
        vipTier:       data.profile.vipTier,
        notes:         data.profile.notes,
        marketingOptIn: data.profile.marketingOptIn,
        clientName:    data.client?.name ?? null,
        clientEmail:   data.client?.email ?? null,
        clientPhone:   data.client?.phone ?? '',
        serviceHistory: (data.serviceHistory ?? []) as ServiceHistoryItem[],
      });
    } catch { /* profile may not exist */ }
    finally { setSnippetLoading(false); }
  }

  // ── Booking actions ───────────────────────────────────────────────────────────
  async function bookingAction(id: string, action: 'check-in' | 'no-show') {
    try {
      await apiFetch(`/merchant/bookings/${id}/${action}`, { method: 'PUT' });
      await load();
    } catch { /* stale status — ignore */ }
  }

  // ── Client search ────────────────────────────────────────────────────────────
  function handleSearchInput(q: string) {
    setSearchQuery(q);
    setClientBookings(null);
    setSelectedClient(null);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    if (q.trim().length < 2) { setSearchResults([]); return; }
    setSearchLoading(true);
    searchTimerRef.current = setTimeout(async () => {
      try {
        const data = await apiFetch(`/merchant/clients?search=${encodeURIComponent(q.trim())}&limit=6`);
        setSearchResults(
          (data.clients ?? []).map((r: { profile: { id: string; clientId: string }; client: { name: string | null; phone: string; email: string | null } }) => ({
            id: r.profile.id,
            clientId: r.profile.clientId,
            name: r.client.name,
            phone: r.client.phone,
            email: r.client.email,
          }))
        );
      } catch { setSearchResults([]); }
      finally { setSearchLoading(false); }
    }, 300);
  }

  async function selectSearchClient(clientId: string, name: string | null, phone: string) {
    setSelectedClient({ name: name ?? 'Unknown', phone });
    setSearchResults([]);
    setSearchQuery('');
    try {
      const data = await apiFetch(`/merchant/bookings?client_id=${clientId}`);
      const rows = (data.bookings ?? []).map((r: { booking: { id: string; startTime: string; endTime: string; status: string }; service: { name: string }; staffMember: { name: string } }) => ({
        id: r.booking.id,
        startTime: r.booking.startTime,
        endTime: r.booking.endTime,
        status: r.booking.status,
        serviceName: r.service?.name ?? '',
        staffName: r.staffMember?.name ?? '',
      }));
      // Sort: upcoming first (asc), then past (desc)
      const now = new Date();
      const upcoming = rows.filter((b: { startTime: string }) => new Date(b.startTime) >= now).sort((a: { startTime: string }, b: { startTime: string }) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
      const past = rows.filter((b: { startTime: string }) => new Date(b.startTime) < now).sort((a: { startTime: string }, b: { startTime: string }) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());
      setClientBookings([...upcoming, ...past].slice(0, 20));
    } catch { setClientBookings([]); }
  }

  function jumpToBooking(startTime: string) {
    setDate(new Date(startTime));
    setShowSearch(false);
    setClientBookings(null);
    setSelectedClient(null);
    setSearchQuery('');
  }

  // Close search on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setShowSearch(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // ── Duty CRUD ─────────────────────────────────────────────────────────────────
  function openNewDuty(staffId: string, relYPx: number) {
    if (dragData.current) return;
    const rawMin   = relYPx / ppm + DAY_START_H * 60;
    const startMin = clamp(snap(rawMin), DAY_START_H * 60, (DAY_END_H - 1) * 60);
    setEditDuty(null); setDutyError(null);
    setDutyForm({ staffId, date: dateStr, startTime: minToStr(startMin), endTime: minToStr(Math.min(startMin + 60, DAY_END_H * 60)), notes: '' });
    setShowDutyModal(true);
  }

  async function saveDuty() {
    setDutyError(null); setDutySaving(true);
    try {
      if (editDuty) {
        await apiFetch(`/merchant/duties/${editDuty.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ date: dutyForm.date, start_time: dutyForm.startTime, end_time: dutyForm.endTime, notes: dutyForm.notes }),
        });
      } else {
        await apiFetch('/merchant/duties', {
          method: 'POST',
          body: JSON.stringify({ staff_id: dutyForm.staffId, date: dutyForm.date, start_time: dutyForm.startTime, end_time: dutyForm.endTime, duty_type: 'floor', notes: dutyForm.notes }),
        });
      }
      setShowDutyModal(false);
      await load();
    } catch (err) { setDutyError(err instanceof Error ? err.message : 'Failed to save'); }
    finally { setDutySaving(false); }
  }

  async function deleteDuty() {
    if (!editDuty) return;
    setDutySaving(true);
    try {
      await apiFetch(`/merchant/duties/${editDuty.id}`, { method: 'DELETE' });
      setShowDutyModal(false);
      await load();
    } catch (err) { setDutyError(err instanceof Error ? err.message : 'Failed to delete'); }
    finally { setDutySaving(false); }
  }

  // ── Navigation ────────────────────────────────────────────────────────────────
  function nav(delta: number) {
    setDate(d => { const n = new Date(d); n.setDate(n.getDate() + delta); return n; });
  }

  // ── Off-duty ranges for a staff member ───────────────────────────────────────
  function offDutyRanges(staffId: string): { start: number; end: number }[] {
    const staffDuties = duties
      .filter(d => d.staffId === staffId)
      .sort((a, b) => timeStrToMin(a.startTime) - timeStrToMin(b.startTime));

    if (staffDuties.length === 0) {
      return [{ start: DAY_START_H * 60, end: DAY_END_H * 60 }];
    }

    const ranges: { start: number; end: number }[] = [];
    const first = staffDuties[0]!;
    const last  = staffDuties[staffDuties.length - 1]!;

    if (timeStrToMin(first.startTime) > DAY_START_H * 60)
      ranges.push({ start: DAY_START_H * 60, end: timeStrToMin(first.startTime) });

    for (let i = 0; i < staffDuties.length - 1; i++)
      ranges.push({ start: timeStrToMin(staffDuties[i]!.endTime), end: timeStrToMin(staffDuties[i + 1]!.startTime) });

    if (timeStrToMin(last.endTime) < DAY_END_H * 60)
      ranges.push({ start: timeStrToMin(last.endTime), end: DAY_END_H * 60 });

    return ranges;
  }

  // ── Time labels ───────────────────────────────────────────────────────────────
  const timeLabels: { min: number; label: string }[] = [];
  for (let h = DAY_START_H; h <= DAY_END_H; h++) {
    const label = h === 12 ? '12 PM' : h > 12 ? `${h - 12} PM` : `${h} AM`;
    timeLabels.push({ min: h * 60, label });
  }

  // Now indicator
  const isToday = dateStr === new Date().toISOString().slice(0, 10);
  const nowMin  = isToday ? new Date().getHours() * 60 + new Date().getMinutes() : null;

  // Day stats
  const dayStats = (() => {
    const byStatus = (s: string) => bookings.filter(b => b.status === s).length;
    const revenue  = bookings
      .filter(b => b.status !== 'cancelled')
      .reduce((sum, b) => sum + parseFloat(b.priceSgd ?? '0'), 0);
    return {
      total:      bookings.length,
      confirmed:  byStatus('confirmed'),
      inProgress: byStatus('in_progress'),
      completed:  byStatus('completed'),
      noShow:     byStatus('no_show'),
      cancelled:  byStatus('cancelled'),
      revenue,
    };
  })();

  const dateLabel = date.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const viz = dragVizR.current;

  // ─── FullCalendar events builder ────────────────────────────────────────────
  function buildCalendarEvents(): EventInput[] {
    const fcEvents: EventInput[] = [];

    // Bookings — single ink block, identity via title text.
    bookings.forEach(b => {
      fcEvents.push({
        id: `booking-${b.id}`,
        title: `${b.clientName ?? 'Client'} — ${b.serviceName ?? ''}`,
        start: b.startTime,
        end: b.endTime,
        backgroundColor: b.staffId ? BOOKING_BG : UNASSIGNED_BG,
        borderColor: 'transparent',
        textColor: '#fff',
        extendedProps: { type: 'booking', booking: b },
      });
    });

    // Duties — sage, distinct from bookings without needing a separate hue.
    duties.forEach(d => {
      fcEvents.push({
        id: `duty-${d.id}`,
        title: d.notes ?? 'Duty',
        start: `${d.date}T${d.startTime}`,
        end: `${d.date}T${d.endTime}`,
        backgroundColor: DUTY_BG,
        borderColor: DUTY_BG,
        textColor: '#fff',
        extendedProps: { type: 'duty', duty: d },
      });
    });

    // Closures — semantic-danger tint signals "unavailable".
    allClosures.forEach(cl => {
      if (cl.isFullDay) {
        fcEvents.push({
          id: `closure-${cl.id}`,
          title: `\u{1F6AB} ${cl.title}`,
          start: cl.date,
          allDay: true,
          display: 'background',
          backgroundColor: CLOSURE_BG,
          borderColor: CLOSURE_BORDER,
          extendedProps: { type: 'closure' },
        });
      } else if (cl.startTime && cl.endTime) {
        fcEvents.push({
          id: `closure-${cl.id}`,
          title: `\u{1F6AB} ${cl.title}`,
          start: `${cl.date}T${cl.startTime}`,
          end: `${cl.date}T${cl.endTime}`,
          display: 'background',
          backgroundColor: CLOSURE_BG,
          borderColor: CLOSURE_BORDER,
          extendedProps: { type: 'closure' },
        });
      }
    });

    return fcEvents;
  }

  // ─── Render ────────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-4 font-manrope" style={{ userSelect: 'none' }}>
      {/* Mobile hint — calendar requires a wider screen to use comfortably */}
      <div className="md:hidden rounded-xl border border-semantic-warn/30 bg-semantic-warn/5 px-4 py-3 text-sm text-semantic-warn">
        Calendar works best on a tablet or desktop. Scroll horizontally to navigate the grid.
      </div>

      {/* ── Header ── */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex-shrink-0">
          <h1 className="text-xl font-semibold text-tone-ink">Calendar</h1>
          <p className="text-xs text-grey-45 mt-0.5 hidden lg:block">
            Click empty slot to add block · Drag to move or reassign
            <span className="ml-2 text-grey-30">·</span>
            <span className="ml-2 text-grey-30 font-mono text-[10px]">B</span>
            <span className="ml-0.5 text-grey-45 text-[10px]"> add block</span>
            <span className="ml-2 text-grey-30 font-mono text-[10px]">← →</span>
            <span className="ml-0.5 text-grey-45 text-[10px]"> navigate</span>
            <span className="ml-2 text-grey-30 font-mono text-[10px]">C</span>
            <span className="ml-0.5 text-grey-45 text-[10px]"> density</span>
          </p>
        </div>

        {/* ── Client search ── */}
        <div ref={searchRef} className="relative flex-1 max-w-xs">
          <div className="relative">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-grey-45 pointer-events-none" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
            </svg>
            <input
              type="text"
              value={searchQuery}
              onChange={e => { handleSearchInput(e.target.value); setShowSearch(true); }}
              onFocus={() => setShowSearch(true)}
              placeholder="Search client…"
              className="w-full pl-9 pr-3 py-2 border border-grey-15 rounded-lg text-sm text-tone-ink placeholder-grey-45 focus:outline-none focus:ring-1 focus:ring-tone-ink/30 transition bg-tone-surface"
            />
            {searchQuery && (
              <button onClick={() => { setSearchQuery(''); setSearchResults([]); setClientBookings(null); setSelectedClient(null); }} className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-grey-45 hover:text-grey-75">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
              </button>
            )}
          </div>

          {/* Search dropdown */}
          {showSearch && (searchResults.length > 0 || clientBookings || searchLoading) && (
            <div className="absolute top-full mt-1 left-0 right-0 bg-tone-surface border border-grey-15 rounded-xl shadow-xl z-50 overflow-hidden max-h-96 overflow-y-auto">
              {/* Client autocomplete results */}
              {searchResults.length > 0 && !clientBookings && (
                <div>
                  <p className="px-3 py-2 text-[10px] font-semibold text-grey-45 uppercase tracking-wide border-b border-grey-5">Clients</p>
                  {searchResults.map(r => (
                    <button
                      key={r.id}
                      onClick={() => selectSearchClient(r.clientId, r.name, r.phone)}
                      className="w-full px-3 py-2.5 text-left hover:bg-grey-5 transition-colors flex items-center justify-between gap-2"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-tone-ink truncate">{r.name ?? 'Unknown'}</p>
                        <p className="text-xs text-grey-45">{r.phone}</p>
                      </div>
                      {r.email && <span className="text-[10px] text-grey-45 flex-shrink-0 truncate max-w-[120px]">{r.email}</span>}
                    </button>
                  ))}
                </div>
              )}

              {/* Loading */}
              {searchLoading && searchResults.length === 0 && (
                <div className="px-4 py-6 text-center">
                  <div className="w-5 h-5 border-2 border-grey-15 border-t-gray-500 rounded-full animate-spin mx-auto" />
                </div>
              )}

              {/* Client booking results */}
              {clientBookings && selectedClient && (
                <div>
                  <div className="px-3 py-2.5 bg-grey-5 border-b border-grey-5 flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold text-tone-ink">{selectedClient.name}</p>
                      <p className="text-[11px] text-grey-45">{selectedClient.phone}</p>
                    </div>
                    <button onClick={() => { setClientBookings(null); setSelectedClient(null); }} className="text-xs text-grey-45 hover:text-grey-75">Clear</button>
                  </div>
                  {clientBookings.length === 0 ? (
                    <p className="px-4 py-4 text-sm text-grey-45 text-center">No bookings found</p>
                  ) : (
                    clientBookings.map(b => {
                      const d = new Date(b.startTime);
                      const isPast = d < new Date();
                      return (
                        <button
                          key={b.id}
                          onClick={() => jumpToBooking(b.startTime)}
                          className="w-full px-3 py-2.5 text-left hover:bg-grey-5 transition-colors border-b border-grey-5 last:border-0 flex items-center gap-3"
                        >
                          <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${isPast ? 'bg-grey-30' : 'bg-tone-sage'}`} />
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-medium text-grey-90 truncate">{b.serviceName}</p>
                            <p className="text-[11px] text-grey-45">
                              {d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}
                              {' · '}
                              {d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              {' · '}
                              {b.staffName}
                            </p>
                          </div>
                          <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full capitalize flex-shrink-0 ${
                            b.status === 'confirmed' ? 'bg-tone-sage/5 text-tone-sage'
                            : b.status === 'completed' ? 'bg-grey-15 text-grey-60'
                            : b.status === 'in_progress' ? 'bg-grey-5 text-tone-ink'
                            : b.status === 'no_show' ? 'bg-semantic-warn/5 text-semantic-warn'
                            : 'bg-semantic-danger/5 text-semantic-danger'
                          }`}>{b.status.replace('_', ' ')}</span>
                        </button>
                      );
                    })
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {/* View mode toggle */}
          <div className="flex rounded-lg border border-grey-15 overflow-hidden">
            {(['month', 'week', 'day'] as const).map(mode => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                  viewMode === mode
                    ? 'bg-[#1a2313] text-white'
                    : 'bg-tone-surface text-grey-75 hover:bg-grey-5'
                }`}
              >
                {mode.charAt(0).toUpperCase() + mode.slice(1)}
              </button>
            ))}
          </div>
          {/* Density toggle */}
          <button
            onClick={() => setDensity(d => d === 'compact' ? 'comfortable' : 'compact')}
            title="Toggle compact/comfortable view (C)"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-grey-15 text-xs text-grey-75 hover:bg-grey-5 transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              {density === 'comfortable'
                ? <path strokeLinecap="round" strokeLinejoin="round" d="M3 7h18M3 12h18M3 17h18" />
                : <path strokeLinecap="round" strokeLinejoin="round" d="M3 6h18M3 10h18M3 14h18M3 18h18" />
              }
            </svg>
            {density === 'comfortable' ? 'Comfortable' : 'Compact'}
          </button>
          <button
            onClick={() => {
              setEditDuty(null); setDutyError(null);
              setDutyForm({ staffId: staffList[0]?.id ?? '', date: dateStr, startTime: '09:00', endTime: '17:00', notes: '' });
              setShowDutyModal(true);
            }}
            className="px-4 py-2 bg-[#1a2313] text-white text-sm font-medium rounded-lg hover:bg-[#2f3827] transition-colors"
          >
            + Add Block
          </button>
        </div>
      </div>

      {viewMode === 'day' ? (
      <>
      {/* ── Date navigation ── */}
      <div className="flex items-center gap-2">
        <button onClick={() => nav(-1)} className="p-1.5 rounded-lg border border-grey-15 text-grey-60 hover:bg-grey-5 transition-colors">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
        </button>
        <span className="text-sm font-semibold text-grey-90 min-w-64 text-center">{dateLabel}</span>
        <button onClick={() => nav(1)} className="p-1.5 rounded-lg border border-grey-15 text-grey-60 hover:bg-grey-5 transition-colors">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
        </button>
        <button onClick={() => setDate(new Date())} className="text-xs px-3 py-1.5 rounded-lg border border-grey-15 text-grey-75 hover:bg-grey-5 transition-colors">
          Today
        </button>
        {loading && <span className="text-xs text-grey-45 animate-pulse ml-2">Loading…</span>}
      </div>

      {/* ── Closure banner ── */}
      {closureTitle && (
        <div className="rounded-xl border border-semantic-danger/30 bg-semantic-danger/5 px-4 py-3 flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-semantic-danger/10 flex items-center justify-center flex-shrink-0">
            <svg className="w-4 h-4 text-semantic-danger" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
          <div>
            <p className="text-sm font-semibold text-semantic-danger">Closed — {closureTitle}</p>
            <p className="text-xs text-semantic-danger mt-0.5">Online bookings are blocked for this date. <a href="/dashboard/settings?tab=closures" className="underline hover:text-semantic-danger">Manage closures</a></p>
          </div>
        </div>
      )}

      {/* ── Resource grid ── */}
      <div className="bg-tone-surface rounded-xl border border-grey-15 overflow-hidden flex flex-col">

        {/* Staff column headers */}
        <div className="flex border-b border-grey-5 bg-tone-surface z-20 shrink-0">
          <div className="w-16 shrink-0 border-r border-grey-15" />
          {staffList.map((s, i) => {
            const { bookedMin, denomMin, pct } = occupancy(s.id);
            const avatarBg = AVATAR_GREYS[i % AVATAR_GREYS.length]!;
            const dutyRostered = duties.some(d => d.staffId === s.id);
            return (
              <div key={s.id} className="flex-1 min-w-[160px] border-r border-grey-5 last:border-r-0 px-3 py-3">
                <div className="flex items-center gap-2">
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold text-white shrink-0 shadow-sm"
                    style={{ backgroundColor: avatarBg }}
                  >
                    {s.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-tone-ink truncate">{s.name}</div>
                    <div className="flex items-center gap-1.5 mt-1">
                      <div className="h-1 w-14 rounded-full bg-grey-15 overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all duration-500"
                          style={{
                            width: `${pct}%`,
                            backgroundColor:
                              pct > 80
                                ? 'var(--color-semantic-danger)'
                                : pct > 50
                                  ? 'var(--color-semantic-warn)'
                                  : 'var(--color-tone-sage)',
                          }}
                        />
                      </div>
                      <span
                        className="text-[10px] text-grey-45 tabular-nums"
                        title={dutyRostered ? 'Booked vs rostered duty hours' : 'Booked vs salon operating hours (no duty rostered)'}
                      >
                        {fmtHours(bookedMin)} / {fmtHours(denomMin)} · {pct}%
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Scrollable grid body */}
        <div className="overflow-y-auto overflow-x-auto flex-1" style={{ maxHeight: 'calc(100vh - 300px)' }}>
          <div className="flex" style={{ minHeight: totalPx }}>

            {/* Time gutter */}
            <div className="w-16 shrink-0 border-r border-grey-15 relative bg-tone-surface sticky left-0 z-10" style={{ height: totalPx }}>
              {timeLabels.map(({ min, label }) => (
                <div key={min} className="absolute right-2 left-0 flex items-center justify-end pr-2" style={{ top: topPx(min) - 9 }}>
                  <span className="text-[11px] text-grey-60 font-semibold whitespace-nowrap">{label}</span>
                </div>
              ))}
              {/* 30-min marks in gutter */}
              {timeLabels.slice(0, -1).map(({ min }) => (
                <div key={`${min}half`} className="absolute right-2 left-0 flex items-center justify-end pr-2" style={{ top: topPx(min + 30) - 7 }}>
                  <span className="text-[9px] text-grey-45 whitespace-nowrap">:30</span>
                </div>
              ))}
            </div>

            {/* Staff columns */}
            {staffList.map((s, colIdx) => {
              const color       = BOOKING_BG;
              void colIdx;
              const staffDuties = duties.filter(d => d.staffId === s.id);
              const staffBooks  = bookings.filter(b => b.staffId === s.id);
              const offRanges   = offDutyRanges(s.id);
              const ghostHere   = viz && viz.entityType === 'duty' && viz.staffId === s.id && !staffDuties.find(d => d.id === viz.entityId);

              return (
                <div
                  key={s.id}
                  ref={el => { colRefs.current[s.id] = el; }}
                  className="flex-1 min-w-[160px] border-r border-grey-5 last:border-r-0 relative cursor-cell"
                  style={{ height: totalPx }}
                  onClick={e => {
                    const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
                    openNewDuty(s.id, e.clientY - rect.top);
                  }}
                >
                  {/* Hour lines — solid, clearly visible */}
                  {timeLabels.map(({ min }) => (
                    <div key={min} className="absolute inset-x-0 border-t border-grey-30" style={{ top: topPx(min) }} />
                  ))}
                  {/* 30-min sub-lines — dashed, lighter than hour lines */}
                  {timeLabels.slice(0, -1).map(({ min }) => (
                    <div key={`${min}h`} className="absolute inset-x-0 border-t border-dashed border-grey-15" style={{ top: topPx(min + 30) }} />
                  ))}

                  {/* Off-duty hatching */}
                  {offRanges.map((r, i) => (
                    <div
                      key={i}
                      className="absolute inset-x-0 pointer-events-none"
                      style={{
                        top:    topPx(r.start),
                        height: heightPx(r.start, r.end),
                        background: 'repeating-linear-gradient(45deg, transparent, transparent 5px, rgba(0,0,0,0.018) 5px, rgba(0,0,0,0.018) 10px)',
                        backgroundColor: 'rgba(248,250,252,0.7)',
                      }}
                    />
                  ))}

                  {/* Now indicator */}
                  {nowMin && nowMin >= DAY_START_H * 60 && nowMin <= DAY_END_H * 60 && (
                    <div className="absolute inset-x-0 z-30 pointer-events-none" style={{ top: topPx(nowMin) }}>
                      <div className="relative h-0.5 bg-semantic-danger">
                        {colIdx === 0 && (
                          <div className="absolute left-0 top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full bg-semantic-danger shadow-sm" style={{ marginLeft: -5 }} />
                        )}
                      </div>
                    </div>
                  )}

                  {/* Duty blocks */}
                  {staffDuties.map(duty => {
                    const isDragging = viz?.entityId === duty.id && viz?.entityType === 'duty';
                    if (isDragging && viz && viz.staffId !== s.id) return null;
                    const sm = isDragging && viz ? viz.startMin : timeStrToMin(duty.startTime);
                    const em = isDragging && viz ? viz.endMin   : timeStrToMin(duty.endTime);

                    return (
                      <div
                        key={duty.id}
                        className={`absolute left-1.5 right-1.5 rounded-md overflow-hidden z-10 ${isDragging ? 'opacity-70 shadow-xl cursor-grabbing' : 'cursor-grab hover:brightness-110 transition-all'}`}
                        style={{ top: topPx(sm), height: heightPx(sm, em), backgroundColor: DUTY_BG }}
                        onMouseDown={e => startDrag(e, duty, 'move')}
                        onClick={e => {
                          e.stopPropagation();
                          setEditDuty(duty);
                          setDutyForm({ staffId: duty.staffId, date: duty.date, startTime: duty.startTime.slice(0, 5), endTime: duty.endTime.slice(0, 5), notes: duty.notes ?? '' });
                          setDutyError(null);
                          setShowDutyModal(true);
                        }}
                      >
                        <div className="px-2 pt-1.5 pb-4 h-full flex flex-col pointer-events-none">
                          <span className="text-[10px] text-white/60 font-mono">{minToStr(sm)}–{minToStr(em)}</span>
                          {duty.notes && <span className="text-[11px] text-white/90 mt-0.5 truncate">{duty.notes}</span>}
                          {heightPx(sm, em) >= 48 && (
                            <span className="text-[10px] text-white/30 mt-auto">On duty</span>
                          )}
                        </div>
                        <div
                          className="absolute bottom-0 inset-x-0 h-3 cursor-s-resize flex items-center justify-center pointer-events-auto"
                          onMouseDown={e => { e.stopPropagation(); startDrag(e, duty, 'resize'); }}
                        >
                          <div className="w-6 h-px bg-tone-surface/30 hover:bg-tone-surface/60 transition-colors" />
                        </div>
                      </div>
                    );
                  })}

                  {/* Cross-column drag ghost */}
                  {ghostHere && viz && (
                    <div
                      className="absolute left-1.5 right-1.5 rounded-md pointer-events-none z-10 opacity-50 border-2 border-dashed border-white/40"
                      style={{ top: topPx(viz.startMin), height: heightPx(viz.startMin, viz.endMin), backgroundColor: DUTY_BG }}
                    />
                  )}

                  {/* Booking events */}
                  {staffBooks.map(b => {
                    const isDraggingBooking = viz?.entityId === b.id && viz?.entityType === 'booking';
                    const sm   = isDraggingBooking && viz ? viz.startMin : isoToLocalMin(b.startTime);
                    const em   = isDraggingBooking && viz ? viz.endMin   : isoToLocalMin(b.endTime);
                    const visS = Math.max(sm, DAY_START_H * 60);
                    const visE = Math.min(em, DAY_END_H * 60);
                    if (visE <= visS) return null;
                    const h    = heightPx(visS, visE);
                    const meta = STATUS_META[b.status];
                    const canCheckIn      = b.status === 'confirmed';
                    const canCheckoutNow  = b.status === 'confirmed';
                    const canComplete     = b.status === 'in_progress';
                    const canNoShow       = b.status === 'confirmed' || b.status === 'in_progress';
                    const isDraggable = b.status === 'confirmed' || b.status === 'in_progress';

                    return (
                      <div
                        key={b.id}
                        className={`absolute z-10 rounded-md overflow-hidden hover:z-20 hover:shadow-md transition-shadow group/card ${isDraggingBooking ? 'opacity-70 shadow-xl cursor-grabbing z-20' : isDraggable ? 'cursor-grab' : 'cursor-pointer'}`}
                        style={{
                          top:    topPx(visS),
                          height: h,
                          left:   6,
                          right:  6,
                          backgroundColor: `${color}18`,
                          borderLeft: `3px solid ${color}`,
                        }}
                        onMouseDown={isDraggable ? e => startBookingDrag(e, b, 'move') : undefined}
                        onClick={e => { e.stopPropagation(); openBooking(b); }}
                        onDoubleClick={() => setEditBookingId(b.id)}
                      >
                        {/* Quick action buttons — stop propagation so mousedown drag doesn't trigger */}
                        <div
                          className="absolute top-1 right-1 hidden group-hover/card:flex items-center gap-0.5 z-20"
                          onMouseDown={e => e.stopPropagation()}
                        >
                          {canCheckIn && (
                            <button
                              title="Check In"
                              className="w-5 h-5 rounded flex items-center justify-center bg-grey-75 hover:bg-tone-ink text-white transition-colors"
                              onClick={e => { e.stopPropagation(); bookingAction(b.id, 'check-in'); }}
                            >
                              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4" /></svg>
                            </button>
                          )}
                          {canCheckoutNow && (
                            <button
                              title="Checkout Now (take payment, optionally redeem points, mark complete)"
                              className="w-5 h-5 rounded flex items-center justify-center bg-tone-sage/30 hover:bg-tone-sage/50 text-tone-ink border border-tone-sage/50 transition-colors"
                              onClick={e => { e.stopPropagation(); setCheckoutBookingId(b.id); }}
                            >
                              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M2.25 3h1.386c.51 0 .955.343 1.087.835l.383 1.437M7.5 14.25a3 3 0 0 0-3 3h15.75m-12.75-3h11.218c1.121-2.3 2.1-4.684 2.924-7.138a60.114 60.114 0 0 0-16.536-1.84M7.5 14.25 5.106 5.272M6 20.25a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Zm12.75 0a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Z" /></svg>
                            </button>
                          )}
                          {canComplete && (
                            <button
                              title="Complete (take payment, optionally redeem points, mark complete)"
                              className="w-5 h-5 rounded flex items-center justify-center bg-tone-sage hover:bg-tone-sage text-white transition-colors"
                              onClick={e => { e.stopPropagation(); setCheckoutBookingId(b.id); }}
                            >
                              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" /></svg>
                            </button>
                          )}
                          {canNoShow && (
                            <button
                              title="No Show"
                              className="w-5 h-5 rounded flex items-center justify-center bg-semantic-warn hover:opacity-90 text-white transition-colors"
                              onClick={e => { e.stopPropagation(); bookingAction(b.id, 'no-show'); }}
                            >
                              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                            </button>
                          )}
                        </div>

                        <div className="px-2 py-1 pr-1 overflow-hidden" style={{ maxHeight: h - 4 }}>
                          <div className="text-[11px] font-semibold text-tone-ink truncate leading-tight">{b.clientName ?? 'Client'}</div>
                          <div className="text-[10px] text-grey-60 truncate mt-0.5">{b.serviceName}</div>
                          <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                            {meta && (
                              <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-sm whitespace-nowrap ${meta.cls}`}>
                                {meta.label}
                              </span>
                            )}
                            {b.priceSgd && (
                              <span className="text-[9px] font-medium text-grey-45 whitespace-nowrap">
                                ${parseFloat(b.priceSgd).toFixed(0)}
                              </span>
                            )}
                          </div>
                        </div>
                        {/* Hover tooltip with full details */}
                        <div className="hidden group-hover/card:block absolute left-0 right-0 bg-tone-surface border border-grey-15 rounded-lg shadow-lg z-30 p-2.5 pointer-events-none" style={{ top: h + 2 }}>
                          <div className="text-[11px] font-semibold text-tone-ink">{b.clientName ?? 'Client'}</div>
                          <div className="text-[10px] text-grey-60 mt-0.5">{b.serviceName}</div>
                          <div className="text-[10px] text-grey-45 mt-0.5">
                            {new Date(b.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            {' – '}
                            {new Date(b.endTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </div>
                          <div className="flex items-center gap-1.5 mt-1">
                            {meta && (
                              <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-sm ${meta.cls}`}>
                                {meta.label}
                              </span>
                            )}
                            {b.priceSgd && (
                              <span className="text-[10px] font-medium text-grey-60">
                                SGD {parseFloat(b.priceSgd).toFixed(2)}
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Resize handle (confirmed/in_progress only) */}
                        {isDraggable && (
                          <div
                            className="absolute bottom-0 inset-x-0 h-3 cursor-s-resize flex items-center justify-center pointer-events-auto"
                            onMouseDown={e => { e.stopPropagation(); startBookingDrag(e, b, 'resize'); }}
                          >
                            <div className="w-6 h-px opacity-30 hover:opacity-60 transition-opacity" style={{ backgroundColor: color }} />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>

        {/* Status bar */}
        <div className="border-t border-grey-5 bg-grey-5/40 shrink-0">
          <div className="flex items-center gap-0 divide-x divide-grey-5 px-1 py-2">
            <div className="flex flex-col items-center px-4">
              <span className="text-base font-bold text-tone-ink tabular-nums leading-none">{dayStats.total}</span>
              <span className="text-[10px] text-grey-45 mt-0.5">Bookings</span>
            </div>
            {dayStats.confirmed > 0 && (
              <div className="flex flex-col items-center px-4">
                <span className="text-base font-bold text-tone-sage tabular-nums leading-none">{dayStats.confirmed}</span>
                <span className="text-[10px] text-grey-45 mt-0.5">Confirmed</span>
              </div>
            )}
            {dayStats.inProgress > 0 && (
              <div className="flex flex-col items-center px-4">
                <span className="text-base font-bold text-tone-ink tabular-nums leading-none">{dayStats.inProgress}</span>
                <span className="text-[10px] text-grey-45 mt-0.5">In Progress</span>
              </div>
            )}
            {dayStats.completed > 0 && (
              <div className="flex flex-col items-center px-4">
                <span className="text-base font-bold text-grey-75 tabular-nums leading-none">{dayStats.completed}</span>
                <span className="text-[10px] text-grey-45 mt-0.5">Completed</span>
              </div>
            )}
            {dayStats.noShow > 0 && (
              <div className="flex flex-col items-center px-4">
                <span className="text-base font-bold text-semantic-warn tabular-nums leading-none">{dayStats.noShow}</span>
                <span className="text-[10px] text-grey-45 mt-0.5">No Show</span>
              </div>
            )}
            {dayStats.cancelled > 0 && (
              <div className="flex flex-col items-center px-4">
                <span className="text-base font-bold text-semantic-danger tabular-nums leading-none">{dayStats.cancelled}</span>
                <span className="text-[10px] text-grey-45 mt-0.5">Cancelled</span>
              </div>
            )}
            <div className="flex flex-col items-center px-4">
              <span className="text-base font-bold text-[#1a2313] tabular-nums leading-none">
                ${dayStats.revenue.toFixed(0)}
              </span>
              <span className="text-[10px] text-grey-45 mt-0.5">Est. Revenue</span>
            </div>
            {/* Legend */}
            <div className="flex items-center gap-3 pl-4 pr-4 ml-auto border-l-0">
              <span className="flex items-center gap-1.5 text-[10px] text-grey-45">
                <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: DUTY_BG }} />
                Duty
              </span>
              <span className="flex items-center gap-1.5 text-[10px] text-grey-45">
                <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: BOOKING_BG }} />
                Booking
              </span>
            </div>
          </div>
        </div>
      </div>
      </>
      ) : (
      <div className="bg-tone-surface rounded-xl border border-grey-15 p-4">
        <style>{`
          .fc { font-family: var(--font-body, 'Manrope', sans-serif); }
          .fc .fc-toolbar-title { font-size: 16px; font-weight: 600; color: var(--color-tone-ink); }
          .fc .fc-button { font-size: 12px; font-weight: 500; padding: 4px 10px; }
          .fc .fc-button-primary { background-color: var(--color-tone-ink); border-color: var(--color-tone-ink); }
          .fc .fc-button-primary:hover { background-color: var(--color-tone-ink); border-color: var(--color-tone-ink); opacity: 0.9; }
          .fc .fc-button-primary:not(:disabled).fc-button-active { background-color: var(--color-tone-ink); border-color: var(--color-tone-ink); }
          .fc .fc-col-header-cell-cushion { font-size: 11px; font-weight: 600; color: var(--color-grey-75); text-transform: uppercase; letter-spacing: 0.05em; }
          .fc .fc-daygrid-day-number { font-size: 13px; font-weight: 500; color: var(--color-grey-75); }
          .fc .fc-timegrid-slot { border-bottom-color: var(--color-grey-15); }
          .fc .fc-timegrid-slot-minor { border-top: 1px dashed var(--color-grey-5) !important; }
          .fc .fc-timegrid-slot-label { font-size: 11px; font-weight: 600; color: var(--color-grey-60); }
          .fc .fc-event { border-radius: 4px; font-size: 11px; }
          .fc .fc-daygrid-event { padding: 1px 4px; }
          .fc td, .fc th { border-color: var(--color-grey-15); }
          .fc .fc-scrollgrid { border-color: var(--color-grey-15); }
        `}</style>
        <FullCalendar
          key={viewMode}
          plugins={[timeGridPlugin, dayGridPlugin, interactionPlugin]}
          initialView={viewMode === 'week' ? 'timeGridWeek' : 'dayGridMonth'}
          initialDate={date}
          headerToolbar={{ left: 'prev,next today', center: 'title', right: '' }}
          events={buildCalendarEvents()}
          editable={viewMode === 'week'}
          eventStartEditable={true}
          eventDurationEditable={false}
          snapDuration="00:15:00"
          eventDrop={async (info: EventDropArg) => {
            if (info.event.extendedProps.type !== 'booking') {
              info.revert();
              return;
            }
            const booking = info.event.extendedProps.booking as Booking;
            const newStart: Date | null = info.event.start;
            if (!newStart) {
              info.revert();
              return;
            }
            const newEnd: Date = info.event.end ?? new Date(newStart.getTime() + (new Date(booking.endTime).getTime() - new Date(booking.startTime).getTime()));
            try {
              await apiFetch(`/merchant/bookings/${booking.id}/reschedule`, {
                method: 'PATCH',
                body: JSON.stringify({
                  start_time: newStart.toISOString(),
                  end_time: newEnd.toISOString(),
                }),
              });
              // Refresh the visible window so the booking is re-fetched and the
              // calendar re-renders authoritatively (defensive — FullCalendar
              // already moved the event optimistically).
              if (fcRange) {
                void loadRange(fcRange.start, fcRange.end);
              }
            } catch (err) {
              info.revert();
              alert(err instanceof Error ? err.message : 'Could not reschedule. Try again.');
            }
          }}
          height="auto"
          slotMinTime={calendarRange.slotMinTime}
          slotMaxTime={calendarRange.slotMaxTime}
          eventClick={(info: EventClickArg) => {
            if (info.event.extendedProps.type === 'booking') {
              const b = info.event.extendedProps.booking as Booking;
              openBooking(b);
            }
          }}
          datesSet={(info: DatesSetArg) => {
            const from = info.startStr.slice(0, 10);
            const to = info.endStr.slice(0, 10);
            setFcRange({ start: from, end: to });
            loadRange(from, to);
          }}
        />
      </div>
      )}

      {/* ── Duty modal ── */}
      {showDutyModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-tone-surface rounded-xl shadow-2xl w-full max-w-md p-6 space-y-4 font-manrope">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-tone-ink">{editDuty ? 'Edit Schedule Block' : 'New Schedule Block'}</h2>
              <button onClick={() => setShowDutyModal(false)} className="text-grey-45 hover:text-grey-75 transition-colors">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>

            {!editDuty && (
              <div>
                <label className="block text-xs font-medium text-grey-75 mb-1">Staff Member</label>
                <select
                  value={dutyForm.staffId}
                  onChange={e => setDutyForm(f => ({ ...f, staffId: e.target.value }))}
                  className="w-full border border-grey-15 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-tone-ink/30"
                >
                  {staffList.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-grey-75 mb-1">Date</label>
              <input
                type="date"
                value={dutyForm.date}
                onChange={e => setDutyForm(f => ({ ...f, date: e.target.value }))}
                className="w-full border border-grey-15 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-tone-ink/30"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-grey-75 mb-1">Start</label>
                <input
                  type="time"
                  value={dutyForm.startTime}
                  onChange={e => setDutyForm(f => ({ ...f, startTime: e.target.value }))}
                  className="w-full border border-grey-15 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-tone-ink/30"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-grey-75 mb-1">End</label>
                <input
                  type="time"
                  value={dutyForm.endTime}
                  onChange={e => setDutyForm(f => ({ ...f, endTime: e.target.value }))}
                  className="w-full border border-grey-15 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-tone-ink/30"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-grey-75 mb-1">Notes (optional)</label>
              <input
                type="text"
                value={dutyForm.notes}
                onChange={e => setDutyForm(f => ({ ...f, notes: e.target.value }))}
                placeholder="e.g. Front desk, Facial room"
                className="w-full border border-grey-15 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-tone-ink/30"
              />
            </div>

            {dutyError && <p className="text-xs text-semantic-danger">{dutyError}</p>}

            <div className="flex gap-2 pt-1">
              <button
                onClick={saveDuty}
                disabled={dutySaving}
                className="flex-1 py-2 bg-[#1a2313] text-white text-sm font-medium rounded-lg hover:bg-[#2f3827] disabled:opacity-50 transition-colors"
              >
                {dutySaving ? 'Saving…' : 'Save'}
              </button>
              {editDuty && (
                <button
                  onClick={deleteDuty}
                  disabled={dutySaving}
                  className="py-2 px-4 bg-semantic-danger/5 text-semantic-danger text-sm font-medium rounded-lg hover:bg-semantic-danger/10 disabled:opacity-50 transition-colors"
                >
                  Delete
                </button>
              )}
              <button
                onClick={() => { setShowDutyModal(false); setDutyError(null); }}
                className="py-2 px-4 bg-grey-15 text-grey-75 text-sm font-medium rounded-lg hover:bg-grey-15 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Booking detail — right-side drawer ── */}
      {selBooking && (
        <div className="fixed inset-0 z-50 flex">
          {/* Backdrop */}
          <div className="flex-1 bg-black/30" onClick={() => { setSelBooking(null); setClientSnippet(null); setShowReschedule(false); setRescheduleError(null); }} />
          {/* Panel */}
          <div className="w-full max-w-sm bg-tone-surface shadow-2xl flex flex-col font-manrope overflow-hidden">

            {/* Header */}
            <div className="px-5 py-4 border-b border-grey-5 flex items-start justify-between shrink-0">
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="text-sm font-semibold text-tone-ink">{selBooking.clientName ?? 'Client'}</h2>
                  {STATUS_META[selBooking.status] && (
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-md ${STATUS_META[selBooking.status]!.cls}`}>
                      {STATUS_META[selBooking.status]!.label}
                    </span>
                  )}
                </div>
                <p className="text-xs text-grey-45 mt-0.5">{selBooking.serviceName}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {selBooking.priceSgd && (
                  <span className="text-sm font-semibold text-[#1a2313]">${parseFloat(selBooking.priceSgd).toFixed(2)}</span>
                )}
                <button onClick={() => { setSelBooking(null); setClientSnippet(null); setShowReschedule(false); setRescheduleError(null); }} className="p-1 rounded-lg text-grey-45 hover:text-grey-75 hover:bg-grey-15 transition-colors">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto">
              {/* Booking info */}
              <div className="px-5 py-4 space-y-2.5">
                {[
                  ['Staff',  selBooking.staffName ?? '—'],
                  ['Date',   new Date(selBooking.startTime).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })],
                  ['Start',  new Date(selBooking.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })],
                  ['End',    new Date(selBooking.endTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })],
                ].map(([label, value]) => (
                  <div key={label} className="flex items-center justify-between">
                    <span className="text-[11px] font-medium text-grey-45 uppercase tracking-wide">{label}</span>
                    <span className="text-sm font-medium text-grey-90">{value}</span>
                  </div>
                ))}
              </div>

              {/* Client profile snippet */}
              <div className="px-5 pb-4">
                <div className="border-t border-grey-5 pt-4">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-xs font-semibold text-grey-60 uppercase tracking-wide">Client Profile</h3>
                    {clientSnippet && (
                      <Link
                        href={`/dashboard/clients/${clientSnippet.profileId}`}
                        className="text-[11px] text-[#1a2313] font-medium hover:underline"
                      >
                        View Full Profile →
                      </Link>
                    )}
                  </div>

                  {snippetLoading && (
                    <div className="flex justify-center py-4">
                      <div className="w-5 h-5 border-2 border-grey-15 border-t-gray-500 rounded-full animate-spin" />
                    </div>
                  )}

                  {!snippetLoading && clientSnippet && (
                    <div className="space-y-3">
                      {/* Contact info */}
                      <div className="space-y-1.5">
                        {clientSnippet.clientName && (
                          <p className="text-sm font-semibold text-tone-ink">{clientSnippet.clientName}</p>
                        )}
                        <div className="flex flex-wrap gap-x-4 gap-y-1">
                          {clientSnippet.clientPhone && (
                            <span className="text-xs text-grey-60">{clientSnippet.clientPhone}</span>
                          )}
                          {clientSnippet.clientEmail && (
                            <span className="text-xs text-grey-60">{clientSnippet.clientEmail}</span>
                          )}
                        </div>
                      </div>

                      {/* Client notes — shown prominently before stats */}
                      {clientSnippet.notes && (
                        <div className="bg-semantic-warn/5 border border-semantic-warn/30 rounded-lg px-3 py-2.5">
                          <p className="text-[10px] font-semibold text-semantic-warn uppercase tracking-wide mb-1">Client Notes</p>
                          <p className="text-xs text-semantic-warn leading-relaxed">{clientSnippet.notes}</p>
                        </div>
                      )}

                      {/* Stats row */}
                      <div className="grid grid-cols-3 gap-2">
                        <div className="bg-grey-5 rounded-lg p-2.5 text-center">
                          <p className="text-base font-bold text-tone-ink">{clientSnippet.totalVisits}</p>
                          <p className="text-[10px] text-grey-45">Visits</p>
                        </div>
                        <div className="bg-grey-5 rounded-lg p-2.5 text-center">
                          <p className="text-base font-bold text-tone-ink">${parseFloat(clientSnippet.totalSpendSgd).toFixed(0)}</p>
                          <p className="text-[10px] text-grey-45">Revenue</p>
                        </div>
                        <div className="bg-grey-5 rounded-lg p-2.5 text-center">
                          <p className="text-[11px] font-semibold text-tone-ink leading-tight">
                            {clientSnippet.lastVisitAt ? new Date(clientSnippet.lastVisitAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '—'}
                          </p>
                          <p className="text-[10px] text-grey-45">Last Visit</p>
                        </div>
                      </div>

                      {/* VIP + Marketing badges */}
                      <div className="flex items-center gap-2 flex-wrap">
                        {clientSnippet.vipTier && (
                          <span className="inline-flex items-center gap-1.5 text-xs text-grey-75 bg-grey-5 border border-grey-15 rounded-full px-2.5 py-0.5 capitalize">
                            <span className="w-1.5 h-1.5 rounded-full bg-grey-45" />
                            {clientSnippet.vipTier}
                          </span>
                        )}
                        <span className={`inline-flex items-center gap-1.5 text-xs rounded-full px-2.5 py-0.5 ${
                          clientSnippet.marketingOptIn
                            ? 'bg-tone-sage/5 text-tone-sage border border-tone-sage/30'
                            : 'bg-grey-15 text-grey-60 border border-grey-15'
                        }`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${clientSnippet.marketingOptIn ? 'bg-tone-sage' : 'bg-grey-30'}`} />
                          {clientSnippet.marketingOptIn ? 'Marketing OK' : 'No marketing'}
                        </span>
                      </div>

                      {/* Service history */}
                      {clientSnippet.serviceHistory.length > 0 && (
                        <div>
                          <h4 className="text-[10px] font-semibold text-grey-45 uppercase tracking-wide mb-2">Past Services</h4>
                          <div className="space-y-1.5 max-h-36 overflow-y-auto">
                            {clientSnippet.serviceHistory.map((sh, i) => (
                              <div key={i} className="flex items-center justify-between gap-2 text-xs">
                                <div className="min-w-0 flex-1">
                                  <span className="font-medium text-grey-90 truncate block">{sh.serviceName ?? 'Service'}</span>
                                  <span className="text-grey-45">{sh.staffName ?? '—'} · {new Date(sh.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span>
                                </div>
                                <span className="text-grey-75 font-medium flex-shrink-0">${parseFloat(sh.price).toFixed(0)}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Reviews placeholder */}
                      <div className="bg-grey-5 rounded-lg px-3 py-2">
                        <p className="text-[10px] text-grey-45 italic">Reviews — coming soon</p>
                      </div>
                    </div>
                  )}

                  {!snippetLoading && !clientSnippet && selBooking.clientId && (
                    <p className="text-xs text-grey-45 italic">No profile on file</p>
                  )}
                </div>
              </div>
            </div>

            {/* Quick actions */}
            <div className="px-5 py-4 border-t border-grey-5 space-y-2 shrink-0">

              {/* Reschedule form — expands inline when triggered */}
              {showReschedule && (selBooking.status === 'confirmed' || selBooking.status === 'in_progress') && (
                <div className="bg-grey-5 rounded-xl p-3 space-y-2 mb-1">
                  <p className="text-xs font-semibold text-grey-75">Reschedule to</p>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[10px] font-medium text-grey-60 mb-0.5">Date</label>
                      <input
                        type="date"
                        value={rescheduleForm.date}
                        onChange={e => setRescheduleForm(f => ({ ...f, date: e.target.value }))}
                        className="w-full border border-grey-15 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-tone-ink/30"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-medium text-grey-60 mb-0.5">Time</label>
                      <input
                        type="time"
                        value={rescheduleForm.time}
                        onChange={e => setRescheduleForm(f => ({ ...f, time: e.target.value }))}
                        className="w-full border border-grey-15 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-tone-ink/30"
                      />
                    </div>
                  </div>
                  {rescheduleError && <p className="text-[11px] text-semantic-danger">{rescheduleError}</p>}
                  <div className="flex gap-2 pt-0.5">
                    <button
                      onClick={handleReschedule}
                      disabled={rescheduleSaving || !rescheduleForm.date || !rescheduleForm.time}
                      className="flex-1 py-1.5 bg-[#1a2313] text-white text-xs font-semibold rounded-lg hover:bg-[#2f3827] disabled:opacity-50 transition-colors"
                    >
                      {rescheduleSaving ? 'Saving…' : 'Confirm'}
                    </button>
                    <button
                      onClick={() => { setShowReschedule(false); setRescheduleError(null); }}
                      className="py-1.5 px-3 bg-grey-15 text-grey-75 text-xs font-medium rounded-lg hover:bg-grey-30 transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {(selBooking.status === 'confirmed' || selBooking.status === 'in_progress') && !showReschedule && (
                <div className="flex gap-2 flex-wrap">
                  {selBooking.status === 'confirmed' && (
                    <>
                      <button
                        onClick={() => { bookingAction(selBooking.id, 'check-in'); setSelBooking(null); setClientSnippet(null); }}
                        className="flex-1 py-2 bg-grey-75 text-white text-xs font-semibold rounded-lg hover:bg-tone-ink transition-colors"
                      >
                        Check In
                      </button>
                      <button
                        onClick={() => { setCheckoutBookingId(selBooking.id); setSelBooking(null); setClientSnippet(null); }}
                        className="flex-1 py-2 text-tone-ink text-xs font-semibold rounded-lg bg-tone-sage/15 hover:bg-tone-sage/30 border border-tone-sage/40 transition-colors"
                      >
                        Checkout Now
                      </button>
                    </>
                  )}
                  {selBooking.status === 'in_progress' && (
                    <button
                      onClick={() => { setCheckoutBookingId(selBooking.id); setSelBooking(null); setClientSnippet(null); }}
                      className="flex-1 py-2 bg-tone-sage text-white text-xs font-semibold rounded-lg hover:bg-tone-sage transition-colors"
                    >
                      Complete
                    </button>
                  )}
                  <button
                    onClick={() => { bookingAction(selBooking.id, 'no-show'); setSelBooking(null); setClientSnippet(null); }}
                    className="py-2 px-3 bg-semantic-warn/5 text-semantic-warn text-xs font-semibold rounded-lg hover:bg-semantic-warn/10 transition-colors"
                  >
                    No Show
                  </button>
                </div>
              )}

              {/* Reschedule trigger button */}
              {(selBooking.status === 'confirmed' || selBooking.status === 'in_progress') && !showReschedule && (
                <button
                  onClick={() => {
                    const d = new Date(selBooking.startTime);
                    setRescheduleForm({
                      date: `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`,
                      time: `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`,
                    });
                    setShowReschedule(true);
                    setRescheduleError(null);
                  }}
                  className="w-full py-2 border border-grey-15 text-grey-75 text-xs font-medium rounded-lg hover:bg-grey-5 transition-colors flex items-center justify-center gap-1.5"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5"/></svg>
                  Reschedule
                </button>
              )}

              <button
                onClick={() => { setSelBooking(null); setClientSnippet(null); setShowReschedule(false); setRescheduleError(null); }}
                className="w-full py-2.5 bg-grey-15 text-grey-75 text-sm font-medium rounded-lg hover:bg-grey-15 transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {editBookingId && (
        <BookingForm
          mode="edit"
          bookingId={editBookingId}
          onClose={() => setEditBookingId(null)}
          onSave={() => {
            setEditBookingId(null);
            void load();
          }}
        />
      )}

      {checkoutBookingId && (
        <CheckoutModal
          bookingId={checkoutBookingId}
          onClose={() => setCheckoutBookingId(null)}
          onComplete={() => {
            setCheckoutBookingId(null);
            void load();
          }}
        />
      )}
    </div>
  );
}
