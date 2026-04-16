'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { apiFetch } from '../../lib/api';

// ─── Grid constants ────────────────────────────────────────────────────────────
const DAY_START_H  = 7;
const DAY_END_H    = 22;
const PX_PER_MIN   = 2;        // 2 px / minute → 1 hr = 120 px
const SNAP_MIN     = 15;       // snap to 15-min increments
const TOTAL_PX     = (DAY_END_H - DAY_START_H) * 60 * PX_PER_MIN; // 1 800 px

// ─── Types ─────────────────────────────────────────────────────────────────────
interface Staff { id: string; name: string; }

interface Duty {
  id: string; staffId: string; date: string;
  startTime: string; endTime: string; notes: string | null;
}

interface Booking {
  id: string; staffId: string | null;
  startTime: string; endTime: string; status: string;
  clientName: string | null; serviceName: string | null; staffName: string | null;
}

interface RawBookingRow {
  booking:     { id: string; staffId: string | null; startTime: string; endTime: string; status: string };
  service:     { name: string } | null;
  staffMember: { name: string } | null;
  client:      { name: string | null } | null;
}

interface DragViz { dutyId: string; staffId: string; startMin: number; endMin: number; }

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

// ─── Helpers ───────────────────────────────────────────────────────────────────
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
function snap(min: number) { return Math.round(min / SNAP_MIN) * SNAP_MIN; }
function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }
function topPx(min: number) { return (min - DAY_START_H * 60) * PX_PER_MIN; }
function heightPx(sm: number, em: number) { return Math.max(PX_PER_MIN * 15, (em - sm) * PX_PER_MIN); }

// ─── Component ─────────────────────────────────────────────────────────────────
export default function CalendarPage() {
  const [date,       setDate]       = useState(() => new Date());
  const [staffList,  setStaffList]  = useState<Staff[]>([]);
  const [duties,     setDuties]     = useState<Duty[]>([]);
  const [bookings,   setBookings]   = useState<Booking[]>([]);
  const [loading,    setLoading]    = useState(false);

  // Modals
  const [selBooking,    setSelBooking]    = useState<Booking | null>(null);
  const [showDutyModal, setShowDutyModal] = useState(false);
  const [editDuty,      setEditDuty]      = useState<Duty | null>(null);
  const [dutyForm,      setDutyForm]      = useState({ staffId: '', date: '', startTime: '09:00', endTime: '17:00', notes: '' });
  const [dutyError,     setDutyError]     = useState<string | null>(null);
  const [dutySaving,    setDutySaving]    = useState(false);

  // Drag — refs for zero-overhead mousemove, state for visual re-renders
  const dragData  = useRef<{ type: 'move' | 'resize'; duty: Duty; startY: number; origStart: number; origEnd: number; } | null>(null);
  const dragVizR  = useRef<DragViz | null>(null);
  const [, bump]  = useState(0);   // force re-render during drag without heavy state
  const colRefs   = useRef<Record<string, HTMLDivElement | null>>({});
  const loadRef   = useRef<() => Promise<void>>(async () => {});

  const dateStr = date.toISOString().slice(0, 10);

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
          startTime:   r.booking.startTime,
          endTime:     r.booking.endTime,
          status:      r.booking.status,
          clientName:  r.client?.name ?? null,
          serviceName: r.service?.name ?? null,
          staffName:   r.staffMember?.name ?? null,
        }))
      );
    } finally { setLoading(false); }
  }, [dateStr]);

  // Keep loadRef current so stable effects can call it
  useEffect(() => { loadRef.current = load; }, [load]);
  useEffect(() => { load(); }, [load]);

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
    dragData.current = { type, duty, startY: e.clientY, origStart: timeStrToMin(duty.startTime), origEnd: timeStrToMin(duty.endTime) };
    dragVizR.current = { dutyId: duty.id, staffId: duty.staffId, startMin: timeStrToMin(duty.startTime), endMin: timeStrToMin(duty.endTime) };
    bump(n => n + 1);
  }

  // Stable event listener (runs once)
  useEffect(() => {
    function staffAtX(clientX: number): string {
      for (const [staffId, el] of Object.entries(colRefs.current)) {
        if (!el) continue;
        const r = el.getBoundingClientRect();
        if (clientX >= r.left && clientX <= r.right) return staffId;
      }
      return dragData.current?.duty.staffId ?? '';
    }

    function onMove(e: MouseEvent) {
      const d = dragData.current;
      if (!d) return;
      const deltaMin = (e.clientY - d.startY) / PX_PER_MIN;

      if (d.type === 'move') {
        const dur = d.origEnd - d.origStart;
        const newStart = clamp(snap(d.origStart + deltaMin), DAY_START_H * 60, DAY_END_H * 60 - dur);
        dragVizR.current = { dutyId: d.duty.id, staffId: staffAtX(e.clientX), startMin: newStart, endMin: newStart + dur };
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

      const noChange = viz.startMin === d.origStart && viz.endMin === d.origEnd && viz.staffId === d.duty.staffId;
      if (noChange) return;

      try {
        const body: Record<string, string> = {
          date:       dateStr,
          start_time: minToStr(viz.startMin),
          end_time:   minToStr(viz.endMin),
        };
        if (viz.staffId !== d.duty.staffId) body.staff_id = viz.staffId;
        await apiFetch(`/merchant/duties/${d.duty.id}`, { method: 'PATCH', body: JSON.stringify(body) });
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
  }, []); // stable — no deps needed thanks to refs

  // ── Duty CRUD ─────────────────────────────────────────────────────────────────
  function openNewDuty(staffId: string, relYPx: number) {
    if (dragData.current) return;
    const rawMin  = relYPx / PX_PER_MIN + DAY_START_H * 60;
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

  // ── Time labels ───────────────────────────────────────────────────────────────
  const timeLabels: { min: number; label: string }[] = [];
  for (let h = DAY_START_H; h <= DAY_END_H; h++) {
    const label = h === 12 ? '12 PM' : h > 12 ? `${h - 12} PM` : `${h} AM`;
    timeLabels.push({ min: h * 60, label });
  }

  // Now indicator (only for today)
  const isToday = dateStr === new Date().toISOString().slice(0, 10);
  const now = new Date();
  const nowMin = isToday ? now.getHours() * 60 + now.getMinutes() : null;

  const dateLabel = date.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const viz = dragVizR.current;

  // ─── Render ────────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-4 font-manrope" style={{ userSelect: 'none' }}>

      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Calendar</h1>
          <p className="text-xs text-gray-400 mt-0.5">Click any empty slot to schedule a block · Drag blocks to move or reassign</p>
        </div>
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
          {/* Gutter spacer */}
          <div className="w-14 shrink-0 border-r border-gray-100" />
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

        {/* Scrollable body */}
        <div className="overflow-y-auto overflow-x-auto flex-1" style={{ maxHeight: 'calc(100vh - 300px)' }}>
          <div className="flex" style={{ minHeight: TOTAL_PX }}>

            {/* Time gutter */}
            <div className="w-14 shrink-0 border-r border-gray-100 relative bg-white sticky left-0 z-10" style={{ height: TOTAL_PX }}>
              {timeLabels.map(({ min, label }) => (
                <div key={min} className="absolute right-2 pr-0.5" style={{ top: topPx(min) - 9, left: 0 }}>
                  <span className="text-[10px] text-gray-400 font-medium whitespace-nowrap">{label}</span>
                </div>
              ))}
            </div>

            {/* Staff columns */}
            {staffList.map((s, colIdx) => {
              const color       = STAFF_COLORS[colIdx % STAFF_COLORS.length]!;
              const staffDuties = duties.filter(d => d.staffId === s.id);
              const staffBooks  = bookings.filter(b => b.staffId === s.id);
              // Drag ghost: show in target column if it isn't the duty's home column
              const ghostHere   = viz && viz.staffId === s.id && !staffDuties.find(d => d.id === viz.dutyId);

              return (
                <div
                  key={s.id}
                  ref={el => { colRefs.current[s.id] = el; }}
                  className="flex-1 min-w-[160px] border-r border-gray-100 last:border-r-0 relative cursor-cell"
                  style={{ height: TOTAL_PX }}
                  onClick={e => {
                    const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
                    openNewDuty(s.id, e.clientY - rect.top);
                  }}
                >
                  {/* Hour lines */}
                  {timeLabels.map(({ min }) => (
                    <div key={min} className="absolute inset-x-0 border-t border-gray-100" style={{ top: topPx(min) }} />
                  ))}
                  {/* 30-min sub-lines */}
                  {timeLabels.slice(0, -1).map(({ min }) => (
                    <div key={`${min}h`} className="absolute inset-x-0 border-t border-dashed border-gray-50" style={{ top: topPx(min + 30) }} />
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
                    const isDragging = viz?.dutyId === duty.id;
                    // If block is being dragged to another column, hide it here
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
                          {duty.notes && (
                            <span className="text-[11px] text-white/90 mt-0.5 truncate">{duty.notes}</span>
                          )}
                          {heightPx(sm, em) < 48 ? null : (
                            <span className="text-[10px] text-white/40 mt-auto">On duty</span>
                          )}
                        </div>
                        {/* Resize handle */}
                        <div
                          className="absolute bottom-0 inset-x-0 h-3 cursor-s-resize flex items-center justify-center group pointer-events-auto"
                          onMouseDown={e => { e.stopPropagation(); startDrag(e, duty, 'resize'); }}
                        >
                          <div className="w-6 h-px bg-white/25 group-hover:bg-white/60 transition-colors" />
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
                    const sm   = isoToLocalMin(b.startTime);
                    const em   = isoToLocalMin(b.endTime);
                    const visS = Math.max(sm, DAY_START_H * 60);
                    const visE = Math.min(em, DAY_END_H * 60);
                    if (visE <= visS) return null;
                    const h = heightPx(visS, visE);
                    const meta = STATUS_META[b.status];

                    return (
                      <div
                        key={b.id}
                        className="absolute z-10 rounded-md overflow-hidden cursor-pointer hover:z-20 hover:shadow-md transition-shadow"
                        style={{
                          top:    topPx(visS),
                          height: h,
                          left:   6,
                          right:  6,
                          backgroundColor: `${color}18`,
                          borderLeft: `3px solid ${color}`,
                        }}
                        onClick={e => { e.stopPropagation(); setSelBooking(b); }}
                      >
                        <div className="px-2 py-1.5">
                          <div className="text-[11px] font-semibold text-gray-900 truncate leading-tight">{b.clientName ?? 'Client'}</div>
                          {h > 36 && <div className="text-[10px] text-gray-500 truncate mt-0.5">{b.serviceName}</div>}
                          {h > 56 && meta && (
                            <div className={`mt-1 text-[9px] font-semibold px-1.5 py-0.5 rounded-sm inline-block ${meta.cls}`}>
                              {meta.label}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>

        {/* Legend */}
        <div className="flex items-center gap-4 px-4 py-2.5 border-t border-gray-100 bg-gray-50/50 shrink-0">
          <span className="flex items-center gap-1.5 text-[11px] text-gray-500">
            <span className="w-3 h-3 rounded-sm shrink-0" style={{ backgroundColor: DUTY_BG }} />
            Duty block
          </span>
          {staffList.slice(0, 7).map((s, i) => (
            <span key={s.id} className="flex items-center gap-1.5 text-[11px] text-gray-500">
              <span className="w-3 h-3 rounded-sm shrink-0 opacity-50" style={{ backgroundColor: STAFF_COLORS[i % STAFF_COLORS.length] }} />
              {s.name}
            </span>
          ))}
          <span className="ml-auto text-[11px] text-gray-400">Drag duty blocks to move · Drag bottom edge to resize</span>
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

      {/* ── Booking detail drawer ── */}
      {selBooking && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm font-manrope overflow-hidden">
            {/* Header strip */}
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-gray-900">{selBooking.clientName ?? 'Client'}</h2>
                <p className="text-xs text-gray-400 mt-0.5">{selBooking.serviceName}</p>
              </div>
              {STATUS_META[selBooking.status] && (
                <span className={`text-[10px] font-semibold px-2 py-1 rounded-md ${STATUS_META[selBooking.status]!.cls}`}>
                  {STATUS_META[selBooking.status]!.label}
                </span>
              )}
            </div>

            {/* Details */}
            <div className="px-5 py-4 space-y-3">
              {[
                ['Staff',  selBooking.staffName ?? '—'],
                ['Start',  new Date(selBooking.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })],
                ['End',    new Date(selBooking.endTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })],
                ['Date',   new Date(selBooking.startTime).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })],
              ].map(([label, value]) => (
                <div key={label} className="flex items-center justify-between">
                  <span className="text-[11px] font-medium text-gray-400 uppercase tracking-wide">{label}</span>
                  <span className="text-sm font-medium text-gray-800">{value}</span>
                </div>
              ))}
            </div>

            <div className="px-5 pb-5">
              <button
                onClick={() => setSelBooking(null)}
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
