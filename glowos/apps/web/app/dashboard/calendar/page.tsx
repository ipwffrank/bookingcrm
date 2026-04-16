'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import Link from 'next/link';
import { apiFetch } from '../../lib/api';

// ─── Grid constants (static) ───────────────────────────────────────────────────
const DAY_START_H = 7;
const DAY_END_H   = 22;
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

interface ClientSnippet {
  profileId: string;
  totalVisits: number;
  totalSpendSgd: string;
  lastVisitAt: string | null;
  vipTier: string | null;
  notes: string | null;
}

interface RawBookingRow {
  booking:     { id: string; staffId: string | null; clientId: string; startTime: string; endTime: string; status: string; priceSgd: string };
  service:     { name: string } | null;
  staffMember: { name: string } | null;
  client:      { id: string; name: string | null } | null;
}

interface DragViz { entityId: string; entityType: 'duty' | 'booking'; staffId: string; startMin: number; endMin: number; }

// ─── Constants ─────────────────────────────────────────────────────────────────
const STAFF_COLORS = ['#4f46e5','#0ea5e9','#10b981','#f59e0b','#ef4444','#8b5cf6','#ec4899'];
const DUTY_BG = '#1a2313';

const STATUS_META: Record<string, { label: string; cls: string }> = {
  confirmed:   { label: 'Confirmed',   cls: 'bg-emerald-50 text-emerald-700' },
  completed:   { label: 'Completed',   cls: 'bg-gray-100 text-gray-600' },
  cancelled:   { label: 'Cancelled',   cls: 'bg-red-50 text-red-600' },
  no_show:     { label: 'No Show',     cls: 'bg-orange-50 text-orange-600' },
  in_progress: { label: 'In Progress', cls: 'bg-blue-50 text-blue-700' },
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

  // Modals
  const [selBooking,    setSelBooking]    = useState<Booking | null>(null);
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

  // ── Dynamic grid helpers (depend on density) ─────────────────────────────────
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
      const [sd, dd, bd] = await Promise.all([
        apiFetch('/merchant/staff'),
        apiFetch(`/merchant/duties?from=${dateStr}&to=${dateStr}`),
        apiFetch(`/merchant/bookings?from=${dateStr}&to=${dateStr}`).catch(() => ({ bookings: [] })),
      ]);
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

  useEffect(() => { loadRef.current = load; }, [load]);
  useEffect(() => { load(); }, [load]);

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
  function occupancy(staffId: string) {
    const sb = bookings.filter(b => b.staffId === staffId);
    if (!sb.length) return 0;
    const bookedMin = sb.reduce((acc, b) => acc + isoToLocalMin(b.endTime) - isoToLocalMin(b.startTime), 0);
    const d = duties.find(d => d.staffId === staffId);
    if (!d) return 0;
    const dutyMin = timeStrToMin(d.endTime) - timeStrToMin(d.startTime);
    return dutyMin > 0 ? clamp(Math.round((bookedMin / dutyMin) * 100), 0, 100) : 0;
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
        profileId:    data.profile.id,
        totalVisits:  data.profile.totalVisits,
        totalSpendSgd: data.profile.totalSpendSgd,
        lastVisitAt:  data.profile.lastVisitAt,
        vipTier:      data.profile.vipTier,
        notes:        data.profile.notes,
      });
    } catch { /* profile may not exist */ }
    finally { setSnippetLoading(false); }
  }

  // ── Booking actions ───────────────────────────────────────────────────────────
  async function bookingAction(id: string, action: 'check-in' | 'complete' | 'no-show') {
    try {
      await apiFetch(`/merchant/bookings/${id}/${action}`, { method: 'PUT' });
      await load();
    } catch { /* stale status — ignore */ }
  }

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

  // ─── Render ────────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-4 font-manrope" style={{ userSelect: 'none' }}>
      {/* Mobile hint — calendar requires a wider screen to use comfortably */}
      <div className="md:hidden rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
        Calendar works best on a tablet or desktop. Scroll horizontally to navigate the grid.
      </div>

      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Calendar</h1>
          <p className="text-xs text-gray-400 mt-0.5">
            Click empty slot to add block · Drag to move or reassign
            <span className="ml-2 text-gray-300">·</span>
            <span className="ml-2 text-gray-300 font-mono text-[10px]">B</span>
            <span className="ml-0.5 text-gray-400 text-[10px]"> add block</span>
            <span className="ml-2 text-gray-300 font-mono text-[10px]">← →</span>
            <span className="ml-0.5 text-gray-400 text-[10px]"> navigate</span>
            <span className="ml-2 text-gray-300 font-mono text-[10px]">C</span>
            <span className="ml-0.5 text-gray-400 text-[10px]"> density</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Density toggle */}
          <button
            onClick={() => setDensity(d => d === 'compact' ? 'comfortable' : 'compact')}
            title="Toggle compact/comfortable view (C)"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 text-xs text-gray-600 hover:bg-gray-50 transition-colors"
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

      {/* ── Date navigation ── */}
      <div className="flex items-center gap-2">
        <button onClick={() => nav(-1)} className="p-1.5 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 transition-colors">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
        </button>
        <span className="text-sm font-semibold text-gray-800 min-w-64 text-center">{dateLabel}</span>
        <button onClick={() => nav(1)} className="p-1.5 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 transition-colors">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
        </button>
        <button onClick={() => setDate(new Date())} className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors">
          Today
        </button>
        {loading && <span className="text-xs text-gray-400 animate-pulse ml-2">Loading…</span>}
      </div>

      {/* ── Resource grid ── */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden flex flex-col">

        {/* Staff column headers */}
        <div className="flex border-b border-gray-100 bg-white z-20 shrink-0">
          <div className="w-16 shrink-0 border-r border-gray-200" />
          {staffList.map((s, i) => {
            const occ   = occupancy(s.id);
            const color = STAFF_COLORS[i % STAFF_COLORS.length]!;
            return (
              <div key={s.id} className="flex-1 min-w-[160px] border-r border-gray-100 last:border-r-0 px-3 py-3">
                <div className="flex items-center gap-2">
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold text-white shrink-0 shadow-sm"
                    style={{ backgroundColor: color }}
                  >
                    {s.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-gray-900 truncate">{s.name}</div>
                    <div className="flex items-center gap-1.5 mt-1">
                      <div className="h-1 w-14 rounded-full bg-gray-100 overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all duration-500"
                          style={{
                            width: `${occ}%`,
                            backgroundColor: occ > 80 ? '#ef4444' : occ > 50 ? '#f59e0b' : color,
                          }}
                        />
                      </div>
                      <span className="text-[10px] text-gray-400 tabular-nums">{occ}%</span>
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
            <div className="w-16 shrink-0 border-r border-gray-200 relative bg-white sticky left-0 z-10" style={{ height: totalPx }}>
              {timeLabels.map(({ min, label }) => (
                <div key={min} className="absolute right-2 left-0 flex items-center justify-end pr-2" style={{ top: topPx(min) - 9 }}>
                  <span className="text-[11px] text-gray-500 font-semibold whitespace-nowrap">{label}</span>
                </div>
              ))}
              {/* 30-min marks in gutter */}
              {timeLabels.slice(0, -1).map(({ min }) => (
                <div key={`${min}half`} className="absolute right-2 left-0 flex items-center justify-end pr-2" style={{ top: topPx(min + 30) - 7 }}>
                  <span className="text-[9px] text-gray-400 whitespace-nowrap">:30</span>
                </div>
              ))}
            </div>

            {/* Staff columns */}
            {staffList.map((s, colIdx) => {
              const color       = STAFF_COLORS[colIdx % STAFF_COLORS.length]!;
              const staffDuties = duties.filter(d => d.staffId === s.id);
              const staffBooks  = bookings.filter(b => b.staffId === s.id);
              const offRanges   = offDutyRanges(s.id);
              const ghostHere   = viz && viz.entityType === 'duty' && viz.staffId === s.id && !staffDuties.find(d => d.id === viz.entityId);

              return (
                <div
                  key={s.id}
                  ref={el => { colRefs.current[s.id] = el; }}
                  className="flex-1 min-w-[160px] border-r border-gray-100 last:border-r-0 relative cursor-cell"
                  style={{ height: totalPx }}
                  onClick={e => {
                    const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
                    openNewDuty(s.id, e.clientY - rect.top);
                  }}
                >
                  {/* Hour lines — solid, clearly visible */}
                  {timeLabels.map(({ min }) => (
                    <div key={min} className="absolute inset-x-0 border-t border-gray-300" style={{ top: topPx(min) }} />
                  ))}
                  {/* 30-min sub-lines — dashed, lighter than hour lines */}
                  {timeLabels.slice(0, -1).map(({ min }) => (
                    <div key={`${min}h`} className="absolute inset-x-0 border-t border-dashed border-gray-200" style={{ top: topPx(min + 30) }} />
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
                      <div className="relative h-0.5 bg-red-400">
                        {colIdx === 0 && (
                          <div className="absolute left-0 top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full bg-red-400 shadow-sm" style={{ marginLeft: -5 }} />
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
                          setDutyForm({ staffId: duty.staffId, date: duty.date, startTime: duty.startTime, endTime: duty.endTime, notes: duty.notes ?? '' });
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
                          <div className="w-6 h-px bg-white/30 hover:bg-white/60 transition-colors" />
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
                    const canCheckIn  = b.status === 'confirmed';
                    const canComplete = b.status === 'in_progress';
                    const canNoShow   = b.status === 'confirmed' || b.status === 'in_progress';
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
                      >
                        {/* Quick action buttons — stop propagation so mousedown drag doesn't trigger */}
                        <div
                          className="absolute top-1 right-1 hidden group-hover/card:flex items-center gap-0.5 z-20"
                          onMouseDown={e => e.stopPropagation()}
                        >
                          {canCheckIn && (
                            <button
                              title="Check In"
                              className="w-5 h-5 rounded flex items-center justify-center bg-blue-500 hover:bg-blue-600 text-white transition-colors"
                              onClick={e => { e.stopPropagation(); bookingAction(b.id, 'check-in'); }}
                            >
                              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4" /></svg>
                            </button>
                          )}
                          {canComplete && (
                            <button
                              title="Mark Complete"
                              className="w-5 h-5 rounded flex items-center justify-center bg-emerald-500 hover:bg-emerald-600 text-white transition-colors"
                              onClick={e => { e.stopPropagation(); bookingAction(b.id, 'complete'); }}
                            >
                              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" /></svg>
                            </button>
                          )}
                          {canNoShow && (
                            <button
                              title="No Show"
                              className="w-5 h-5 rounded flex items-center justify-center bg-orange-400 hover:bg-orange-500 text-white transition-colors"
                              onClick={e => { e.stopPropagation(); bookingAction(b.id, 'no-show'); }}
                            >
                              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                            </button>
                          )}
                        </div>

                        <div className="px-2 py-1.5 pr-1">
                          <div className="text-[11px] font-semibold text-gray-900 truncate leading-tight">{b.clientName ?? 'Client'}</div>
                          {h > 36 && <div className="text-[10px] text-gray-500 truncate mt-0.5">{b.serviceName}</div>}
                          {h > 54 && (
                            <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                              {meta && (
                                <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-sm ${meta.cls}`}>
                                  {meta.label}
                                </span>
                              )}
                              {b.priceSgd && (
                                <span className="text-[9px] font-medium text-gray-400">
                                  ${parseFloat(b.priceSgd).toFixed(0)}
                                </span>
                              )}
                            </div>
                          )}
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
        <div className="border-t border-gray-100 bg-gray-50/40 shrink-0">
          <div className="flex items-center gap-0 divide-x divide-gray-100 px-1 py-2">
            <div className="flex flex-col items-center px-4">
              <span className="text-base font-bold text-gray-900 tabular-nums leading-none">{dayStats.total}</span>
              <span className="text-[10px] text-gray-400 mt-0.5">Bookings</span>
            </div>
            {dayStats.confirmed > 0 && (
              <div className="flex flex-col items-center px-4">
                <span className="text-base font-bold text-emerald-600 tabular-nums leading-none">{dayStats.confirmed}</span>
                <span className="text-[10px] text-gray-400 mt-0.5">Confirmed</span>
              </div>
            )}
            {dayStats.inProgress > 0 && (
              <div className="flex flex-col items-center px-4">
                <span className="text-base font-bold text-blue-600 tabular-nums leading-none">{dayStats.inProgress}</span>
                <span className="text-[10px] text-gray-400 mt-0.5">In Progress</span>
              </div>
            )}
            {dayStats.completed > 0 && (
              <div className="flex flex-col items-center px-4">
                <span className="text-base font-bold text-gray-700 tabular-nums leading-none">{dayStats.completed}</span>
                <span className="text-[10px] text-gray-400 mt-0.5">Completed</span>
              </div>
            )}
            {dayStats.noShow > 0 && (
              <div className="flex flex-col items-center px-4">
                <span className="text-base font-bold text-orange-500 tabular-nums leading-none">{dayStats.noShow}</span>
                <span className="text-[10px] text-gray-400 mt-0.5">No Show</span>
              </div>
            )}
            {dayStats.cancelled > 0 && (
              <div className="flex flex-col items-center px-4">
                <span className="text-base font-bold text-red-500 tabular-nums leading-none">{dayStats.cancelled}</span>
                <span className="text-[10px] text-gray-400 mt-0.5">Cancelled</span>
              </div>
            )}
            <div className="flex flex-col items-center px-4">
              <span className="text-base font-bold text-[#1a2313] tabular-nums leading-none">
                ${dayStats.revenue.toFixed(0)}
              </span>
              <span className="text-[10px] text-gray-400 mt-0.5">Est. Revenue</span>
            </div>
            {/* Legend */}
            <div className="flex items-center gap-3 pl-4 pr-4 ml-auto border-l-0">
              <span className="flex items-center gap-1.5 text-[10px] text-gray-400">
                <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: DUTY_BG }} />
                Duty
              </span>
              {staffList.slice(0, 5).map((s, i) => (
                <span key={s.id} className="flex items-center gap-1.5 text-[10px] text-gray-400">
                  <span className="w-2.5 h-2.5 rounded-sm shrink-0 opacity-60" style={{ backgroundColor: STAFF_COLORS[i % STAFF_COLORS.length] }} />
                  {s.name.split(' ')[0]}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── Duty modal ── */}
      {showDutyModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6 space-y-4 font-manrope">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-gray-900">{editDuty ? 'Edit Schedule Block' : 'New Schedule Block'}</h2>
              <button onClick={() => setShowDutyModal(false)} className="text-gray-400 hover:text-gray-600 transition-colors">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>

            {!editDuty && (
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Staff Member</label>
                <select
                  value={dutyForm.staffId}
                  onChange={e => setDutyForm(f => ({ ...f, staffId: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#1a2313]/30"
                >
                  {staffList.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Date</label>
              <input
                type="date"
                value={dutyForm.date}
                onChange={e => setDutyForm(f => ({ ...f, date: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#1a2313]/30"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Start</label>
                <input
                  type="time"
                  value={dutyForm.startTime}
                  onChange={e => setDutyForm(f => ({ ...f, startTime: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#1a2313]/30"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">End</label>
                <input
                  type="time"
                  value={dutyForm.endTime}
                  onChange={e => setDutyForm(f => ({ ...f, endTime: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#1a2313]/30"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Notes (optional)</label>
              <input
                type="text"
                value={dutyForm.notes}
                onChange={e => setDutyForm(f => ({ ...f, notes: e.target.value }))}
                placeholder="e.g. Front desk, Facial room"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#1a2313]/30"
              />
            </div>

            {dutyError && <p className="text-xs text-red-600">{dutyError}</p>}

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
                  className="py-2 px-4 bg-red-50 text-red-600 text-sm font-medium rounded-lg hover:bg-red-100 disabled:opacity-50 transition-colors"
                >
                  Delete
                </button>
              )}
              <button
                onClick={() => { setShowDutyModal(false); setDutyError(null); }}
                className="py-2 px-4 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-200 transition-colors"
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
          <div className="w-full max-w-sm bg-white shadow-2xl flex flex-col font-manrope overflow-hidden">

            {/* Header */}
            <div className="px-5 py-4 border-b border-gray-100 flex items-start justify-between shrink-0">
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="text-sm font-semibold text-gray-900">{selBooking.clientName ?? 'Client'}</h2>
                  {STATUS_META[selBooking.status] && (
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-md ${STATUS_META[selBooking.status]!.cls}`}>
                      {STATUS_META[selBooking.status]!.label}
                    </span>
                  )}
                </div>
                <p className="text-xs text-gray-400 mt-0.5">{selBooking.serviceName}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {selBooking.priceSgd && (
                  <span className="text-sm font-semibold text-[#1a2313]">${parseFloat(selBooking.priceSgd).toFixed(2)}</span>
                )}
                <button onClick={() => { setSelBooking(null); setClientSnippet(null); setShowReschedule(false); setRescheduleError(null); }} className="p-1 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors">
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
                    <span className="text-[11px] font-medium text-gray-400 uppercase tracking-wide">{label}</span>
                    <span className="text-sm font-medium text-gray-800">{value}</span>
                  </div>
                ))}
              </div>

              {/* Client profile snippet */}
              <div className="px-5 pb-4">
                <div className="border-t border-gray-100 pt-4">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Client Profile</h3>
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
                      <div className="w-5 h-5 border-2 border-gray-200 border-t-gray-500 rounded-full animate-spin" />
                    </div>
                  )}

                  {!snippetLoading && clientSnippet && (
                    <div className="space-y-3">
                      <div className="grid grid-cols-3 gap-2">
                        <div className="bg-gray-50 rounded-lg p-2.5 text-center">
                          <p className="text-base font-bold text-gray-900">{clientSnippet.totalVisits}</p>
                          <p className="text-[10px] text-gray-400">Visits</p>
                        </div>
                        <div className="bg-gray-50 rounded-lg p-2.5 text-center">
                          <p className="text-base font-bold text-gray-900">${parseFloat(clientSnippet.totalSpendSgd).toFixed(0)}</p>
                          <p className="text-[10px] text-gray-400">Revenue</p>
                        </div>
                        <div className="bg-gray-50 rounded-lg p-2.5 text-center">
                          <p className="text-[11px] font-semibold text-gray-900 leading-tight">
                            {clientSnippet.lastVisitAt ? new Date(clientSnippet.lastVisitAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '—'}
                          </p>
                          <p className="text-[10px] text-gray-400">Last Visit</p>
                        </div>
                      </div>
                      {clientSnippet.vipTier && (
                        <div className="flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full bg-purple-400" />
                          <span className="text-xs text-gray-600 capitalize">{clientSnippet.vipTier} member</span>
                        </div>
                      )}
                      {clientSnippet.notes && (
                        <div className="bg-amber-50 rounded-lg px-3 py-2">
                          <p className="text-[11px] text-amber-800 leading-relaxed">{clientSnippet.notes}</p>
                        </div>
                      )}
                    </div>
                  )}

                  {!snippetLoading && !clientSnippet && selBooking.clientId && (
                    <p className="text-xs text-gray-400 italic">No profile on file</p>
                  )}
                </div>
              </div>
            </div>

            {/* Quick actions */}
            <div className="px-5 py-4 border-t border-gray-100 space-y-2 shrink-0">

              {/* Reschedule form — expands inline when triggered */}
              {showReschedule && (selBooking.status === 'confirmed' || selBooking.status === 'in_progress') && (
                <div className="bg-gray-50 rounded-xl p-3 space-y-2 mb-1">
                  <p className="text-xs font-semibold text-gray-700">Reschedule to</p>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[10px] font-medium text-gray-500 mb-0.5">Date</label>
                      <input
                        type="date"
                        value={rescheduleForm.date}
                        onChange={e => setRescheduleForm(f => ({ ...f, date: e.target.value }))}
                        className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-[#1a2313]/30"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-medium text-gray-500 mb-0.5">Time</label>
                      <input
                        type="time"
                        value={rescheduleForm.time}
                        onChange={e => setRescheduleForm(f => ({ ...f, time: e.target.value }))}
                        className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-[#1a2313]/30"
                      />
                    </div>
                  </div>
                  {rescheduleError && <p className="text-[11px] text-red-600">{rescheduleError}</p>}
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
                      className="py-1.5 px-3 bg-gray-200 text-gray-700 text-xs font-medium rounded-lg hover:bg-gray-300 transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {(selBooking.status === 'confirmed' || selBooking.status === 'in_progress') && !showReschedule && (
                <div className="flex gap-2">
                  {selBooking.status === 'confirmed' && (
                    <button
                      onClick={() => { bookingAction(selBooking.id, 'check-in'); setSelBooking(null); setClientSnippet(null); }}
                      className="flex-1 py-2 bg-blue-500 text-white text-xs font-semibold rounded-lg hover:bg-blue-600 transition-colors"
                    >
                      Check In
                    </button>
                  )}
                  {selBooking.status === 'in_progress' && (
                    <button
                      onClick={() => { bookingAction(selBooking.id, 'complete'); setSelBooking(null); setClientSnippet(null); }}
                      className="flex-1 py-2 bg-emerald-500 text-white text-xs font-semibold rounded-lg hover:bg-emerald-600 transition-colors"
                    >
                      Mark Complete
                    </button>
                  )}
                  <button
                    onClick={() => { bookingAction(selBooking.id, 'no-show'); setSelBooking(null); setClientSnippet(null); }}
                    className="py-2 px-3 bg-orange-50 text-orange-600 text-xs font-semibold rounded-lg hover:bg-orange-100 transition-colors"
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
                  className="w-full py-2 border border-gray-200 text-gray-600 text-xs font-medium rounded-lg hover:bg-gray-50 transition-colors flex items-center justify-center gap-1.5"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5"/></svg>
                  Reschedule
                </button>
              )}

              <button
                onClick={() => { setSelBooking(null); setClientSnippet(null); setShowReschedule(false); setRescheduleError(null); }}
                className="w-full py-2.5 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-200 transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
