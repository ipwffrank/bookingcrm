'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { apiFetch, ApiError } from '../lib/api';
import type { ServiceOption, StaffOption } from './bookings/types';
import { BookingForm } from './bookings/BookingForm';

// ─── Types ─────────────────────────────────────────────────────────────────────

type BookingStatus = 'confirmed' | 'in_progress' | 'completed' | 'cancelled' | 'no_show';
type VipTier = 'bronze' | 'silver' | 'gold' | 'platinum' | null;

interface BookingRow {
  booking: {
    id: string;
    startTime: string;
    endTime: string;
    status: BookingStatus;
    paymentMethod: string | null;
    priceSgd: string;
    clientNotes: string | null;
  };
  service: { id: string; name: string };
  staffMember: { id: string; name: string };
  client: { id: string; name: string | null; phone: string };
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function todayDateString() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-SG', { hour: '2-digit', minute: '2-digit', hour12: true });
}

function formatDateLong(dateStr: string) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-SG', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}

// ─── Status Badge ──────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<BookingStatus, { label: string; className: string }> = {
  confirmed:   { label: 'Confirmed',   className: 'bg-green-100 text-green-700 border-green-200' },
  in_progress: { label: 'In Progress', className: 'bg-blue-100 text-blue-700 border-blue-200' },
  completed:   { label: 'Completed',   className: 'bg-gray-100 text-gray-600 border-gray-200' },
  cancelled:   { label: 'Cancelled',   className: 'bg-red-100 text-red-600 border-red-200' },
  no_show:     { label: 'No Show',     className: 'bg-orange-100 text-orange-700 border-orange-200' },
};

function StatusBadge({ status }: { status: BookingStatus }) {
  const cfg = STATUS_CONFIG[status] ?? { label: status, className: 'bg-gray-100 text-gray-600 border-gray-200' };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${cfg.className}`}>
      {cfg.label}
    </span>
  );
}

// ─── VIP Badge ─────────────────────────────────────────────────────────────────

const VIP_CONFIG: Record<NonNullable<VipTier>, { emoji: string; className: string }> = {
  platinum: { emoji: '💎', className: 'bg-purple-100 text-purple-700 border-purple-200' },
  gold:     { emoji: '🥇', className: 'bg-yellow-100 text-yellow-700 border-yellow-200' },
  silver:   { emoji: '🥈', className: 'bg-slate-100 text-slate-600 border-slate-200' },
  bronze:   { emoji: '🥉', className: 'bg-amber-100 text-amber-700 border-amber-200' },
};

function VipBadge({ tier }: { tier: VipTier }) {
  if (!tier) return null;
  const cfg = VIP_CONFIG[tier];
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${cfg.className}`}>
      {cfg.emoji} {tier.charAt(0).toUpperCase() + tier.slice(1)}
    </span>
  );
}

// ─── Loading Spinner ───────────────────────────────────────────────────────────

function Spinner() {
  return (
    <div className="flex items-center justify-center py-16">
      <div className="w-8 h-8 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin" />
    </div>
  );
}

// ─── Booking Card ──────────────────────────────────────────────────────────────

function BookingCard({
  row,
  onAction,
  onEdit,
}: {
  row: BookingRow;
  onAction: (bookingId: string, action: 'check-in' | 'complete' | 'no-show') => Promise<void>;
  onEdit: (bookingId: string) => void;
}) {
  const { booking, service, staffMember, client } = row;
  const [acting, setActing] = useState<string | null>(null);

  async function handleAction(action: 'check-in' | 'complete' | 'no-show') {
    setActing(action);
    try {
      await onAction(booking.id, action);
    } finally {
      setActing(null);
    }
  }

  const canCheckIn = booking.status === 'confirmed';
  const canComplete = booking.status === 'in_progress';
  const canNoShow = booking.status === 'confirmed' || booking.status === 'in_progress';

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-base font-semibold text-gray-900">
              {formatTime(booking.startTime)} – {formatTime(booking.endTime)}
            </span>
            <StatusBadge status={booking.status} />
          </div>
          <p className="text-sm font-medium text-gray-800 truncate">{client.name ?? 'Unknown'}</p>
          <p className="text-xs text-gray-500 mt-0.5">{client.phone}</p>
        </div>
        <div className="text-right flex-shrink-0">
          <p className="text-sm font-semibold text-gray-900">S${parseFloat(booking.priceSgd).toFixed(2)}</p>
          <p className="text-xs text-gray-400 capitalize">{booking.paymentMethod ?? 'N/A'}</p>
        </div>
      </div>

      <div className="mt-3 pt-3 border-t border-gray-100 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs text-gray-600 truncate">
            <span className="font-medium">{service.name}</span>
            <span className="text-gray-400"> · {staffMember.name}</span>
          </p>
          {booking.clientNotes && (
            <p className="text-xs text-gray-400 mt-0.5 truncate italic">&ldquo;{booking.clientNotes}&rdquo;</p>
          )}
        </div>

        {booking.status !== 'cancelled' && (
          <div className="flex gap-1.5 flex-shrink-0">
            <button
              onClick={() => onEdit(booking.id)}
              className="px-2.5 py-1 rounded-lg text-xs font-medium bg-gray-100 text-gray-700 hover:bg-gray-200 border border-gray-200"
              aria-label="Edit booking"
            >
              Edit
            </button>
            {canCheckIn && (
              <button
                onClick={() => handleAction('check-in')}
                disabled={acting !== null}
                className="px-2.5 py-1 rounded-lg text-xs font-medium bg-green-50 text-green-700 hover:bg-green-100 disabled:opacity-50 transition-colors border border-green-200"
              >
                {acting === 'check-in' ? '...' : 'Check In'}
              </button>
            )}
            {canComplete && (
              <button
                onClick={() => handleAction('complete')}
                disabled={acting !== null}
                className="px-2.5 py-1 rounded-lg text-xs font-medium bg-blue-50 text-blue-700 hover:bg-blue-100 disabled:opacity-50 transition-colors border border-blue-200"
              >
                {acting === 'complete' ? '...' : 'Complete'}
              </button>
            )}
            {canNoShow && (
              <button
                onClick={() => handleAction('no-show')}
                disabled={acting !== null}
                className="px-2.5 py-1 rounded-lg text-xs font-medium bg-orange-50 text-orange-700 hover:bg-orange-100 disabled:opacity-50 transition-colors border border-orange-200"
              >
                {acting === 'no-show' ? '...' : 'No-Show'}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [bookings, setBookings] = useState<BookingRow[]>([]);
  const [services, setServices] = useState<ServiceOption[]>([]);
  const [staffList, setStaffList] = useState<StaffOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showWalkIn, setShowWalkIn] = useState(false);
  const [editTarget, setEditTarget] = useState<{ bookingId: string } | null>(null);
  const [date] = useState(todayDateString());
  const [revenue, setRevenue] = useState<{
    completedRevenue: string;
    cancelledRetained: string;
    noShowRetained: string;
    packageRevenue: string;
    total: string;
  } | null>(null);

  const fetchBookings = useCallback(async () => {
    const token = localStorage.getItem('access_token');
    if (!token) { router.push('/login'); return; }
    try {
      const data = await apiFetch(`/merchant/bookings?date=${date}`, {
        headers: { Authorization: `Bearer ${token}` },
      }) as { bookings: BookingRow[] };
      const sorted = [...(data.bookings ?? [])].sort(
        (a, b) => new Date(a.booking.startTime).getTime() - new Date(b.booking.startTime).getTime()
      );
      setBookings(sorted);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load bookings';
      if (err instanceof ApiError && err.status === 401) {
        router.push('/login');
      } else {
        setError(msg);
      }
    }
  }, [date, router]);

  useEffect(() => {
    const token = localStorage.getItem('access_token');
    if (!token) { router.push('/login'); return; }

    async function init() {
      setLoading(true);
      setError('');
      try {
        const [bookingsData, servicesData, staffData] = await Promise.all([
          apiFetch(`/merchant/bookings?date=${date}`, { headers: { Authorization: `Bearer ${token}` } }) as Promise<{ bookings: BookingRow[] }>,
          apiFetch('/merchant/services', { headers: { Authorization: `Bearer ${token}` } }) as Promise<{ services: ServiceOption[] }>,
          apiFetch('/merchant/staff', { headers: { Authorization: `Bearer ${token}` } }) as Promise<{ staff: StaffOption[] }>,
        ]);
        const sorted = [...(bookingsData.bookings ?? [])].sort(
          (a, b) => new Date(a.booking.startTime).getTime() - new Date(b.booking.startTime).getTime()
        );
        setBookings(sorted);
        setServices(servicesData.services ?? []);
        setStaffList(staffData.staff ?? []);

        apiFetch('/merchant/analytics/today-revenue', { headers: { Authorization: `Bearer ${token}` } })
          .then((d) => setRevenue(d as {
            completedRevenue: string; cancelledRetained: string; noShowRetained: string; packageRevenue: string; total: string;
          }))
          .catch(() => {}); // non-fatal
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to load data';
        if (err instanceof ApiError && err.status === 401) {
          router.push('/login');
        } else {
          setError(msg);
        }
      } finally {
        setLoading(false);
      }
    }

    void init();
  }, [date, router]);

  async function handleAction(bookingId: string, action: 'check-in' | 'complete' | 'no-show') {
    const token = localStorage.getItem('access_token');
    if (!token) { router.push('/login'); return; }
    try {
      await apiFetch(`/merchant/bookings/${bookingId}/${action}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}` },
      });
      await fetchBookings();
      apiFetch(`/merchant/analytics/today-revenue`, { headers: { Authorization: `Bearer ${token}` } })
        .then((d) => setRevenue(d as any))
        .catch(() => {});
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Action failed';
      if (err instanceof ApiError && err.status === 401) {
        router.push('/login');
      } else {
        alert(msg);
      }
    }
  }

  const confirmed = bookings.filter((b) => b.booking.status === 'confirmed');
  const inProgress = bookings.filter((b) => b.booking.status === 'in_progress');
  const completed = bookings.filter((b) => b.booking.status === 'completed');
  const noShow = bookings.filter((b) => b.booking.status === 'no_show');

  const VALID_STATUSES: BookingStatus[] = ['confirmed', 'in_progress', 'completed', 'no_show'];
  const rawFilter = searchParams.get('status');
  const statusFilter: BookingStatus | null = VALID_STATUSES.includes(rawFilter as BookingStatus)
    ? (rawFilter as BookingStatus)
    : null;

  return (
    <>
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Today&apos;s Bookings</h1>
          <p className="text-sm text-gray-500 mt-0.5">{formatDateLong(date)}</p>
        </div>
        <button
          onClick={() => setShowWalkIn(true)}
          className="flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 transition-colors shadow-sm flex-shrink-0"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          Add Walk-in
        </button>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        {[
          { key: 'confirmed' as const,   label: 'Confirmed',   value: confirmed.length,   color: 'text-green-600 bg-green-50 border-green-200' },
          { key: 'in_progress' as const, label: 'In Progress', value: inProgress.length,  color: 'text-blue-600 bg-blue-50 border-blue-200' },
          { key: 'completed' as const,   label: 'Completed',   value: completed.length,   color: 'text-gray-600 bg-gray-50 border-gray-200' },
          { key: 'no_show' as const,     label: 'No Show',     value: noShow.length,      color: 'text-orange-600 bg-orange-50 border-orange-200' },
        ].map((stat) => {
          const selected = statusFilter === stat.key;
          return (
            <button
              key={stat.key}
              type="button"
              onClick={() => {
                const next = new URLSearchParams(Array.from(searchParams.entries()));
                if (selected) next.delete('status');
                else next.set('status', stat.key);
                router.replace(`/dashboard${next.toString() ? `?${next}` : ''}`);
              }}
              className={`text-left rounded-xl border p-4 transition-shadow ${stat.color} ${selected ? 'ring-2 ring-indigo-400 shadow' : 'hover:shadow-sm'}`}
              aria-pressed={selected}
            >
              <p className="text-2xl font-bold">{stat.value}</p>
              <p className="text-xs font-medium mt-0.5 opacity-80">{stat.label}</p>
            </button>
          );
        })}
      </div>
      {statusFilter && (
        <div className="mb-4 -mt-2 flex items-center gap-2 text-xs text-gray-600">
          <span>Filtering by <strong className="capitalize">{statusFilter.replace('_', ' ')}</strong></span>
          <button
            type="button"
            onClick={() => router.replace('/dashboard')}
            className="underline hover:text-gray-900"
          >
            Clear
          </button>
        </div>
      )}

      <Link
        href="/dashboard/analytics?period=today"
        className="block mb-4 bg-white rounded-xl border border-gray-200 p-4 hover:shadow-sm transition-shadow"
      >
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs font-medium text-gray-500">Today&apos;s Revenue</p>
            <p className="text-2xl font-bold text-gray-900 mt-0.5">
              S${revenue ? Number(revenue.total).toFixed(2) : '—'}
            </p>
          </div>
        </div>
        {revenue && (
          <div className="mt-3 pt-3 border-t border-gray-100 grid grid-cols-2 gap-y-1 gap-x-4 text-xs">
            <div className="flex justify-between"><span className="text-gray-500">Services completed</span><span className="text-gray-900 tabular-nums">S${Number(revenue.completedRevenue).toFixed(2)}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Cancellations retained</span><span className="text-gray-900 tabular-nums">S${Number(revenue.cancelledRetained).toFixed(2)}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">No-shows retained</span><span className="text-gray-900 tabular-nums">S${Number(revenue.noShowRetained).toFixed(2)}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Packages sold</span><span className="text-gray-900 tabular-nums">S${Number(revenue.packageRevenue).toFixed(2)}</span></div>
          </div>
        )}
      </Link>

      {loading && <Spinner />}

      {!loading && error && (
        <div className="rounded-xl bg-red-50 border border-red-200 p-6 text-center">
          <p className="text-red-600 font-medium mb-3">{error}</p>
          <button
            onClick={() => { setError(''); void fetchBookings(); }}
            className="px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700 transition-colors"
          >
            Retry
          </button>
        </div>
      )}

      {!loading && !error && bookings.length === 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <div className="text-4xl mb-3">📅</div>
          <h3 className="text-lg font-semibold text-gray-900 mb-1">No bookings today</h3>
          <p className="text-sm text-gray-500 mb-4">Add a walk-in or share your booking link to get started.</p>
          <button
            onClick={() => setShowWalkIn(true)}
            className="px-4 py-2 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 transition-colors"
          >
            Add Walk-in
          </button>
        </div>
      )}

      {!loading && !error && bookings.length > 0 && (
        <div className="space-y-3">
          {bookings.filter((b) => !statusFilter || b.booking.status === statusFilter).map((row) => (
            <BookingCard key={row.booking.id} row={row} onAction={handleAction} onEdit={(bookingId) => setEditTarget({ bookingId })} />
          ))}
        </div>
      )}

      {showWalkIn && (
        <BookingForm
          mode="create"
          services={services}
          staffList={staffList}
          onClose={() => setShowWalkIn(false)}
          onSave={() => {
            setShowWalkIn(false);
            void fetchBookings();
          }}
        />
      )}

      {editTarget && (
        <BookingForm
          mode="edit"
          bookingId={editTarget.bookingId}
          onClose={() => setEditTarget(null)}
          onSave={() => {
            setEditTarget(null);
            void fetchBookings();
          }}
        />
      )}
    </>
  );
}
