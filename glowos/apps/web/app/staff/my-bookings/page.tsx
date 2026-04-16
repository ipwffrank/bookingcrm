'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '../../lib/api';

interface Booking {
  id: string;
  startTime: string;
  endTime: string;
  status: string;
  clientName: string | null;
  clientPhone: string | null;
  serviceName: string | null;
  priceSgd: string | null;
}

const STATUS_COLORS: Record<string, string> = {
  confirmed: 'bg-blue-50 text-blue-700',
  completed: 'bg-green-50 text-green-700',
  cancelled: 'bg-red-50 text-red-600',
  no_show: 'bg-gray-100 text-gray-600',
  in_progress: 'bg-amber-50 text-amber-700',
};

export default function StaffMyBookingsPage() {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch('/staff/my-bookings')
      .then((data: { bookings: Booking[] }) => setBookings(data.bookings ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="flex items-center justify-center py-16"><div className="w-6 h-6 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" /></div>;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-gray-900">My Bookings</h1>
      {bookings.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <p className="text-gray-500 text-sm">No upcoming bookings assigned to you.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {bookings.map(b => (
            <div key={b.id} className="bg-white rounded-xl border border-gray-200 p-4">
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-semibold text-gray-900">{b.clientName ?? 'Unknown Client'}</p>
                  <p className="text-sm text-gray-600">{b.serviceName}</p>
                  {b.clientPhone && <p className="text-xs text-gray-400 mt-0.5">{b.clientPhone}</p>}
                </div>
                <span className={`text-xs font-semibold px-2 py-1 rounded-full capitalize ${STATUS_COLORS[b.status] ?? 'bg-gray-100 text-gray-600'}`}>
                  {b.status.replace('_', ' ')}
                </span>
              </div>
              <div className="mt-2 flex items-center gap-3 text-xs text-gray-500">
                <span>{new Date(b.startTime).toLocaleDateString('en-SG', { weekday: 'short', day: 'numeric', month: 'short' })}</span>
                <span>{new Date(b.startTime).toLocaleTimeString('en-SG', { hour: '2-digit', minute: '2-digit' })} — {new Date(b.endTime).toLocaleTimeString('en-SG', { hour: '2-digit', minute: '2-digit' })}</span>
                {b.priceSgd && <span>S${parseFloat(b.priceSgd).toFixed(2)}</span>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
