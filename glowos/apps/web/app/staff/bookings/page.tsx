'use client';

import { useCallback, useEffect, useState } from 'react';
import FullCalendar from '@fullcalendar/react';
import timeGridPlugin from '@fullcalendar/timegrid';
import dayGridPlugin from '@fullcalendar/daygrid';
import interactionPlugin from '@fullcalendar/interaction';
import type { EventInput, EventDropArg, EventClickArg, DatesSetArg } from '@fullcalendar/core';
import type { EventResizeDoneArg } from '@fullcalendar/interaction';
import { apiFetch } from '../../lib/api';
import { computeCalendarRange, type OperatingHoursMap } from '../../lib/operating-hours';

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

interface Closure {
  id: string;
  date: string;
  title: string;
  isFullDay: boolean;
  startTime: string | null;
  endTime: string | null;
}

// Single-palette chrome: ink for duties, sage for other staff's bookings
// (so the current staff member's context is still scannable), danger-tint
// for closures. Identity lives in the event title text, not the hue.
const DUTY_BG = '#1a2313';
const BOOKING_BG = '#6b8e5a';
const UNASSIGNED_BG = 'rgba(26, 35, 19, 0.55)';
const CLOSURE_BG = 'rgba(184, 64, 58, 0.08)';
const CLOSURE_BORDER = 'rgba(184, 64, 58, 0.25)';

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
  const [operatingHours, setOperatingHours]   = useState<OperatingHoursMap>(null);

  // Fetch merchant operating hours once — feeds the calendar's slot range so
  // this staff member sees a window tailored to their business's trading hours.
  useEffect(() => {
    apiFetch('/staff/me')
      .then((d: { merchant?: { operatingHours?: OperatingHoursMap } }) => {
        setOperatingHours(d.merchant?.operatingHours ?? null);
      })
      .catch(() => { /* fallback to defaults inside computeCalendarRange */ });
  }, []);

  const calendarRange = computeCalendarRange(operatingHours);

  const loadEvents = useCallback(async (start: string, end: string) => {
    const from = start.slice(0, 10);
    const to   = end.slice(0, 10);
    try {
      const [dutiesData, bookingsData, closuresData] = await Promise.all([
        apiFetch(`/merchant/duties?from=${from}&to=${to}`),
        apiFetch(`/staff/bookings?from=${from}&to=${to}`).catch(() => ({ bookings: [] })),
        apiFetch(`/merchant/closures?from=${from}&to=${to}`).catch(() => ({ closures: [] })),
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

      const bookingEvents: EventInput[] = ((bookingsData.bookings ?? []) as Booking[]).map((b) => ({
        id:              `booking-${b.id}`,
        title:           `${b.clientName ?? 'Client'} — ${b.serviceName ?? ''}`,
        start:           b.startTime,
        end:             b.endTime,
        backgroundColor: b.staffId ? BOOKING_BG : UNASSIGNED_BG,
        borderColor:     'transparent',
        textColor:       '#ffffff',
        extendedProps:   { type: 'booking', booking: b },
        editable:        false,
      }));

      const closureEvents: EventInput[] = ((closuresData.closures ?? []) as Closure[]).map((cl) => {
        if (cl.isFullDay) {
          return {
            id: `closure-${cl.id}`,
            title: `🚫 ${cl.title}`,
            start: cl.date,
            allDay: true,
            display: 'background',
            backgroundColor: CLOSURE_BG,
            borderColor: CLOSURE_BORDER,
            extendedProps: { type: 'closure' },
          };
        }
        return {
          id: `closure-${cl.id}`,
          title: `🚫 ${cl.title}`,
          start: `${cl.date}T${cl.startTime}`,
          end: `${cl.date}T${cl.endTime}`,
          display: 'background',
          backgroundColor: CLOSURE_BG,
          borderColor: CLOSURE_BORDER,
          extendedProps: { type: 'closure' },
        };
      });

      setEvents([...closureEvents, ...dutyEvents, ...bookingEvents]);
    } catch { /* silent fail */ }
  }, []);

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
      setDutyForm({ date: duty.date, startTime: duty.startTime.slice(0, 5), endTime: duty.endTime.slice(0, 5), notes: duty.notes ?? '' });
      setDutyError(null);
      setShowDutyModal(true);
    } else {
      setSelectedBooking(info.event.extendedProps.booking as Booking);
    }
  }

  function handleDateClick(info: { dateStr: string }) {
    // Check if date has a full-day closure
    const clickedDate = info.dateStr.slice(0, 10);
    const hasClosure = events.some(e =>
      e.extendedProps?.type === 'closure' &&
      typeof e.start === 'string' && e.start.startsWith(clickedDate) &&
      (e as any).allDay
    );
    if (hasClosure) return; // Don't allow duty creation on closed dates

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

  function renderEventContent(eventInfo: { event: { extendedProps: Record<string, unknown>; title: string }; timeText: string }) {
    if (eventInfo.event.extendedProps.type === 'closure') {
      return <div className="text-xs text-semantic-danger font-medium px-1">{eventInfo.event.title}</div>;
    }
    return (
      <div className="text-xs px-1 truncate">
        <span className="font-medium">{eventInfo.timeText}</span>{' '}
        <span>{eventInfo.event.title}</span>
      </div>
    );
  }

  return (
    <div className="space-y-4 font-manrope">
      <style>{`
        .fc { font-family: var(--font-body, 'Manrope', sans-serif); }
        .fc .fc-toolbar-title { font-size: 16px; font-weight: 600; color: var(--color-tone-ink); }
        .fc .fc-button { font-size: 13px; font-weight: 500; }
        .fc .fc-col-header-cell-cushion { font-size: 12px; font-weight: 600; color: var(--color-grey-75); text-transform: uppercase; letter-spacing: 0.025em; }
        .fc .fc-daygrid-day-number { font-size: 13px; font-weight: 500; color: var(--color-grey-75); }
        .fc .fc-timegrid-slot { border-bottom-color: var(--color-grey-15); }
        .fc .fc-timegrid-slot-minor { border-top: 1px dashed var(--color-grey-5) !important; }
        .fc .fc-timegrid-slot-label { font-size: 11px; font-weight: 600; color: var(--color-grey-75); }
        .fc .fc-timegrid-slot-label.fc-timegrid-slot-minor { font-size: 9px; font-weight: 400; color: var(--color-grey-45); }
        .fc .fc-timegrid-col { border-right: 1px solid var(--color-grey-15); }
        .fc .fc-event { border-radius: 6px; }
        .fc-direction-ltr .fc-daygrid-event.fc-event-end, .fc-direction-ltr .fc-daygrid-event.fc-event-start { margin-left: 2px; margin-right: 2px; }
      `}</style>

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-tone-ink">All Bookings</h1>
          <p className="text-xs text-grey-45 mt-0.5">Dark blocks = your schedule &nbsp;·&nbsp; Coloured = firm bookings</p>
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

      <div className="bg-tone-surface rounded-xl border border-grey-15 p-4">
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
          eventContent={renderEventContent}
          dateClick={handleDateClick}
          datesSet={(info: DatesSetArg) => {
            setDateRange({ start: info.startStr, end: info.endStr });
            loadEvents(info.startStr, info.endStr);
          }}
          height="auto"
          slotMinTime={calendarRange.slotMinTime}
          slotMaxTime={calendarRange.slotMaxTime}
        />
      </div>

      {/* ── Duty modal ── */}
      {showDutyModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-tone-surface rounded-xl shadow-xl w-full max-w-md p-6 space-y-4 font-manrope">
            <h2 className="text-base font-semibold text-tone-ink">{editDuty ? 'Edit Block' : 'Add Block'}</h2>
            <div>
              <label className="block text-xs font-medium text-grey-75 mb-1">Date</label>
              <input type="date" value={dutyForm.date} onChange={e => setDutyForm(f => ({ ...f, date: e.target.value }))} className="w-full border border-grey-15 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-tone-ink/30" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-grey-75 mb-1">Start</label>
                <input type="time" value={dutyForm.startTime} onChange={e => setDutyForm(f => ({ ...f, startTime: e.target.value }))} className="w-full border border-grey-15 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-tone-ink/30" />
              </div>
              <div>
                <label className="block text-xs font-medium text-grey-75 mb-1">End</label>
                <input type="time" value={dutyForm.endTime} onChange={e => setDutyForm(f => ({ ...f, endTime: e.target.value }))} className="w-full border border-grey-15 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-tone-ink/30" />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-grey-75 mb-1">Notes (optional)</label>
              <input type="text" value={dutyForm.notes} onChange={e => setDutyForm(f => ({ ...f, notes: e.target.value }))} className="w-full border border-grey-15 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-tone-ink/30" placeholder="e.g. Lunch break" />
            </div>
            {dutyError && <p className="text-xs text-semantic-danger">{dutyError}</p>}
            {editDuty && !isFutureDuty(editDuty.date, editDuty.startTime) && (
              <p className="text-xs text-grey-45">Past blocks cannot be edited or deleted.</p>
            )}
            <div className="flex gap-2">
              <button onClick={handleSaveDuty} disabled={dutySaving || (!!editDuty && !isFutureDuty(editDuty.date, editDuty.startTime))} className="flex-1 py-2 bg-[#1a2313] text-white text-sm font-medium rounded-lg hover:bg-[#2f3827] disabled:opacity-50 transition-colors">
                {dutySaving ? 'Saving…' : 'Save'}
              </button>
              {editDuty && isFutureDuty(editDuty.date, editDuty.startTime) && (
                <button onClick={handleDeleteDuty} disabled={deleting} className="py-2 px-4 bg-semantic-danger/5 text-semantic-danger text-sm font-medium rounded-lg hover:bg-semantic-danger/10 disabled:opacity-50 transition-colors">
                  {deleting ? '…' : 'Delete'}
                </button>
              )}
              <button onClick={() => setShowDutyModal(false)} className="py-2 px-4 bg-grey-15 text-grey-75 text-sm font-medium rounded-lg hover:bg-grey-15 transition-colors">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Booking detail modal ── */}
      {selectedBooking && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-tone-surface rounded-xl shadow-xl w-full max-w-sm p-6 space-y-3 font-manrope">
            <h2 className="text-base font-semibold text-tone-ink">Booking Details</h2>
            <div className="divide-y divide-grey-5">
              {([
                ['Client',  selectedBooking.clientName ?? '—'],
                ['Service', selectedBooking.serviceName ?? '—'],
                ['Staff',   selectedBooking.staffName ?? '—'],
                ['Time',    new Date(selectedBooking.startTime).toLocaleString('en-SG', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })],
                ['Status',  selectedBooking.status.replace('_', ' ')],
              ] as [string, string][]).map(([label, value]) => (
                <div key={label} className="flex justify-between py-2.5 text-sm">
                  <span className="text-xs font-medium text-grey-45 uppercase tracking-wide">{label}</span>
                  <span className="text-tone-ink font-medium capitalize">{value}</span>
                </div>
              ))}
            </div>
            <button onClick={() => setSelectedBooking(null)} className="w-full py-2 bg-grey-15 text-sm font-semibold rounded-lg hover:bg-grey-15 transition-colors">Close</button>
          </div>
        </div>
      )}
    </div>
  );
}
