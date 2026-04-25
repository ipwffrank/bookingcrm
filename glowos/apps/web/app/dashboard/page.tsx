'use client';

import { Suspense, useEffect, useRef, useState, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { apiFetch, ApiError } from '../lib/api';
import type { ServiceOption, StaffOption } from './bookings/types';
import { BookingForm } from './bookings/BookingForm';
import { DayTimelineStrip } from './components/DayTimelineStrip';
import { WaitlistCard, type WaitlistEntry } from './components/WaitlistCard';
import { StaffContributionCard } from './components/StaffContributionCard';

// ─── Types ─────────────────────────────────────────────────────────────────────

type BookingStatus = 'pending' | 'confirmed' | 'in_progress' | 'completed' | 'cancelled' | 'no_show';
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

// ─── Status Badge — typographic state (no colored pill) ──────────────────────

const STATUS_CONFIG: Record<BookingStatus, { label: string; stateClass: string }> = {
  pending:     { label: 'Pending',     stateClass: 'state-notified' },
  confirmed:   { label: 'Confirmed',   stateClass: 'state-default' },
  in_progress: { label: 'In Progress', stateClass: 'state-active' },
  completed:   { label: 'Completed',   stateClass: 'state-completed' },
  cancelled:   { label: 'Cancelled',   stateClass: 'state-cancelled' },
  no_show:     { label: 'No Show',     stateClass: 'state-no-show' },
};

function StatusBadge({ status }: { status: BookingStatus }) {
  const cfg = STATUS_CONFIG[status] ?? { label: status, stateClass: 'state-completed' };
  return <span className={`text-xs ${cfg.stateClass}`}>{cfg.label}</span>;
}

// ─── VIP Badge — star count (no colored pill) ─────────────────────────────────

const VIP_STAR_COUNT: Record<NonNullable<VipTier>, number> = {
  bronze:   1,
  silver:   2,
  gold:     3,
  platinum: 4,
};

function VipBadge({ tier }: { tier: VipTier }) {
  if (!tier) return null;
  const stars = VIP_STAR_COUNT[tier];
  return (
    <span
      className="inline-flex items-center gap-0.5 text-xs font-medium text-tone-ink"
      aria-label={`${tier} tier`}
      title={tier.charAt(0).toUpperCase() + tier.slice(1)}
    >
      {'★'.repeat(stars)}
    </span>
  );
}

// ─── Loading Spinner ───────────────────────────────────────────────────────────

function Spinner() {
  return (
    <div className="flex items-center justify-center py-16">
      <div className="w-8 h-8 border-4 border-grey-15 border-t-tone-ink rounded-full animate-spin" />
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
    <div className="bg-tone-surface rounded-xl border border-grey-15 p-4 shadow-sm hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-base font-semibold text-tone-ink">
              {formatTime(booking.startTime)} – {formatTime(booking.endTime)}
            </span>
            <StatusBadge status={booking.status} />
          </div>
          <p className="text-sm font-medium text-grey-90 truncate">{client.name ?? 'Unknown'}</p>
          <p className="text-xs text-grey-60 mt-0.5">{client.phone}</p>
        </div>
        <div className="text-right flex-shrink-0">
          <p className="text-sm font-semibold text-tone-ink">S${parseFloat(booking.priceSgd).toFixed(2)}</p>
          <p className="text-xs text-grey-45 capitalize">{booking.paymentMethod ?? 'N/A'}</p>
        </div>
      </div>

      <div className="mt-3 pt-3 border-t border-grey-5 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs text-grey-75 truncate">
            <span className="font-medium">{service.name}</span>
            <span className="text-grey-45"> · {staffMember.name}</span>
          </p>
          {booking.clientNotes && (
            <p className="text-xs text-grey-45 mt-0.5 truncate italic">&ldquo;{booking.clientNotes}&rdquo;</p>
          )}
        </div>

        {booking.status !== 'cancelled' && (
          <div className="flex gap-1.5 flex-shrink-0">
            <button
              onClick={() => onEdit(booking.id)}
              className="px-2.5 py-1 rounded-lg text-xs font-medium text-tone-ink bg-grey-5 hover:bg-grey-15 border border-grey-15 transition-colors"
              aria-label="Edit booking"
            >
              Edit
            </button>
            {canCheckIn && (
              <button
                onClick={() => handleAction('check-in')}
                disabled={acting !== null}
                className="px-2.5 py-1 rounded-lg text-xs font-semibold text-tone-surface bg-tone-sage hover:opacity-90 disabled:opacity-50 transition-opacity"
              >
                {acting === 'check-in' ? '...' : 'Check In'}
              </button>
            )}
            {canComplete && (
              <button
                onClick={() => handleAction('complete')}
                disabled={acting !== null}
                className="px-2.5 py-1 rounded-lg text-xs font-semibold text-tone-surface bg-tone-ink hover:opacity-90 disabled:opacity-50 transition-opacity"
              >
                {acting === 'complete' ? '...' : 'Complete'}
              </button>
            )}
            {canNoShow && (
              <button
                onClick={() => handleAction('no-show')}
                disabled={acting !== null}
                className="px-2.5 py-1 rounded-lg text-xs font-medium text-semantic-danger border border-semantic-danger/30 hover:bg-semantic-danger/5 disabled:opacity-50 transition-colors"
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
  // Next.js 15 requires a Suspense boundary around any component that calls
  // useSearchParams() at the page level — otherwise prerender bails out.
  return (
    <Suspense fallback={<Spinner />}>
      <DashboardPageInner />
    </Suspense>
  );
}

function DashboardPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [bookings, setBookings] = useState<BookingRow[]>([]);
  const [services, setServices] = useState<ServiceOption[]>([]);
  const [staffList, setStaffList] = useState<StaffOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showWalkIn, setShowWalkIn] = useState(false);
  const [showPreBook, setShowPreBook] = useState(false);
  const [editTarget, setEditTarget] = useState<{ bookingId: string } | null>(null);
  const [date] = useState(todayDateString());
  const [revenue, setRevenue] = useState<{
    completedRevenue: string;
    cancelledRetained: string;
    noShowRetained: string;
    packageRevenue: string;
    total: string;
  } | null>(null);
  const [lowRatings, setLowRatings] = useState<Array<{
    id: string;
    rating: number;
    comment: string | null;
    serviceName: string;
    staffName: string;
    clientId: string;
    clientName: string | null;
    clientPhone: string | null;
  }>>([]);
  const [operatingHours, setOperatingHours] = useState<
    Record<string, { open: string; close: string; closed: boolean }> | null
  >(null);
  const [waitlistEntries, setWaitlistEntries] = useState<WaitlistEntry[]>([]);
  const [flashBookingId, setFlashBookingId] = useState<string | null>(null);
  const [flashWaitlist, setFlashWaitlist] = useState(false);
  const bookingRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const waitlistRef = useRef<HTMLDivElement | null>(null);

  function handleWaitlistTileClick() {
    const el = waitlistRef.current;
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setFlashWaitlist(true);
    setTimeout(() => setFlashWaitlist(false), 1200);
  }

  function handleTimelineClick(bookingId: string) {
    const el = bookingRefs.current[bookingId];
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setFlashBookingId(bookingId);
    setTimeout(() => setFlashBookingId((id) => (id === bookingId ? null : id)), 1200);
  }

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

        apiFetch('/merchant/reviews?period=7d&maxRating=2&limit=5', { headers: { Authorization: `Bearer ${token}` } })
          .then((d) => {
            const res = d as { reviews: Array<{ id: string; rating: number; comment: string | null; serviceName: string; staffName: string; clientId: string; clientName: string | null; clientPhone: string | null }> };
            setLowRatings(res.reviews ?? []);
          })
          .catch(() => {});

        apiFetch('/merchant/me', { headers: { Authorization: `Bearer ${token}` } })
          .then((d) => {
            const res = d as { merchant?: { operatingHours?: Record<string, { open: string; close: string; closed: boolean }> | null } };
            setOperatingHours(res.merchant?.operatingHours ?? null);
          })
          .catch(() => {});

        apiFetch('/merchant/waitlist?status=active', { headers: { Authorization: `Bearer ${token}` } })
          .then((d) => {
            const res = d as { entries: WaitlistEntry[] };
            setWaitlistEntries(res.entries ?? []);
          })
          .catch(() => {});
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

  const pending = bookings.filter((b) => b.booking.status === 'pending');
  const confirmed = bookings.filter((b) => b.booking.status === 'confirmed');
  const inProgress = bookings.filter((b) => b.booking.status === 'in_progress');
  const completed = bookings.filter((b) => b.booking.status === 'completed');
  const noShow = bookings.filter((b) => b.booking.status === 'no_show');

  const VALID_STATUSES: BookingStatus[] = ['pending', 'confirmed', 'in_progress', 'completed', 'no_show'];
  const rawFilter = searchParams.get('status');
  const statusFilter: BookingStatus | null = VALID_STATUSES.includes(rawFilter as BookingStatus)
    ? (rawFilter as BookingStatus)
    : null;

  return (
    <>
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-tone-ink">Today&apos;s Bookings</h1>
          <p className="text-sm text-grey-60 mt-0.5">{formatDateLong(date)}</p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={() => setShowPreBook(true)}
            className="flex items-center gap-2 rounded-xl bg-tone-surface border-2 border-tone-ink px-4 py-2.5 text-sm font-semibold text-tone-ink hover:bg-grey-5 transition-colors"
            title="Schedule an appointment for a future date"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5" />
            </svg>
            Pre-book
          </button>
          <button
            onClick={() => setShowWalkIn(true)}
            className="flex items-center gap-2 rounded-xl bg-tone-ink px-4 py-2.5 text-sm font-semibold text-tone-surface hover:opacity-90 transition-opacity shadow-sm"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            Add Walk-in
          </button>
        </div>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 sm:grid-cols-6 gap-3 mb-6">
        {[
          { key: 'pending' as const,     label: 'Pending',     value: pending.length,    tone: 'pending' as const },
          { key: 'confirmed' as const,   label: 'Confirmed',   value: confirmed.length,  tone: 'neutral' as const },
          { key: 'in_progress' as const, label: 'In Progress', value: inProgress.length, tone: 'neutral' as const },
          { key: 'completed' as const,   label: 'Completed',   value: completed.length,  tone: 'muted' as const },
          { key: 'no_show' as const,     label: 'No Show',     value: noShow.length,     tone: 'danger' as const },
        ].map((stat) => {
          const selected = statusFilter === stat.key;
          const toneClass =
            stat.tone === 'danger'
              ? 'text-semantic-danger border-semantic-danger/30 bg-semantic-danger/5'
              : stat.tone === 'pending'
                ? 'text-semantic-warn border-semantic-warn/30 bg-semantic-warn/5'
                : stat.tone === 'muted'
                  ? 'text-grey-60 border-grey-15 bg-tone-surface'
                  : 'text-tone-ink border-grey-15 bg-tone-surface';
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
              className={`text-left rounded-xl border p-4 transition-shadow ${toneClass} ${selected ? 'ring-2 ring-tone-sage shadow' : 'hover:shadow-sm'}`}
              aria-pressed={selected}
            >
              <p className="text-2xl font-bold">{stat.value}</p>
              <p className="text-xs font-medium mt-0.5 opacity-80">{stat.label}</p>
            </button>
          );
        })}
        <button
          type="button"
          onClick={handleWaitlistTileClick}
          className="text-left rounded-xl border p-4 text-tone-sage bg-tone-sage/5 border-tone-sage/30 transition-shadow hover:shadow-sm"
          aria-label="Scroll to waitlist details"
        >
          <p className="text-2xl font-bold">{waitlistEntries.length}</p>
          <p className="text-xs font-medium mt-0.5 opacity-80">Waitlist</p>
        </button>
      </div>
      {statusFilter && (
        <div className="mb-4 -mt-2 flex items-center gap-2 text-xs text-grey-75">
          <span>Filtering by <strong className="capitalize">{statusFilter.replace('_', ' ')}</strong></span>
          <button
            type="button"
            onClick={() => router.replace('/dashboard')}
            className="underline hover:text-tone-ink"
          >
            Clear
          </button>
        </div>
      )}

      <DayTimelineStrip
        bookings={bookings.map((r) => ({
          id: r.booking.id,
          startTime: r.booking.startTime,
          endTime: r.booking.endTime,
          status: r.booking.status,
          staffId: r.staffMember.id,
          staffName: r.staffMember.name,
        }))}
        operatingHours={operatingHours}
        statusFilter={statusFilter}
        onBarClick={handleTimelineClick}
      />

      <Link
        href="/dashboard/analytics?period=today"
        className="block mb-4 bg-tone-surface rounded-xl border border-grey-15 p-4 hover:shadow-sm transition-shadow"
      >
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs font-medium text-grey-60">Today&apos;s Revenue</p>
            <p className="text-2xl font-bold text-tone-ink mt-0.5">
              S${revenue ? Number(revenue.total).toFixed(2) : '—'}
            </p>
          </div>
        </div>
        {revenue && (
          <div className="mt-3 pt-3 border-t border-grey-5 grid grid-cols-2 gap-y-1 gap-x-4 text-xs">
            <div className="flex justify-between"><span className="text-grey-60">Services completed</span><span className="text-tone-ink tabular-nums">S${Number(revenue.completedRevenue).toFixed(2)}</span></div>
            <div className="flex justify-between"><span className="text-grey-60">Cancellations retained</span><span className="text-tone-ink tabular-nums">S${Number(revenue.cancelledRetained).toFixed(2)}</span></div>
            <div className="flex justify-between"><span className="text-grey-60">No-shows retained</span><span className="text-tone-ink tabular-nums">S${Number(revenue.noShowRetained).toFixed(2)}</span></div>
            <div className="flex justify-between"><span className="text-grey-60">Packages sold</span><span className="text-tone-ink tabular-nums">S${Number(revenue.packageRevenue).toFixed(2)}</span></div>
          </div>
        )}
      </Link>

      <StaffContributionCard />

      <div
        ref={waitlistRef}
        className={`rounded-xl transition-shadow ${flashWaitlist ? 'ring-2 ring-tone-sage shadow-md' : ''}`}
      >
        <WaitlistCard entries={waitlistEntries} onEntriesChange={setWaitlistEntries} />
      </div>

      {lowRatings.length > 0 && (
        <div className="mb-4 bg-tone-surface rounded-xl border border-semantic-warn/30 p-4">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-semantic-warn">⚠</span>
            <h2 className="text-sm font-semibold text-tone-ink">Recent low ratings (last 7 days)</h2>
          </div>
          <ul className="divide-y divide-grey-15">
            {lowRatings.map((r) => (
              <li key={r.id}>
                <Link
                  href={`/dashboard/clients/${r.clientId}`}
                  className="flex items-center gap-3 py-2 -mx-2 px-2 rounded-md hover:bg-grey-5"
                >
                  <span className="text-semantic-warn text-sm shrink-0">{'★'.repeat(r.rating)}{'☆'.repeat(5 - r.rating)}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-tone-ink truncate">
                      <span className="font-medium">{r.serviceName}</span>
                      <span className="text-grey-60"> · {r.staffName}</span>
                      {r.comment && <span className="text-grey-75"> · &ldquo;{r.comment}&rdquo;</span>}
                    </p>
                    <p className="text-xs text-grey-60 truncate">
                      {r.clientName ?? 'Unknown'}{r.clientPhone ? ` · ${r.clientPhone}` : ''}
                    </p>
                  </div>
                  <span className="text-grey-45 text-xs">→</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      {loading && <Spinner />}

      {!loading && error && (
        <div className="rounded-xl bg-semantic-danger/5 border border-semantic-danger/30 p-6 text-center">
          <p className="text-semantic-danger font-medium mb-3">{error}</p>
          <button
            onClick={() => { setError(''); void fetchBookings(); }}
            className="px-4 py-2 rounded-lg bg-semantic-danger text-tone-surface text-sm font-medium hover:opacity-90 transition-opacity"
          >
            Retry
          </button>
        </div>
      )}

      {!loading && !error && bookings.length === 0 && (
        <div className="bg-tone-surface rounded-xl border border-grey-15 p-12 text-center">
          <div className="text-4xl mb-3">📅</div>
          <h3 className="text-lg font-semibold text-tone-ink mb-1">No bookings today</h3>
          <p className="text-sm text-grey-60 mb-4">Add a walk-in or share your booking link to get started.</p>
          <button
            onClick={() => setShowWalkIn(true)}
            className="px-4 py-2 rounded-xl bg-tone-ink text-tone-surface text-sm font-semibold hover:opacity-90 transition-opacity"
          >
            Add Walk-in
          </button>
        </div>
      )}

      {!loading && !error && bookings.length > 0 && (
        <div className="space-y-3">
          {bookings.filter((b) => !statusFilter || b.booking.status === statusFilter).map((row) => (
            <div
              key={row.booking.id}
              ref={(el) => { bookingRefs.current[row.booking.id] = el; }}
              className={`rounded-xl transition-shadow ${flashBookingId === row.booking.id ? 'ring-2 ring-tone-sage shadow-md' : ''}`}
            >
              <BookingCard row={row} onAction={handleAction} onEdit={(bookingId) => setEditTarget({ bookingId })} />
            </div>
          ))}
        </div>
      )}

      {showWalkIn && (
        <BookingForm
          mode="create"
          services={services}
          staffList={staffList}
          operatingHours={operatingHours}
          onClose={() => setShowWalkIn(false)}
          onSave={() => {
            setShowWalkIn(false);
            void fetchBookings();
          }}
        />
      )}

      {showPreBook && (
        <BookingForm
          mode="create"
          intent="prebook"
          services={services}
          staffList={staffList}
          operatingHours={operatingHours}
          onClose={() => setShowPreBook(false)}
          onSave={() => {
            setShowPreBook(false);
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
