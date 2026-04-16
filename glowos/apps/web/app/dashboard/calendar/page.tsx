'use client';

import { useEffect, useState, useCallback } from 'react';
import FullCalendar from '@fullcalendar/react';
import timeGridPlugin from '@fullcalendar/timegrid';
import dayGridPlugin from '@fullcalendar/daygrid';
import interactionPlugin from '@fullcalendar/interaction';
import type { EventInput, EventClickArg, EventDropArg, DatesSetArg } from '@fullcalendar/core';
import type { EventResizeDoneArg } from '@fullcalendar/interaction';
import { apiFetch } from '../../lib/api';

// ─── Types ────────────────────────────────────────────────────────────────────

interface StaffMember { id: string; name: string; }

interface DutyBlock {
  id: string;
  staffId: string;
  date: string;
  startTime: string;
  endTime: string;
  notes: string | null;
}

interface Booking {
  id: string;
  staffId: string | null;
  startTime: string;
  endTime: string;
  status: string;
  clientName: string | null;
  serviceName: string | null;
  staffName: string | null;
}

interface BookingRow {
  booking: { id: string; staffId: string | null; startTime: string; endTime: string; status: string; };
  service: { name: string } | null;
  staffMember: { name: string } | null;
  client: { name: string | null } | null;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const STAFF_COLORS = ['#4f46e5', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];
const DUTY_BG = '#1a2313'; // unified color for all duty blocks (matches brand)

const STATUS_LABELS: Record<string, string> = {
  confirmed: 'Confirmed',
  completed: 'Completed',
  cancelled: 'Cancelled',
  no_show: 'No Show',
  in_progress: 'In Progress',
};

function normaliseBookings(rows: BookingRow[]): Booking[] {
  return rows.map(r => ({
    id: r.booking.id,
    staffId: r.booking.staffId ?? null,
    startTime: r.booking.startTime,
    endTime: r.booking.endTime,
    status: r.booking.status,
    clientName: r.client?.name ?? null,
    serviceName: r.service?.name ?? null,
    staffName: r.staffMember?.name ?? null,
  }));
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function CalendarPage() {
  const [staffList, setStaffList] = useState<StaffMember[]>([]);
  const [events, setEvents] = useState<EventInput[]>([]);
  const [filterStaffId, setFilterStaffId] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [dateRange, setDateRange] = useState<{ start: string; end: string } | null>(null);

  // Booking detail drawer
  const [selectedBooking, setSelectedBooking] = useState<Booking | null>(null);

  // Duty block modal
  const [showDutyModal, setShowDutyModal] = useState(false);
  const [editDuty, setEditDuty] = useState<DutyBlock | null>(null);
  const [dutyForm, setDutyForm] = useState({ staffId: '', date: '', startTime: '09:00', endTime: '17:00', notes: '' });
  const [dutyError, setDutyError] = useState<string | null>(null);
  const [dutySaving, setDutySaving] = useState(false);

  useEffect(() => {
    apiFetch('/merchant/staff')
      .then((data: { staff: StaffMember[] }) => setStaffList(data.staff ?? []))
      .catch(() => {});
  }, []);

  // ── Event loading ────────────────────────────────────────────────────────────

  const loadEvents = useCallback(async (start: string, end: string) => {
    const from = start.slice(0, 10);
    const to = end.slice(0, 10);

    let bookingsUrl = `/merchant/bookings?from=${from}&to=${to}`;
    if (filterStaffId) bookingsUrl += `&staff_id=${filterStaffId}`;
    if (filterStatus) bookingsUrl += `&status=${filterStatus}`;

    let dutiesUrl = `/merchant/duties?from=${from}&to=${to}`;
    if (filterStaffId) dutiesUrl += `&staff_id=${filterStaffId}`;

    try {
      const [dutiesData, bookingsData] = await Promise.all([
        apiFetch(dutiesUrl),
        apiFetch(bookingsUrl).catch(() => ({ bookings: [] })),
      ]);

      // Build a staff-colour map
      const staffColorMap: Record<string, string> = {};
      staffList.forEach((s, i) => { staffColorMap[s.id] = STAFF_COLORS[i % STAFF_COLORS.length]!; });

      // Duty blocks (editable by admin)
      const dutyEvents: EventInput[] = (dutiesData.duties ?? []).map((d: DutyBlock) => {
        const staffName = staffList.find(s => s.id === d.staffId)?.name ?? '';
        return {
          id: `duty-${d.id}`,
          title: staffName ? `${staffName}${d.notes ? ` — ${d.notes}` : ''}` : (d.notes ?? 'Block'),
          start: `${d.date}T${d.startTime}`,
          end: `${d.date}T${d.endTime}`,
          backgroundColor: DUTY_BG,
          borderColor: DUTY_BG,
          textColor: '#ffffff',
          extendedProps: { type: 'duty', duty: d },
          editable: true,
        };
      });

      // Booking events (read-only overlays, colour-coded by staff)
      const bookingEvents: EventInput[] = normaliseBookings(bookingsData.bookings ?? []).map(b => ({
        id: `booking-${b.id}`,
        title: `${b.clientName ?? 'Client'} — ${b.serviceName ?? ''}`,
        start: b.startTime,
        end: b.endTime,
        backgroundColor: b.staffId ? (staffColorMap[b.staffId] ?? '#64748b') : '#64748b',
        borderColor: 'transparent',
        extendedProps: { type: 'booking', booking: b },
        editable: false,
      }));

      setEvents([...dutyEvents, ...bookingEvents]);
    } catch {
      // silent — calendar stays at previous state
    }
  }, [filterStaffId, filterStatus, staffList]);

  useEffect(() => {
    if (dateRange) loadEvents(dateRange.start, dateRange.end);
  }, [filterStaffId, filterStatus, dateRange, loadEvents]);

  // ── Drag / resize handlers ────────────────────────────────────────────────────

  async function handleEventDrop(info: EventDropArg) {
    if (info.event.extendedProps.type !== 'duty') { info.revert(); return; }
    const dutyId = info.event.id.replace('duty-', '');
    const start = info.event.start!;
    const end = info.event.end!;
    try {
      await apiFetch(`/merchant/duties/${dutyId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          date: start.toISOString().slice(0, 10),
          start_time: start.toTimeString().slice(0, 5),
          end_time: end.toTimeString().slice(0, 5),
        }),
      });
    } catch { info.revert(); }
  }

  async function handleEventResize(info: EventResizeDoneArg) {
    if (info.event.extendedProps.type !== 'duty') { info.revert(); return; }
    const dutyId = info.event.id.replace('duty-', '');
    const start = info.event.start!;
    const end = info.event.end!;
    try {
      await apiFetch(`/merchant/duties/${dutyId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          date: start.toISOString().slice(0, 10),
          start_time: start.toTimeString().slice(0, 5),
          end_time: end.toTimeString().slice(0, 5),
        }),
      });
    } catch { info.revert(); }
  }

  // ── Click handlers ────────────────────────────────────────────────────────────

  function handleEventClick(info: EventClickArg) {
    if (info.event.extendedProps.type === 'duty') {
      const duty = info.event.extendedProps.duty as DutyBlock;
      setEditDuty(duty);
      setDutyForm({ staffId: duty.staffId, date: duty.date, startTime: duty.startTime, endTime: duty.endTime, notes: duty.notes ?? '' });
      setDutyError(null);
      setShowDutyModal(true);
    } else {
      setSelectedBooking(info.event.extendedProps.booking as Booking);
    }
  }

  function handleDateClick(info: { dateStr: string }) {
    setEditDuty(null);
    setDutyError(null);
    setDutyForm({ staffId: staffList[0]?.id ?? '', date: info.dateStr.slice(0, 10), startTime: '09:00', endTime: '17:00', notes: '' });
    setShowDutyModal(true);
  }

  // ── Duty CRUD ─────────────────────────────────────────────────────────────────

  async function handleSaveDuty() {
    setDutyError(null);
    setDutySaving(true);
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
      if (dateRange) loadEvents(dateRange.start, dateRange.end);
    } catch (err) {
      setDutyError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setDutySaving(false);
    }
  }

  async function handleDeleteDuty() {
    if (!editDuty) return;
    setDutyError(null);
    setDutySaving(true);
    try {
      await apiFetch(`/merchant/duties/${editDuty.id}`, { method: 'DELETE' });
      setShowDutyModal(false);
      if (dateRange) loadEvents(dateRange.start, dateRange.end);
    } catch (err) {
      setDutyError(err instanceof Error ? err.message : 'Failed to delete');
    } finally {
      setDutySaving(false);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4 font-manrope">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Calendar</h1>
          <p className="text-xs text-gray-400 mt-0.5">Dark blocks = duty schedule &nbsp;·&nbsp; Coloured = bookings</p>
        </div>
        <button
          onClick={() => { setEditDuty(null); setDutyError(null); setDutyForm({ staffId: staffList[0]?.id ?? '', date: new Date().toISOString().slice(0, 10), startTime: '09:00', endTime: '17:00', notes: '' }); setShowDutyModal(true); }}
          className="px-4 py-2 bg-[#1a2313] text-white text-sm font-medium rounded-lg hover:bg-[#2f3827] transition-colors"
        >
          + Add Block
        </button>
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap items-center">
        <select value={filterStaffId} onChange={e => setFilterStaffId(e.target.value)} className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm text-gray-700 bg-white focus:outline-none focus:ring-1 focus:ring-[#1a2313]/30">
          <option value="">All Staff</option>
          {staffList.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm text-gray-700 bg-white focus:outline-none focus:ring-1 focus:ring-[#1a2313]/30">
          <option value="">All Statuses</option>
          {Object.entries(STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>

      {/* Staff colour legend */}
      <div className="flex gap-3 flex-wrap items-center">
        <span className="flex items-center gap-1.5 text-xs text-gray-500">
          <span className="w-3 h-3 rounded-sm inline-block bg-[#1a2313]" />
          Duty block (drag or resize to edit)
        </span>
        {staffList.slice(0, 7).map((s, i) => (
          <span key={s.id} className="flex items-center gap-1.5 text-xs text-gray-500">
            <span className="w-3 h-3 rounded-sm inline-block" style={{ backgroundColor: STAFF_COLORS[i % STAFF_COLORS.length] }} />
            {s.name}
          </span>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <FullCalendar
          plugins={[timeGridPlugin, dayGridPlugin, interactionPlugin]}
          initialView="timeGridWeek"
          headerToolbar={{ left: 'prev,next today', center: 'title', right: 'dayGridMonth,timeGridWeek,timeGridDay' }}
          events={events}
          editable={true}
          selectable={true}
          eventResizableFromStart={true}
          eventDrop={handleEventDrop}
          eventResize={handleEventResize}
          eventClick={handleEventClick}
          dateClick={handleDateClick}
          datesSet={(info: DatesSetArg) => {
            setDateRange({ start: info.startStr, end: info.endStr });
            loadEvents(info.startStr, info.endStr);
          }}
          height="auto"
          slotMinTime="07:00:00"
          slotMaxTime="22:00:00"
        />
      </div>

      {/* Duty block modal */}
      {showDutyModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6 space-y-4 font-manrope">
            <h2 className="text-base font-semibold text-gray-900">{editDuty ? 'Edit Schedule Block' : 'Add Schedule Block'}</h2>

            {!editDuty && (
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Staff Member</label>
                <select value={dutyForm.staffId} onChange={e => setDutyForm(f => ({ ...f, staffId: e.target.value }))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#1a2313]/30">
                  {staffList.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Date</label>
              <input type="date" value={dutyForm.date} onChange={e => setDutyForm(f => ({ ...f, date: e.target.value }))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#1a2313]/30" />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Start</label>
                <input type="time" value={dutyForm.startTime} onChange={e => setDutyForm(f => ({ ...f, startTime: e.target.value }))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#1a2313]/30" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">End</label>
                <input type="time" value={dutyForm.endTime} onChange={e => setDutyForm(f => ({ ...f, endTime: e.target.value }))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#1a2313]/30" />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Notes (optional)</label>
              <input type="text" value={dutyForm.notes} onChange={e => setDutyForm(f => ({ ...f, notes: e.target.value }))} placeholder="e.g. Front desk coverage" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#1a2313]/30" />
            </div>

            {dutyError && <p className="text-xs text-red-600">{dutyError}</p>}

            <div className="flex gap-2 pt-1">
              <button onClick={handleSaveDuty} disabled={dutySaving} className="flex-1 py-2 bg-[#1a2313] text-white text-sm font-medium rounded-lg hover:bg-[#2f3827] disabled:opacity-50 transition-colors">
                {dutySaving ? 'Saving…' : 'Save'}
              </button>
              {editDuty && (
                <button onClick={handleDeleteDuty} disabled={dutySaving} className="py-2 px-4 bg-red-50 text-red-600 text-sm font-medium rounded-lg hover:bg-red-100 disabled:opacity-50 transition-colors">
                  Delete
                </button>
              )}
              <button onClick={() => { setShowDutyModal(false); setDutyError(null); }} className="py-2 px-4 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-200 transition-colors">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Booking detail drawer */}
      {selectedBooking && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6 space-y-3 font-manrope">
            <h2 className="text-base font-semibold text-gray-900">Booking Details</h2>
            <div className="space-y-2 text-sm divide-y divide-gray-50">
              {[
                ['Client', selectedBooking.clientName ?? '—'],
                ['Service', selectedBooking.serviceName ?? '—'],
                ['Staff', selectedBooking.staffName ?? '—'],
                ['Status', STATUS_LABELS[selectedBooking.status] ?? selectedBooking.status],
                ['Start', new Date(selectedBooking.startTime).toLocaleString()],
                ['End', new Date(selectedBooking.endTime).toLocaleString()],
              ].map(([label, value]) => (
                <div key={label} className="flex justify-between py-1.5">
                  <span className="text-gray-400 font-inter text-xs uppercase tracking-wide">{label}</span>
                  <span className="font-medium text-gray-800">{value}</span>
                </div>
              ))}
            </div>
            <button onClick={() => setSelectedBooking(null)} className="w-full py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-200 transition-colors">
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
