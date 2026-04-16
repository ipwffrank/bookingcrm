'use client';

import { useCallback, useState } from 'react';
import FullCalendar from '@fullcalendar/react';
import timeGridPlugin from '@fullcalendar/timegrid';
import dayGridPlugin from '@fullcalendar/daygrid';
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

const DUTY_BG = '#1a2313';
const COLORS = ['#4f46e5', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'];

function localDateStr(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function localTimeStr(d: Date) {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
function isFutureDuty(date: string, startTime: string): boolean {
  const today = localDateStr(new Date());
  if (date > today) return true;
  if (date < today) return false;
  return startTime > localTimeStr(new Date());
}

export default function StaffAllBookingsPage() {
  const [events, setEvents]             = useState<EventInput[]>([]);
  const [dateRange, setDateRange]       = useState<{ start: string; end: string } | null>(null);
  const [selectedBooking, setSelectedBooking] = useState<Booking | null>(null);
  const [showDutyModal, setShowDutyModal]     = useState(false);
  const [editDuty, setEditDuty]               = useState<DutyBlock | null>(null);
  const [dutyForm, setDutyForm]               = useState({ date: '', startTime: '09:00', endTime: '17:00', notes: '' });
  const [dutyError, setDutyError]             = useState<string | null>(null);
  const [dutySaving, setDutySaving]           = useState(false);
  const [deleting, setDeleting]               = useState(false);
  const [staffColorMap]                       = useState<Record<string, string>>({});
  const [colorIdx]                            = useState({ value: 0 });

  const loadEvents = useCallback(async (start: string, end: string) => {
    const from = start.slice(0, 10);
    const to   = end.slice(0, 10);
    try {
      const [dutiesData, bookingsData] = await Promise.all([
        apiFetch(`/merchant/duties?from=${from}&to=${to}`),
        apiFetch(`/staff/bookings?from=${from}&to=${to}`).catch(() => ({ bookings: [] })),
      ]);

      const dutyEvents: EventInput[] = (dutiesData.duties ?? []).map((d: DutyBlock) => ({
        id:              `duty-${d.id}`,
        title:           d.notes ?? 'My Block',
        start:           `${d.date}T${d.startTime}`,
        end:             `${d.date}T${d.endTime}`,
        backgroundColor: DUTY_BG,
        borderColor:     DUTY_BG,
        textColor:       '#ffffff',
        extendedProps:   { type: 'duty', duty: d },
        editable:        true,
      }));

      const bookingEvents: EventInput[] = ((bookingsData.bookings ?? []) as Booking[]).map((b) => {
        if (b.staffId && !staffColorMap[b.staffId]) {
          staffColorMap[b.staffId] = COLORS[colorIdx.value++ % COLORS.length]!;
        }
        return {
          id:              `booking-${b.id}`,
          title:           `${b.clientName ?? 'Client'} — ${b.serviceName ?? ''}`,
          start:           b.startTime,
          end:             b.endTime,
          backgroundColor: b.staffId ? (staffColorMap[b.staffId] ?? '#64748b') : '#64748b',
          borderColor:     'transparent',
          extendedProps:   { type: 'booking', booking: b },
          editable:        false,
        };
      });

      setEvents([...dutyEvents, ...bookingEvents]);
    } catch { /* silent fail */ }
  }, [staffColorMap, colorIdx]);

  async function handleEventDrop(info: EventDropArg) {
    if (info.event.extendedProps.type !== 'duty') { info.revert(); return; }
    const start  = info.event.start!;
    const end    = info.event.end ?? new Date(start.getTime() + 60 * 60 * 1000);
    const dutyId = info.event.id.replace('duty-', '');
    try {
      await apiFetch(`/merchant/duties/${dutyId}`, {
        method: 'PATCH',
        body: JSON.stringify({ date: localDateStr(start), start_time: localTimeStr(start), end_time: localTimeStr(end) }),
      });
    } catch { info.revert(); }
  }

  async function handleEventResize(info: EventResizeDoneArg) {
    if (info.event.extendedProps.type !== 'duty') { info.revert(); return; }
    const start  = info.event.start!;
    const end    = info.event.end!;
    const dutyId = info.event.id.replace('duty-', '');
    try {
      await apiFetch(`/merchant/duties/${dutyId}`, {
        method: 'PATCH',
        body: JSON.stringify({ date: localDateStr(start), start_time: localTimeStr(start), end_time: localTimeStr(end) }),
      });
    } catch { info.revert(); }
  }

  function handleEventClick(info: EventClickArg) {
    if (info.event.extendedProps.type === 'duty') {
      const duty = info.event.extendedProps.duty as DutyBlock;
      setEditDuty(duty);
      setDutyForm({ date: duty.date, startTime: duty.startTime, endTime: duty.endTime, notes: duty.notes ?? '' });
      setDutyError(null);
      setShowDutyModal(true);
    } else {
      setSelectedBooking(info.event.extendedProps.booking as Booking);
    }
  }

  function handleDateClick(info: { dateStr: string }) {
    setEditDuty(null);
    setDutyForm({ date: info.dateStr.slice(0, 10), startTime: '09:00', endTime: '17:00', notes: '' });
    setDutyError(null);
    setShowDutyModal(true);
  }

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
        await apiFetch('/merchant/duties/my', {
          method: 'POST',
          body: JSON.stringify({ date: dutyForm.date, start_time: dutyForm.startTime, end_time: dutyForm.endTime, duty_type: 'floor', notes: dutyForm.notes }),
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
    setDeleting(true);
    setDutyError(null);
    try {
      await apiFetch(`/merchant/duties/${editDuty.id}`, { method: 'DELETE' });
      setShowDutyModal(false);
      if (dateRange) loadEvents(dateRange.start, dateRange.end);
    } catch (err) {
      setDutyError(err instanceof Error ? err.message : 'Failed to delete');
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-4 font-manrope">
      <style>{`
        .fc .fc-timegrid-slot { border-bottom-color: #d1d5db; }
        .fc .fc-timegrid-slot-minor { border-top: 1px dashed #e5e7eb !important; }
        .fc .fc-timegrid-slot-label { font-size: 11px; font-weight: 600; color: #374151; }
        .fc .fc-timegrid-slot-label.fc-timegrid-slot-minor { font-size: 9px; font-weight: 400; color: #9ca3af; }
        .fc .fc-timegrid-col { border-right: 1px solid #e5e7eb; }
      `}</style>

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">All Bookings</h1>
          <p className="text-xs text-gray-400 mt-0.5">Dark blocks = your schedule &nbsp;·&nbsp; Coloured = firm bookings</p>
        </div>
        <button
          onClick={() => {
            setEditDuty(null);
            setDutyForm({ date: localDateStr(new Date()), startTime: '09:00', endTime: '17:00', notes: '' });
            setDutyError(null);
            setShowDutyModal(true);
          }}
          className="px-4 py-2 bg-[#1a2313] text-white text-sm font-medium rounded-lg hover:bg-[#2f3827] transition-colors"
        >
          + Add Block
        </button>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <FullCalendar
          plugins={[timeGridPlugin, dayGridPlugin, interactionPlugin]}
          initialView="timeGridWeek"
          headerToolbar={{ left: 'prev,next today', center: 'title', right: 'dayGridMonth,timeGridWeek,timeGridDay' }}
          events={events}
          editable={true}
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

      {/* ── Duty modal ── */}
      {showDutyModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6 space-y-4 font-manrope">
            <h2 className="text-base font-semibold text-gray-900">{editDuty ? 'Edit Block' : 'Add Block'}</h2>
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
              <input type="text" value={dutyForm.notes} onChange={e => setDutyForm(f => ({ ...f, notes: e.target.value }))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#1a2313]/30" placeholder="e.g. Lunch break" />
            </div>
            {dutyError && <p className="text-xs text-red-600">{dutyError}</p>}
            <div className="flex gap-2">
              <button onClick={handleSaveDuty} disabled={dutySaving} className="flex-1 py-2 bg-[#1a2313] text-white text-sm font-medium rounded-lg hover:bg-[#2f3827] disabled:opacity-50 transition-colors">
                {dutySaving ? 'Saving…' : 'Save'}
              </button>
              {editDuty && isFutureDuty(editDuty.date, editDuty.startTime) && (
                <button onClick={handleDeleteDuty} disabled={deleting} className="py-2 px-4 bg-red-50 text-red-600 text-sm font-medium rounded-lg hover:bg-red-100 disabled:opacity-50 transition-colors">
                  {deleting ? '…' : 'Delete'}
                </button>
              )}
              <button onClick={() => setShowDutyModal(false)} className="py-2 px-4 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-200 transition-colors">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Booking detail modal ── */}
      {selectedBooking && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6 space-y-3 font-manrope">
            <h2 className="text-base font-semibold text-gray-900">Booking Details</h2>
            <div className="divide-y divide-gray-50">
              {([
                ['Client',  selectedBooking.clientName ?? '—'],
                ['Service', selectedBooking.serviceName ?? '—'],
                ['Staff',   selectedBooking.staffName ?? '—'],
                ['Time',    new Date(selectedBooking.startTime).toLocaleString('en-SG', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })],
                ['Status',  selectedBooking.status.replace('_', ' ')],
              ] as [string, string][]).map(([label, value]) => (
                <div key={label} className="flex justify-between py-2.5 text-sm">
                  <span className="text-xs font-medium text-gray-400 uppercase tracking-wide">{label}</span>
                  <span className="text-gray-900 font-medium capitalize">{value}</span>
                </div>
              ))}
            </div>
            <button onClick={() => setSelectedBooking(null)} className="w-full py-2 bg-gray-100 text-sm font-semibold rounded-lg hover:bg-gray-200 transition-colors">Close</button>
          </div>
        </div>
      )}
    </div>
  );
}
