'use client';

import { useCallback, useState } from 'react';
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

// API returns nested objects — normalise to flat Booking
function normaliseBookings(rows: Array<{
  booking: { id: string; staffId: string | null; startTime: string; endTime: string; status: string };
  service: { name: string } | null;
  staffMember: { id: string; name: string } | null;
  client: { name: string } | null;
}>): Booking[] {
  return rows.map(r => ({
    id: r.booking.id,
    staffId: r.booking.staffId,
    startTime: r.booking.startTime,
    endTime: r.booking.endTime,
    status: r.booking.status,
    clientName: r.client?.name ?? null,
    serviceName: r.service?.name ?? null,
    staffName: r.staffMember?.name ?? null,
  }));
}

const COLORS = ['#4f46e5', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'];

export default function StaffAllBookingsPage() {
  const [events, setEvents] = useState<EventInput[]>([]);
  const [selected, setSelected] = useState<Booking | null>(null);
  const [staffColorMap] = useState<Record<string, string>>({});
  const [colorIdx] = useState({ value: 0 });

  const loadBookings = useCallback(async (start: string, end: string) => {
    const from = start.slice(0, 10);
    const to = end.slice(0, 10);
    try {
      const data = await apiFetch(`/staff/bookings?from=${from}&to=${to}`);
      const bookings = normaliseBookings(data.bookings ?? []);

      setEvents(bookings.map(b => {
        if (b.staffId && !staffColorMap[b.staffId]) {
          staffColorMap[b.staffId] = COLORS[colorIdx.value++ % COLORS.length]!;
        }
        return {
          id: b.id,
          title: `${b.clientName ?? 'Client'} — ${b.serviceName ?? ''}`,
          start: b.startTime,
          end: b.endTime,
          backgroundColor: b.staffId ? (staffColorMap[b.staffId] ?? '#64748b') : '#64748b',
          borderColor: 'transparent',
          extendedProps: { booking: b },
          editable: false,
        };
      }));
    } catch {
      // silent fail
    }
  }, [staffColorMap, colorIdx]);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-gray-900">All Bookings</h1>
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <FullCalendar
          plugins={[timeGridPlugin, dayGridPlugin]}
          initialView="timeGridWeek"
          headerToolbar={{ left: 'prev,next today', center: 'title', right: 'dayGridMonth,timeGridWeek,timeGridDay' }}
          events={events}
          editable={false}
          eventClick={(info: EventClickArg) => setSelected(info.event.extendedProps.booking as Booking)}
          datesSet={(info) => loadBookings(info.startStr, info.endStr)}
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
              <div className="flex justify-between"><span className="text-gray-500">Client</span><span>{selected.clientName ?? '—'}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Service</span><span>{selected.serviceName ?? '—'}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Staff</span><span>{selected.staffName ?? '—'}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Time</span><span>{new Date(selected.startTime).toLocaleString()}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Status</span><span className="capitalize">{selected.status.replace('_', ' ')}</span></div>
            </div>
            <button onClick={() => setSelected(null)} className="w-full py-2 bg-gray-100 text-sm font-semibold rounded-lg">Close</button>
          </div>
        </div>
      )}
    </div>
  );
}
