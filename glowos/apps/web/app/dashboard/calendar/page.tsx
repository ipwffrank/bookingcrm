'use client';

import { useEffect, useState, useCallback } from 'react';
import FullCalendar from '@fullcalendar/react';
import timeGridPlugin from '@fullcalendar/timegrid';
import dayGridPlugin from '@fullcalendar/daygrid';
import type { EventInput, EventClickArg } from '@fullcalendar/core';
import { apiFetch } from '../../lib/api';

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

interface StaffMember {
  id: string;
  name: string;
}

// Raw shape returned by /merchant/bookings — nested objects per join
interface BookingRow {
  booking: {
    id: string;
    staffId: string | null;
    startTime: string;
    endTime: string;
    status: string;
  };
  service: { name: string } | null;
  staffMember: { name: string } | null;
  client: { name: string | null } | null;
}

const STAFF_COLORS = ['#4f46e5', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];
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

export default function CalendarPage() {
  const [staffList, setStaffList] = useState<StaffMember[]>([]);
  const [events, setEvents] = useState<EventInput[]>([]);
  const [filterStaffId, setFilterStaffId] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [selected, setSelected] = useState<Booking | null>(null);
  const [dateRange, setDateRange] = useState<{ start: string; end: string } | null>(null);

  useEffect(() => {
    apiFetch('/merchant/staff')
      .then((data: { staff: StaffMember[] }) => setStaffList(data.staff ?? []))
      .catch(() => {});
  }, []);

  const loadBookings = useCallback(async (start: string, end: string) => {
    const from = start.slice(0, 10);
    const to = end.slice(0, 10);
    // The API only supports ?date= (single day), ?status=, ?staff_id=.
    // We pass from/to anyway — they are silently ignored server-side, returning
    // all bookings for the merchant. Status and staff_id filters ARE supported.
    let url = `/merchant/bookings?from=${from}&to=${to}`;
    if (filterStaffId) url += `&staff_id=${filterStaffId}`;
    if (filterStatus) url += `&status=${filterStatus}`;

    try {
      const data = await apiFetch(url);
      const bookings: Booking[] = normaliseBookings(data.bookings ?? []);

      const staffColorMap: Record<string, string> = {};
      staffList.forEach((s, i) => { staffColorMap[s.id] = STAFF_COLORS[i % STAFF_COLORS.length]!; });

      setEvents(bookings.map(b => ({
        id: b.id,
        title: `${b.clientName ?? 'Client'} — ${b.serviceName ?? 'Service'}`,
        start: b.startTime,
        end: b.endTime,
        backgroundColor: b.staffId ? (staffColorMap[b.staffId] ?? '#64748b') : '#64748b',
        borderColor: 'transparent',
        extendedProps: { booking: b },
        editable: false,
      })));
    } catch {
      // silent fail
    }
  }, [filterStaffId, filterStatus, staffList]);

  useEffect(() => {
    if (dateRange) loadBookings(dateRange.start, dateRange.end);
  }, [filterStaffId, filterStatus, dateRange, loadBookings]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">All Bookings</h1>
      </div>

      <div className="flex gap-3 flex-wrap">
        <select value={filterStaffId} onChange={e => setFilterStaffId(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm">
          <option value="">All Staff</option>
          {staffList.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm">
          <option value="">All Statuses</option>
          {Object.entries(STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>

      <div className="flex gap-2 flex-wrap text-xs">
        {staffList.slice(0, 7).map((s, i) => (
          <span key={s.id} className="flex items-center gap-1">
            <span className="w-3 h-3 rounded-sm inline-block" style={{ backgroundColor: STAFF_COLORS[i % STAFF_COLORS.length] }} />
            {s.name}
          </span>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <FullCalendar
          plugins={[timeGridPlugin, dayGridPlugin]}
          initialView="timeGridWeek"
          headerToolbar={{ left: 'prev,next today', center: 'title', right: 'dayGridMonth,timeGridWeek,timeGridDay' }}
          events={events}
          editable={false}
          eventClick={(info: EventClickArg) => setSelected(info.event.extendedProps.booking as Booking)}
          datesSet={(info) => {
            setDateRange({ start: info.startStr, end: info.endStr });
            loadBookings(info.startStr, info.endStr);
          }}
          height="auto"
          slotMinTime="07:00:00"
          slotMaxTime="22:00:00"
        />
      </div>

      {selected && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6 space-y-3">
            <h2 className="text-lg font-semibold">Booking Details</h2>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-gray-500">Client</span><span className="font-medium">{selected.clientName ?? '—'}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Service</span><span className="font-medium">{selected.serviceName ?? '—'}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Staff</span><span className="font-medium">{selected.staffName ?? '—'}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Status</span><span className="font-medium">{STATUS_LABELS[selected.status] ?? selected.status}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Start</span><span className="font-medium">{new Date(selected.startTime).toLocaleString()}</span></div>
            </div>
            <button onClick={() => setSelected(null)} className="w-full py-2 bg-gray-100 text-gray-700 text-sm font-semibold rounded-lg hover:bg-gray-200">Close</button>
          </div>
        </div>
      )}
    </div>
  );
}
