'use client';

import { useEffect, useState, useCallback } from 'react';
import { apiFetch } from '../lib/api';
import DashboardShell from '../components/DashboardShell';

type BookingStatus = 'confirmed' | 'in_progress' | 'completed' | 'cancelled' | 'no_show';
type PaymentStatus = 'pending' | 'paid' | 'refunded' | 'failed';

interface BookingRow {
  booking: {
    id: string;
    startTime: string;
    endTime: string;
    status: BookingStatus;
    paymentStatus: PaymentStatus;
    priceSgd: string;
  };
  service: { name: string; durationMinutes: number };
  staffMember: { name: string };
  client: { name: string | null; phone: string };
}

const STATUS_STYLES: Record<BookingStatus, string> = {
  confirmed: 'bg-green-100 text-green-700',
  in_progress: 'bg-blue-100 text-blue-700',
  completed: 'bg-gray-100 text-gray-600',
  cancelled: 'bg-red-100 text-red-600',
  no_show: 'bg-orange-100 text-orange-700',
};

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-SG', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

export default function BookingsPage() {
  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const [status, setStatus] = useState('');
  const [rows, setRows] = useState<BookingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchBookings = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ date });
      if (status) params.append('status', status);
      const res = (await apiFetch(`/booking/merchant?${params.toString()}`)) as { bookings: BookingRow[] };
      setRows(res.bookings);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load bookings');
    } finally {
      setLoading(false);
    }
  }, [date, status]);

  useEffect(() => {
    void fetchBookings();
  }, [fetchBookings]);

  return (
    <DashboardShell>
      <div className="max-w-5xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Bookings</h1>
          <p className="text-gray-500 text-sm mt-0.5">View and manage appointments</p>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-3">
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="">All statuses</option>
            <option value="confirmed">Confirmed</option>
            <option value="in_progress">In Progress</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
            <option value="no_show">No Show</option>
          </select>
        </div>

        {loading && (
          <div className="flex justify-center py-16">
            <div className="w-8 h-8 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin" />
          </div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-600">
            {error}
          </div>
        )}

        {!loading && !error && rows.length === 0 && (
          <div className="text-center py-16 text-gray-400">
            <div className="text-5xl mb-3">📅</div>
            <p>No bookings found for this date</p>
          </div>
        )}

        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          {rows.map((row, idx) => {
            const { booking, service, staffMember, client } = row;
            return (
              <div
                key={booking.id}
                className={`px-5 py-4 flex items-center gap-4 ${idx > 0 ? 'border-t border-gray-50' : ''}`}
              >
                <div className="w-16 shrink-0 text-sm font-semibold text-gray-500">
                  {formatTime(booking.startTime)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-gray-900 truncate">
                    {client.name ?? client.phone}
                  </div>
                  <div className="text-xs text-gray-500">
                    {service.name} · {staffMember.name} · {service.durationMinutes}min
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="text-sm font-medium text-gray-900">
                    SGD {parseFloat(booking.priceSgd).toFixed(2)}
                  </span>
                  <span
                    className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLES[booking.status]}`}
                  >
                    {booking.status.replace('_', ' ')}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </DashboardShell>
  );
}
