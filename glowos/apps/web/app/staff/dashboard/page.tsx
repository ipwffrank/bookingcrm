'use client';

import { useCallback, useState } from 'react';
import FullCalendar from '@fullcalendar/react';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';
import type { EventInput, EventDropArg, EventClickArg, DatesSetArg } from '@fullcalendar/core';
import type { EventResizeDoneArg } from '@fullcalendar/interaction';
import { apiFetch } from '../../lib/api';

interface DutyBlock {
  id: string;
  staffId: string;
  date: string;
  startTime: string;
  endTime: string;
  dutyType: 'floor' | 'treatment' | 'break' | 'other';
  notes: string | null;
}

interface MyBooking {
  id: string;
  startTime: string;
  endTime: string;
  clientName: string | null;
  serviceName: string | null;
  status: string;
}

const DUTY_BG = '#1a2313'; // single brand colour for all duty blocks

export default function StaffSchedulePage() {
  const [events, setEvents] = useState<EventInput[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [editDuty, setEditDuty] = useState<DutyBlock | null>(null);
  const [form, setForm] = useState({ date: '', startTime: '09:00', endTime: '17:00', notes: '' });
  const [dateRange, setDateRange] = useState<{ start: string; end: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadEvents = useCallback(async (start: string, end: string) => {
    const from = start.slice(0, 10);
    const to = end.slice(0, 10);

    try {
      const [dutiesData, bookingsData] = await Promise.all([
        apiFetch(`/merchant/duties?from=${from}&to=${to}`),
        apiFetch('/staff/my-bookings').catch(() => ({ bookings: [] })),
      ]);

      const dutyEvents: EventInput[] = (dutiesData.duties ?? []).map((d: DutyBlock) => ({
        id: `duty-${d.id}`,
        title: d.notes ?? 'Block',
        start: `${d.date}T${d.startTime}`,
        end: `${d.date}T${d.endTime}`,
        backgroundColor: DUTY_BG,
        borderColor: DUTY_BG,
        textColor: '#ffffff',
        extendedProps: { type: 'duty', duty: d },
        editable: true,
      }));

      const bookingEvents: EventInput[] = (bookingsData.bookings ?? []).map((b: MyBooking) => ({
        id: `booking-${b.id}`,
        title: `📅 ${b.clientName ?? 'Client'} — ${b.serviceName ?? ''}`,
        start: b.startTime,
        end: b.endTime,
        backgroundColor: '#0ea5e9',
        borderColor: 'transparent',
        extendedProps: { type: 'booking' },
        editable: false,
      }));

      setEvents([...dutyEvents, ...bookingEvents]);
    } catch {
      // silent fail
    }
  }, []);

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

  function handleEventClick(info: EventClickArg) {
    if (info.event.extendedProps.type !== 'duty') return;
    const duty = info.event.extendedProps.duty as DutyBlock;
    setEditDuty(duty);
    setForm({ date: duty.date, startTime: duty.startTime, endTime: duty.endTime, notes: duty.notes ?? '' });
    setShowModal(true);
    setError(null);
  }

  function handleDateClick(info: { dateStr: string }) {
    setEditDuty(null);
    setForm({ date: info.dateStr.slice(0, 10), startTime: '09:00', endTime: '17:00', notes: '' });
    setShowModal(true);
    setError(null);
  }

  async function handleSave() {
    setError(null);
    try {
      if (editDuty) {
        await apiFetch(`/merchant/duties/${editDuty.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ date: form.date, start_time: form.startTime, end_time: form.endTime, notes: form.notes }),
        });
      } else {
        await apiFetch('/merchant/duties/my', {
          method: 'POST',
          body: JSON.stringify({ date: form.date, start_time: form.startTime, end_time: form.endTime, duty_type: 'floor', notes: form.notes }),
        });
      }
      setShowModal(false);
      if (dateRange) loadEvents(dateRange.start, dateRange.end);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    }
  }

  return (
    <div className="space-y-4 font-manrope">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">My Schedule</h1>
          <p className="text-xs text-gray-400 mt-0.5">Dark blocks = your schedule &nbsp;·&nbsp; Coloured = your bookings</p>
        </div>
        <button
          onClick={() => { setEditDuty(null); setForm({ date: new Date().toISOString().slice(0, 10), startTime: '09:00', endTime: '17:00', notes: '' }); setShowModal(true); setError(null); }}
          className="px-4 py-2 bg-[#1a2313] text-white text-sm font-medium rounded-lg hover:bg-[#2f3827] transition-colors"
        >
          + Add Block
        </button>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <FullCalendar
          plugins={[timeGridPlugin, interactionPlugin]}
          initialView="timeGridWeek"
          headerToolbar={{ left: 'prev,next today', center: 'title', right: 'timeGridWeek,timeGridDay' }}
          events={events}
          editable={true}
          selectable={true}
          eventResizableFromStart={true}
          eventDrop={handleEventDrop}
          eventResize={handleEventResize}
          eventClick={handleEventClick}
          dateClick={handleDateClick}
          datesSet={(info: DatesSetArg) => { setDateRange({ start: info.startStr, end: info.endStr }); loadEvents(info.startStr, info.endStr); }}
          height="auto"
          slotMinTime="07:00:00"
          slotMaxTime="22:00:00"
        />
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6 space-y-4 font-manrope">
            <h2 className="text-base font-semibold text-gray-900">{editDuty ? 'Edit Block' : 'Add Block'}</h2>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Date</label>
              <input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#1a2313]/30" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Start</label>
                <input type="time" value={form.startTime} onChange={e => setForm(f => ({ ...f, startTime: e.target.value }))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#1a2313]/30" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">End</label>
                <input type="time" value={form.endTime} onChange={e => setForm(f => ({ ...f, endTime: e.target.value }))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#1a2313]/30" />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Notes (optional)</label>
              <input type="text" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#1a2313]/30" placeholder="e.g. Lunch break" />
            </div>
            {error && <p className="text-xs text-red-600">{error}</p>}
            <div className="flex gap-2">
              <button onClick={handleSave} className="flex-1 py-2 bg-[#1a2313] text-white text-sm font-medium rounded-lg hover:bg-[#2f3827] transition-colors">Save</button>
              <button onClick={() => setShowModal(false)} className="py-2 px-4 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-200 transition-colors">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
