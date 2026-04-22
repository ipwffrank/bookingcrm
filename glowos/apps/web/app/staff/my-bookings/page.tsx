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
  confirmed: 'bg-grey-5 text-tone-ink',
  completed: 'bg-tone-sage/5 text-tone-sage',
  cancelled: 'bg-semantic-danger/5 text-semantic-danger',
  no_show: 'bg-grey-15 text-grey-75',
  in_progress: 'bg-semantic-warn/5 text-semantic-warn',
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

  if (loading) return <div className="flex items-center justify-center py-16"><div className="w-6 h-6 border-2 border-tone-ink border-t-transparent rounded-full animate-spin" /></div>;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-tone-ink">My Bookings</h1>
      {bookings.length === 0 ? (
        <div className="bg-tone-surface rounded-xl border border-grey-15 p-12 text-center">
          <p className="text-grey-60 text-sm">No upcoming bookings assigned to you.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {bookings.map(b => (
            <div key={b.id} className="bg-tone-surface rounded-xl border border-grey-15 p-4">
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-semibold text-tone-ink">{b.clientName ?? 'Unknown Client'}</p>
                  <p className="text-sm text-grey-75">{b.serviceName}</p>
                  {b.clientPhone && <p className="text-xs text-grey-45 mt-0.5">{b.clientPhone}</p>}
                </div>
                <span className={`text-xs font-semibold px-2 py-1 rounded-full capitalize ${STATUS_COLORS[b.status] ?? 'bg-grey-15 text-grey-75'}`}>
                  {b.status.replace('_', ' ')}
                </span>
              </div>
              <div className="mt-2 flex items-center gap-3 text-xs text-grey-60">
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
