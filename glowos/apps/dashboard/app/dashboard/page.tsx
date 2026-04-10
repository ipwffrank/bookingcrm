'use client';

import { useEffect, useState, useCallback } from 'react';
import { apiFetch } from '../lib/api';
import { useAuth } from '../lib/auth';
import DashboardShell from '../components/DashboardShell';
import WalkInModal from '../components/WalkInModal';

type BookingStatus = 'confirmed' | 'in_progress' | 'completed' | 'cancelled' | 'no_show';
type PaymentStatus = 'pending' | 'paid' | 'refunded' | 'failed';
type VipTier = 'bronze' | 'silver' | 'gold' | 'platinum';

interface BookingRow {
  booking: {
    id: string;
    startTime: string;
    status: BookingStatus;
    paymentStatus: PaymentStatus;
    priceSgd: string;
    clientNotes: string | null;
  };
  service: { name: string };
  staffMember: { name: string };
  client: { name: string | null; phone: string; vipTier?: VipTier };
}

const STATUS_STYLES: Record<BookingStatus, string> = {
  confirmed: 'bg-green-100 text-green-700',
  in_progress: 'bg-blue-100 text-blue-700',
  completed: 'bg-gray-100 text-gray-600',
  cancelled: 'bg-red-100 text-red-600',
  no_show: 'bg-orange-100 text-orange-700',
};

const STATUS_LABELS: Record<BookingStatus, string> = {
  confirmed: 'Confirmed',
  in_progress: 'In Progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
  no_show: 'No Show',
};

const PAYMENT_ICONS: Record<PaymentStatus, string> = {
  paid: '💚',
  pending: '🟡',
  failed: '🔴',
  refunded: '↩',
};

const VIP_BADGES: Record<VipTier, string> = {
  platinum: '💎',
  gold: '🥇',
  silver: '🥈',
  bronze: '🥉',
};

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-SG', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

export default function TodayPage() {
  const { merchant } = useAuth();
  const [rows, setRows] = useState<BookingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [walkInOpen, setWalkInOpen] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const today = new Date().toLocaleDateString('en-SG', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  const todayDate = new Date().toISOString().slice(0, 10);

  const fetchBookings = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = (await apiFetch(`/booking/merchant?date=${todayDate}`)) as { bookings: BookingRow[] };
      setRows(res.bookings);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load bookings');
    } finally {
      setLoading(false);
    }
  }, [todayDate]);

  useEffect(() => {
    void fetchBookings();
  }, [fetchBookings]);

  async function action(id: string, endpoint: string) {
    setActionLoading(id + endpoint);
    try {
      await apiFetch(`/booking/merchant/${id}/${endpoint}`, { method: 'PUT' });
      await fetchBookings();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setActionLoading(null);
    }
  }

  const activeBookings = rows.filter(
    (r) => r.booking.status !== 'cancelled' && r.booking.status !== 'no_show'
  );

  return (
    <DashboardShell>
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Today</h1>
            <p className="text-gray-500 text-sm mt-0.5">
              {today} · {merchant?.name}
              {activeBookings.length > 0 && (
                <span className="ml-2 font-medium text-indigo-600">
                  {activeBookings.length} booking{activeBookings.length !== 1 ? 's' : ''}
                </span>
              )}
            </p>
          </div>
          <button
            onClick={() => setWalkInOpen(true)}
            className="shrink-0 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 transition-colors"
          >
            + Walk-in
          </button>
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
            <p className="text-base">No bookings today</p>
            <p className="text-sm mt-1">Walk-ins welcome!</p>
          </div>
        )}

        {/* Booking list */}
        <div className="space-y-3">
          {rows.map((row) => {
            const { booking, service, staffMember, client } = row;
            const isActionLoading = (ep: string) => actionLoading === booking.id + ep;

            return (
              <div
                key={booking.id}
                className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden"
              >
                <div className="px-5 py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold text-gray-500">
                          {formatTime(booking.startTime)}
                        </span>
                        <span className="text-base font-bold text-gray-900">
                          {client.name ?? client.phone}
                        </span>
                        {client.vipTier && (
                          <span title={client.vipTier} className="text-base">
                            {VIP_BADGES[client.vipTier]}
                          </span>
                        )}
                      </div>
                      <div className="text-sm text-gray-500 mt-0.5">
                        {service.name} with {staffMember.name}
                      </div>
                      {booking.clientNotes && (
                        <div className="text-xs text-gray-400 mt-1 italic">
                          {booking.clientNotes}
                        </div>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-1.5 shrink-0">
                      <span
                        className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLES[booking.status]}`}
                      >
                        {STATUS_LABELS[booking.status]}
                      </span>
                      <span className="text-xs text-gray-500">
                        {PAYMENT_ICONS[booking.paymentStatus]} SGD{' '}
                        {parseFloat(booking.priceSgd).toFixed(2)}
                      </span>
                    </div>
                  </div>

                  {/* Actions */}
                  {(booking.status === 'confirmed' || booking.status === 'in_progress') && (
                    <div className="flex gap-2 mt-3 flex-wrap">
                      {booking.status === 'confirmed' && (
                        <button
                          onClick={() => action(booking.id, 'check-in')}
                          disabled={!!actionLoading}
                          className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-60 transition-colors"
                        >
                          {isActionLoading('check-in') ? '…' : 'Check In'}
                        </button>
                      )}
                      {booking.status === 'in_progress' && (
                        <button
                          onClick={() => action(booking.id, 'complete')}
                          disabled={!!actionLoading}
                          className="rounded-lg bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-60 transition-colors"
                        >
                          {isActionLoading('complete') ? '…' : 'Complete'}
                        </button>
                      )}
                      <button
                        onClick={() => action(booking.id, 'no-show')}
                        disabled={!!actionLoading}
                        className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:border-red-300 hover:text-red-600 disabled:opacity-60 transition-colors"
                      >
                        {isActionLoading('no-show') ? '…' : 'No-Show'}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {walkInOpen && (
          <WalkInModal
            onClose={() => setWalkInOpen(false)}
            onSuccess={() => {
              setWalkInOpen(false);
              void fetchBookings();
            }}
          />
        )}
      </div>
    </DashboardShell>
  );
}
