'use client';

import { useEffect, useState, useCallback } from 'react';
import FullCalendar from '@fullcalendar/react';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';
import type { EventInput, EventClickArg, EventDropArg } from '@fullcalendar/core';
import type { EventResizeDoneArg } from '@fullcalendar/interaction';
import { apiFetch } from '../../lib/api';

interface StaffMember {
  id: string;
  name: string;
}

interface DutyBlock {
  id: string;
  staffId: string;
  date: string;
  startTime: string;
  endTime: string;
  dutyType: 'floor' | 'treatment' | 'break' | 'other';
  notes: string | null;
}

const DUTY_COLORS: Record<string, string> = {
  floor: '#4f46e5',
  treatment: '#7c3aed',
  break: '#9ca3af',
  other: '#d97706',
};

const STAFF_COLORS = ['#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];

export default function RosterPage() {
  const [staffList, setStaffList] = useState<StaffMember[]>([]);
  const [events, setEvents] = useState<EventInput[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [editDuty, setEditDuty] = useState<DutyBlock | null>(null);
  const [form, setForm] = useState({ staffId: '', date: '', startTime: '09:00', endTime: '17:00', dutyType: 'floor' as DutyBlock['dutyType'], notes: '' });
  const [dateRange, setDateRange] = useState<{ start: string; end: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch('/merchant/staff')
      .then((data: { staff: StaffMember[] }) => setStaffList(data.staff ?? []))
      .catch(() => {}); // staff list failure is non-critical — calendar still works
  }, []);

  const loadEvents = useCallback(async (start: string, end: string) => {
    const from = start.slice(0, 10);
    const to = end.slice(0, 10);

    try {
      const [dutiesData, bookingsData] = await Promise.all([
        apiFetch(`/merchant/duties?from=${from}&to=${to}`),
        apiFetch(`/merchant/bookings?from=${from}&to=${to}`).catch(() => ({ bookings: [] })),
      ]);

      const dutyEvents: EventInput[] = (dutiesData.duties ?? []).map((d: DutyBlock) => ({
        id: `duty-${d.id}`,
        title: `${d.dutyType.charAt(0).toUpperCase() + d.dutyType.slice(1)}${d.notes ? ` — ${d.notes}` : ''}`,
        start: `${d.date}T${d.startTime}`,
        end: `${d.date}T${d.endTime}`,
        backgroundColor: DUTY_COLORS[d.dutyType],
        borderColor: DUTY_COLORS[d.dutyType],
        extendedProps: { type: 'duty', duty: d },
        editable: true,
      }));

      const bookingEvents: EventInput[] = (bookingsData.bookings ?? []).map((row: { booking: { id: string; staffId: string; startTime: string; endTime: string }; service: { name: string } | null; staffMember: { id: string } | null; client: { name: string } | null }) => {
        const staffIdx = staffList.findIndex(s => s.id === (row.staffMember?.id ?? ''));
        const color = STAFF_COLORS[staffIdx % STAFF_COLORS.length] ?? '#64748b';
        return {
          id: `booking-${row.booking.id}`,
          title: `📅 ${row.client?.name ?? 'Client'} — ${row.service?.name ?? 'Service'}`,
          start: row.booking.startTime,
          end: row.booking.endTime,
          backgroundColor: color,
          borderColor: color,
          extendedProps: { type: 'booking' },
          editable: false,
        };
      });

      setEvents([...dutyEvents, ...bookingEvents]);
    } catch {
      // silent fail — calendar stays at previous state
    }
  }, [staffList]);

  async function handleEventDrop(info: EventDropArg) {
    if (info.event.extendedProps.type !== 'duty') { info.revert(); return; }
    const dutyId = info.event.id.replace('duty-', '');
    const start = info.event.start!;
    const end = info.event.end!;
    const date = start.toISOString().slice(0, 10);
    const startTime = start.toTimeString().slice(0, 5);
    const endTime = end.toTimeString().slice(0, 5);
    try {
      await apiFetch(`/merchant/duties/${dutyId}`, {
        method: 'PATCH',
        body: JSON.stringify({ date, start_time: startTime, end_time: endTime }),
      });
    } catch {
      info.revert();
    }
  }

  async function handleEventResize(info: EventResizeDoneArg) {
    if (info.event.extendedProps.type !== 'duty') { info.revert(); return; }
    const dutyId = info.event.id.replace('duty-', '');
    const end = info.event.end!;
    const endTime = end.toTimeString().slice(0, 5);
    try {
      await apiFetch(`/merchant/duties/${dutyId}`, {
        method: 'PATCH',
        body: JSON.stringify({ end_time: endTime }),
      });
    } catch {
      info.revert();
    }
  }

  function handleEventClick(info: EventClickArg) {
    if (info.event.extendedProps.type !== 'duty') return;
    const duty = info.event.extendedProps.duty as DutyBlock;
    setEditDuty(duty);
    setError(null);
    setForm({
      staffId: duty.staffId,
      date: duty.date,
      startTime: duty.startTime,
      endTime: duty.endTime,
      dutyType: duty.dutyType,
      notes: duty.notes ?? '',
    });
    setShowModal(true);
  }

  function handleDateClick(info: { dateStr: string }) {
    setEditDuty(null);
    setError(null);
    setForm({ staffId: staffList[0]?.id ?? '', date: info.dateStr.slice(0, 10), startTime: '09:00', endTime: '17:00', dutyType: 'floor', notes: '' });
    setShowModal(true);
  }

  async function handleSave() {
    setError(null);
    try {
      if (editDuty) {
        await apiFetch(`/merchant/duties/${editDuty.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ date: form.date, start_time: form.startTime, end_time: form.endTime, duty_type: form.dutyType, notes: form.notes }),
        });
      } else {
        await apiFetch('/merchant/duties', {
          method: 'POST',
          body: JSON.stringify({ staff_id: form.staffId, date: form.date, start_time: form.startTime, end_time: form.endTime, duty_type: form.dutyType, notes: form.notes }),
        });
      }
      setShowModal(false);
      if (dateRange) loadEvents(dateRange.start, dateRange.end);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save duty block');
    }
  }

  async function handleDelete() {
    if (!editDuty) return;
    setError(null);
    try {
      await apiFetch(`/merchant/duties/${editDuty.id}`, { method: 'DELETE' });
      setShowModal(false);
      if (dateRange) loadEvents(dateRange.start, dateRange.end);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete duty block');
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Staff Roster</h1>
        <button
          onClick={() => { setEditDuty(null); setError(null); setForm({ staffId: staffList[0]?.id ?? '', date: new Date().toISOString().slice(0, 10), startTime: '09:00', endTime: '17:00', dutyType: 'floor', notes: '' }); setShowModal(true); }}
          className="px-4 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-lg hover:bg-indigo-700 transition-colors"
        >
          + Add Duty Block
        </button>
      </div>

      <div className="flex gap-3 text-xs">
        {Object.entries(DUTY_COLORS).map(([type, color]) => (
          <span key={type} className="flex items-center gap-1">
            <span className="w-3 h-3 rounded-sm inline-block" style={{ backgroundColor: color }} />
            {type.charAt(0).toUpperCase() + type.slice(1)}
          </span>
        ))}
        <span className="flex items-center gap-1 ml-2 text-gray-400">📅 = booking (read-only)</span>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <FullCalendar
          plugins={[timeGridPlugin, interactionPlugin]}
          initialView="timeGridWeek"
          headerToolbar={{ left: 'prev,next today', center: 'title', right: 'timeGridWeek,timeGridDay' }}
          events={events}
          editable={true}
          selectable={true}
          eventDrop={handleEventDrop}
          eventResize={handleEventResize}
          eventClick={handleEventClick}
          dateClick={handleDateClick}
          datesSet={(info) => {
            setDateRange({ start: info.startStr, end: info.endStr });
            loadEvents(info.startStr, info.endStr);
          }}
          height="auto"
          slotMinTime="07:00:00"
          slotMaxTime="22:00:00"
        />
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6 space-y-4">
            <h2 className="text-lg font-semibold">{editDuty ? 'Edit Duty Block' : 'Add Duty Block'}</h2>

            {!editDuty && (
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Staff Member</label>
                <select value={form.staffId} onChange={e => setForm(f => ({ ...f, staffId: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">
                  {staffList.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Date</label>
              <input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Start Time</label>
                <input type="time" value={form.startTime} onChange={e => setForm(f => ({ ...f, startTime: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">End Time</label>
                <input type="time" value={form.endTime} onChange={e => setForm(f => ({ ...f, endTime: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Duty Type</label>
              <select value={form.dutyType} onChange={e => setForm(f => ({ ...f, dutyType: e.target.value as DutyBlock['dutyType'] }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">
                <option value="floor">Floor</option>
                <option value="treatment">Treatment</option>
                <option value="break">Break</option>
                <option value="other">Other</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Notes (optional)</label>
              <input type="text" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" placeholder="e.g. Front desk coverage" />
            </div>

            {error && <p className="text-xs text-red-600">{error}</p>}

            <div className="flex gap-2 pt-2">
              <button onClick={handleSave} className="flex-1 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-lg hover:bg-indigo-700">Save</button>
              {editDuty && <button onClick={handleDelete} className="py-2 px-4 bg-red-50 text-red-600 text-sm font-semibold rounded-lg hover:bg-red-100">Delete</button>}
              <button onClick={() => { setShowModal(false); setError(null); }} className="py-2 px-4 bg-gray-100 text-gray-700 text-sm font-semibold rounded-lg hover:bg-gray-200">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
