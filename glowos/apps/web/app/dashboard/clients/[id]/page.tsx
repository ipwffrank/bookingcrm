'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { apiFetch, ApiError } from '../../../lib/api';

// ─── Types ─────────────────────────────────────────────────────────────────────

type VipTier = 'bronze' | 'silver' | 'gold' | 'platinum';
type ChurnRisk = 'low' | 'medium' | 'high';

interface ClientProfile {
  id: string;
  clientId: string;
  vipTier: VipTier | null;
  churnRisk: ChurnRisk | null;
  totalVisits: number;
  totalSpendSgd: string;
  lastVisitAt: string | null;
  notes: string | null;
  birthday: string | null;
}

interface Client {
  id: string;
  name: string | null;
  phone: string;
  email: string | null;
}

interface BookingEntry {
  booking: { id: string; startTime: string; status: string; priceSgd: string; };
  service: { name: string };
  staffMember: { name: string };
}

interface ClientDetailData {
  profile: ClientProfile;
  client: Client;
  recent_bookings: BookingEntry[];
}

interface ClientReview {
  id: string;
  rating: number;
  comment: string | null;
  createdAt: string;
  serviceName: string;
  staffName: string;
  appointmentDate: string;
}

// ─── Constants ─────────────────────────────────────────────────────────────────

const VIP_CONFIG: Record<VipTier, { label: string; cls: string; dot: string }> = {
  platinum: { label: 'Platinum', cls: 'bg-purple-100 text-purple-700', dot: 'bg-purple-500' },
  gold:     { label: 'Gold',     cls: 'bg-yellow-100 text-yellow-700', dot: 'bg-yellow-500' },
  silver:   { label: 'Silver',   cls: 'bg-slate-100 text-slate-600',   dot: 'bg-slate-400'  },
  bronze:   { label: 'Bronze',   cls: 'bg-amber-100 text-amber-700',   dot: 'bg-amber-500'  },
};

const CHURN_CONFIG: Record<ChurnRisk, { label: string; cls: string }> = {
  low:    { label: 'Low risk',    cls: 'bg-green-100 text-green-700'  },
  medium: { label: 'Medium risk', cls: 'bg-yellow-100 text-yellow-700' },
  high:   { label: 'High risk',   cls: 'bg-red-100 text-red-600'      },
};

const STATUS_CLS: Record<string, string> = {
  confirmed:   'text-emerald-600',
  completed:   'text-gray-500',
  cancelled:   'text-red-500',
  no_show:     'text-orange-500',
  in_progress: 'text-blue-600',
};

// ─── Helpers ───────────────────────────────────────────────────────────────────

function fmt(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function initials(name: string | null) {
  if (!name) return '?';
  return name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
}

// ─── Stat card ─────────────────────────────────────────────────────────────────

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-gray-50 rounded-xl p-4 text-center">
      <p className="text-2xl font-bold text-gray-900 leading-none">{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
      <p className="text-xs text-gray-500 mt-1">{label}</p>
    </div>
  );
}

// ─── Placeholder section ────────────────────────────────────────────────────────

function PlaceholderSection({ title, icon, description }: { title: string; icon: React.ReactNode; description: string }) {
  return (
    <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50/50 p-5">
      <div className="flex items-center gap-2 mb-1">
        {icon}
        <h3 className="text-sm font-semibold text-gray-700">{title}</h3>
        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-gray-200 text-gray-500 uppercase tracking-wide">Coming soon</span>
      </div>
      <p className="text-xs text-gray-400">{description}</p>
    </div>
  );
}

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function ClientProfilePage() {
  const router = useRouter();
  const params = useParams();
  const profileId = params.id as string;

  const [data,       setData]       = useState<ClientDetailData | null>(null);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState<string | null>(null);
  const [clientReviews, setClientReviews] = useState<ClientReview[]>([]);
  const [treatmentLog, setTreatmentLog] = useState<Array<{ id: string; staffName: string | null; content: string; createdAt: string }>>([]);
  const [clientPackagesData, setClientPackagesData] = useState<any[]>([]);
  const [showAddNote, setShowAddNote] = useState(false);
  const [newNoteContent, setNewNoteContent] = useState('');
  const [addingNote, setAddingNote] = useState(false);

  type ActivityEvent =
    | { type: 'purchase'; when: string; packageName: string; pricePaid: string }
    | {
        type: 'redemption';
        when: string;
        serviceName: string | null;
        staffName: string | null;
        bookingId: string | null;
      };

  const activityEvents: ActivityEvent[] = useMemo(() => {
    const events: ActivityEvent[] = [];
    for (const pkg of clientPackagesData) {
      events.push({
        type: 'purchase',
        when: pkg.purchasedAt,
        packageName: pkg.packageName,
        pricePaid: pkg.pricePaidSgd,
      });
      for (const s of pkg.sessions ?? []) {
        if (s.status === 'completed' && s.completedAt) {
          events.push({
            type: 'redemption',
            when: s.completedAt,
            serviceName: s.serviceName ?? null,
            staffName: s.staffName ?? null,
            bookingId: s.bookingId ?? null,
          });
        }
      }
    }
    return events.sort((a, b) => new Date(b.when).getTime() - new Date(a.when).getTime());
  }, [clientPackagesData]);

  useEffect(() => {
    const token = localStorage.getItem('access_token');
    if (!token) { router.push('/login'); return; }

    apiFetch(`/merchant/clients/${profileId}`)
      .then((d: unknown) => {
        const detail = d as ClientDetailData;
        setData(detail);
      })
      .catch(err => {
        if (err instanceof ApiError && err.status === 401) router.push('/login');
        else setError(err instanceof Error ? err.message : 'Failed to load client');
      })
      .finally(() => setLoading(false));

    // Fetch treatment log
    apiFetch(`/merchant/clients/${profileId}/notes`)
      .then((d: unknown) => {
        const result = d as { notes: Array<{ id: string; staffName: string | null; content: string; createdAt: string }> };
        setTreatmentLog(result.notes);
      })
      .catch(() => {});

    // Fetch client reviews
    apiFetch(`/merchant/reviews?clientId=${profileId}&period=all&limit=10`)
      .then((d: unknown) => {
        const result = d as { reviews: ClientReview[] };
        setClientReviews(result.reviews);
      })
      .catch(() => {});
  }, [profileId, router]);

  // Fetch client packages once client data is available
  useEffect(() => {
    if (!data?.client?.id) return;
    apiFetch(`/merchant/packages/client/${data.client.id}`)
      .then((d: any) => setClientPackagesData(d.packages ?? []))
      .catch(() => {});
  }, [data?.client?.id]);

  async function handleAddNote() {
    if (!newNoteContent.trim()) return;
    setAddingNote(true);
    try {
      const result = await apiFetch(`/merchant/clients/${profileId}/notes`, {
        method: 'POST',
        body: JSON.stringify({ content: newNoteContent.trim() }),
      }) as { note: { id: string; staffName: string | null; content: string; createdAt: string } };
      setTreatmentLog(prev => [result.note, ...prev]);
      setNewNoteContent('');
      setShowAddNote(false);
    } catch {
      alert('Failed to save note');
    } finally {
      setAddingNote(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-gray-200 border-t-[#1a2313] rounded-full animate-spin" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3">
        <p className="text-sm text-red-600">{error ?? 'Client not found'}</p>
        <Link href="/dashboard/clients" className="text-xs text-gray-500 hover:text-gray-700 underline">← Back to Clients</Link>
      </div>
    );
  }

  const { profile, client, recent_bookings } = data;
  const vipCfg   = profile.vipTier   ? VIP_CONFIG[profile.vipTier]   : null;
  const churnCfg = profile.churnRisk  ? CHURN_CONFIG[profile.churnRisk] : null;
  const revenue  = parseFloat(profile.totalSpendSgd ?? '0');

  // Upcoming = future bookings from recent_bookings (may be empty — API returns last 10 by startTime desc)
  const now = new Date();
  const upcoming = recent_bookings.filter(e => new Date(e.booking.startTime) >= now);
  const past     = recent_bookings.filter(e => new Date(e.booking.startTime) <  now);

  return (
    <div className="max-w-3xl mx-auto space-y-6 font-manrope">

      {/* ── Back nav ── */}
      <div className="flex items-center gap-2">
        <Link href="/dashboard/clients" className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-800 transition-colors">
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7"/></svg>
          All Clients
        </Link>
      </div>

      {/* ── Profile header ── */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex items-start gap-5">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-[#1a2313]/10 to-[#1a2313]/20 flex items-center justify-center shrink-0">
            <span className="text-xl font-bold text-[#1a2313]">{initials(client.name)}</span>
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-xl font-bold text-gray-900">{client.name ?? 'Unknown'}</h1>
              {vipCfg && (
                <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${vipCfg.cls}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${vipCfg.dot}`} />
                  {vipCfg.label}
                </span>
              )}
              {churnCfg && (
                <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${churnCfg.cls}`}>
                  {churnCfg.label}
                </span>
              )}
            </div>
            <div className="flex flex-wrap gap-4 mt-2">
              <div className="flex items-center gap-1.5 text-sm text-gray-600">
                <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 0 0 2.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 0 1-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 0 0-1.091-.852H4.5A2.25 2.25 0 0 0 2.25 4.5v2.25Z"/></svg>
                {client.phone}
              </div>
              {client.email && (
                <div className="flex items-center gap-1.5 text-sm text-gray-600">
                  <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75"/></svg>
                  {client.email}
                </div>
              )}
              {profile.birthday && (
                <div className="flex items-center gap-1.5 text-sm text-gray-600">
                  <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M12 8.25v-1.5m0 1.5c-1.355 0-2.697.056-4.024.166C6.845 8.51 6 9.473 6 10.608v2.513m6-4.871c1.355 0 2.697.056 4.024.166C17.155 8.51 18 9.473 18 10.608v2.513M15 21H3v-1a6 6 0 0 1 12 0v1Zm0 0h6v-1a6 6 0 0 0-9-5.197M13.5 7a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Z"/></svg>
                  {fmt(profile.birthday)}
                </div>
              )}
            </div>
          </div>
          {/* New booking button */}
          <Link
            href="/dashboard"
            className="shrink-0 flex items-center gap-1.5 px-4 py-2 bg-[#1a2313] text-white text-sm font-medium rounded-lg hover:bg-[#2f3827] transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15"/></svg>
            New Booking
          </Link>
        </div>
      </div>

      {/* ── Stats ── */}
      <div className="grid grid-cols-3 gap-4">
        <StatCard label="Total Visits" value={String(profile.totalVisits)} />
        <StatCard label="Total Revenue" value={`$${revenue.toFixed(0)}`} sub="SGD" />
        <StatCard label="Last Visit" value={fmt(profile.lastVisitAt)} />
      </div>

      {/* ── Upcoming bookings ── */}
      {upcoming.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h2 className="text-sm font-semibold text-gray-900 mb-3">Upcoming</h2>
          <div className="space-y-2">
            {upcoming.map(e => (
              <div key={e.booking.id} className="flex items-center justify-between bg-emerald-50 rounded-lg px-4 py-3">
                <div>
                  <p className="text-sm font-medium text-gray-900">{e.service.name}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{e.staffMember.name} · {fmt(e.booking.startTime)} · {new Date(e.booking.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
                </div>
                <span className="text-sm font-semibold text-gray-800">${parseFloat(e.booking.priceSgd).toFixed(0)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Service history ── */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h2 className="text-sm font-semibold text-gray-900 mb-3">Service History</h2>
        {past.length === 0 ? (
          <p className="text-sm text-gray-400 italic">No past bookings</p>
        ) : (
          <div className="space-y-1.5">
            {past.map(e => (
              <div key={e.booking.id} className="flex items-center justify-between rounded-lg px-4 py-2.5 hover:bg-gray-50 transition-colors">
                <div className="flex items-center gap-3">
                  <div className="w-2 h-2 rounded-full bg-gray-300 shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-gray-900">{e.service.name}</p>
                    <p className="text-xs text-gray-400">{e.staffMember.name} · {fmt(e.booking.startTime)}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-sm font-medium text-gray-800">${parseFloat(e.booking.priceSgd).toFixed(0)}</p>
                  <p className={`text-xs capitalize ${STATUS_CLS[e.booking.status] ?? 'text-gray-400'}`}>
                    {e.booking.status.replace('_', ' ')}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Treatment Log ── */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-gray-900">Treatment Log</h2>
          <button
            onClick={() => setShowAddNote(true)}
            className="text-xs font-medium text-indigo-600 hover:text-indigo-800 transition-colors"
          >
            + Add Entry
          </button>
        </div>

        {/* Add note form */}
        {showAddNote && (
          <div className="mb-4 space-y-2">
            <textarea
              value={newNoteContent}
              onChange={e => setNewNoteContent(e.target.value)}
              rows={3}
              placeholder="Treatment details, client preferences, observations..."
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-1 focus:ring-indigo-500/30 resize-none"
              autoFocus
            />
            <div className="flex gap-2">
              <button
                onClick={handleAddNote}
                disabled={!newNoteContent.trim() || addingNote}
                className="px-4 py-1.5 bg-indigo-600 text-white text-xs font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
              >
                {addingNote ? 'Saving...' : 'Save Entry'}
              </button>
              <button
                onClick={() => { setShowAddNote(false); setNewNoteContent(''); }}
                className="px-4 py-1.5 bg-gray-100 text-gray-600 text-xs font-medium rounded-lg hover:bg-gray-200 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Legacy notes from old system */}
        {data?.profile.notes?.trim() && treatmentLog.length === 0 && !showAddNote && (
          <div className="mb-3 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
            <p className="text-[10px] text-amber-600 font-medium uppercase tracking-wide mb-1">Legacy Notes</p>
            <p className="text-xs text-amber-900 leading-relaxed whitespace-pre-wrap">{data.profile.notes}</p>
          </div>
        )}

        {/* Log entries */}
        {treatmentLog.length === 0 && !data?.profile.notes?.trim() ? (
          <p className="text-xs text-gray-400 italic">No entries yet. Add the first treatment note above.</p>
        ) : (
          <div className="space-y-3 max-h-96 overflow-y-auto">
            {treatmentLog.map(entry => (
              <div key={entry.id} className="border-l-2 border-indigo-200 pl-3 py-1">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-gray-700">{entry.staffName || 'Admin'}</span>
                    <span className="text-[10px] text-gray-400">
                      {new Date(entry.createdAt).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' })}
                      {' '}
                      {new Date(entry.createdAt).toLocaleTimeString('en-SG', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                </div>
                <p className="text-xs text-gray-600 mt-1 leading-relaxed whitespace-pre-wrap">{entry.content}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Package Activity ── */}
      {activityEvents.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h2 className="text-sm font-semibold text-gray-900 mb-3">Package Activity</h2>
          <ul className="space-y-1.5">
            {activityEvents.map((e, i) => (
              <li key={i} className="text-xs text-gray-700 flex items-start gap-2">
                <span>{e.type === 'purchase' ? '📦' : '✅'}</span>
                <span className="flex-1">
                  {new Date(e.when).toLocaleDateString('en-SG', {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                  })}{' '}
                  —{' '}
                  {e.type === 'purchase'
                    ? `Bought ${e.packageName} · S$${e.pricePaid}`
                    : `Redeemed session${e.serviceName ? ` · ${e.serviceName}` : ''}${e.staffName ? ` · ${e.staffName}` : ''}`}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ── Package Progress ── */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h2 className="text-sm font-semibold text-gray-900 mb-4">Packages</h2>
        {clientPackagesData.length === 0 ? (
          <p className="text-xs text-gray-400 italic">No packages assigned.</p>
        ) : (
          <div className="space-y-4">
            {clientPackagesData.map((pkg: any) => (
              <div key={pkg.id} className="border border-gray-100 rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-semibold text-gray-900">{pkg.packageName}</h3>
                  <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${
                    pkg.status === 'active' ? 'bg-green-50 text-green-700' :
                    pkg.status === 'completed' ? 'bg-gray-100 text-gray-500' :
                    'bg-red-50 text-red-600'
                  }`}>{pkg.status}</span>
                </div>
                {/* Progress bar */}
                <div className="flex items-center gap-3 mb-3">
                  <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full bg-indigo-500 rounded-full transition-all" style={{ width: `${(pkg.sessionsUsed / pkg.sessionsTotal) * 100}%` }} />
                  </div>
                  <span className="text-xs font-medium text-gray-600">{pkg.sessionsUsed}/{pkg.sessionsTotal}</span>
                </div>
                {/* Session list */}
                <div className="space-y-1.5">
                  {pkg.sessions?.map((s: any) => (
                    <div key={s.id} className="flex items-center justify-between text-xs py-1 border-b border-gray-50 last:border-0">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
                          s.status === 'completed' ? 'bg-green-400' :
                          s.status === 'booked' ? 'bg-blue-400' :
                          'bg-gray-300'
                        }`} />
                        <span className="text-gray-700 truncate">
                          Session {s.sessionNumber}
                          {s.serviceName ? ` · ${s.serviceName}` : ''}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <span className="text-gray-400 capitalize">
                          {s.status}
                          {s.completedAt ? ` · ${new Date(s.completedAt).toLocaleDateString('en-SG', { day: 'numeric', month: 'short' })}` : ''}
                          {s.staffName ? ` · ${s.staffName}` : ''}
                        </span>
                        {(s.status === 'pending' || s.status === 'booked') && (
                          <button
                            onClick={async () => {
                              if (!confirm(`Mark Session ${s.sessionNumber} as completed?`)) return;
                              try {
                                await apiFetch(`/merchant/packages/sessions/${s.id}/complete`, {
                                  method: 'PUT', body: JSON.stringify({}),
                                });
                                if (data?.client?.id) {
                                  const pd = await apiFetch(`/merchant/packages/client/${data.client.id}`) as any;
                                  setClientPackagesData(pd.packages ?? []);
                                }
                              } catch { alert('Failed to update'); }
                            }}
                            className="text-[10px] text-indigo-600 hover:text-indigo-800 font-medium"
                          >
                            Mark Done
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
                <p className="text-[10px] text-gray-400 mt-2">Expires {new Date(pkg.expiresAt).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' })}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Reviews ── */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex items-center gap-2 mb-3">
          <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M11.48 3.499a.562.562 0 0 1 1.04 0l2.125 5.111a.563.563 0 0 0 .475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 0 0-.182.557l1.285 5.385a.562.562 0 0 1-.84.61l-4.725-2.885a.562.562 0 0 0-.586 0L6.982 20.54a.562.562 0 0 1-.84-.61l1.285-5.386a.562.562 0 0 0-.182-.557l-4.204-3.602a.562.562 0 0 1 .321-.988l5.518-.442a.563.563 0 0 0 .475-.345L11.48 3.5Z"/>
          </svg>
          <h3 className="text-sm font-semibold text-gray-700">Reviews</h3>
        </div>
        {clientReviews.length === 0 ? (
          <p className="text-xs text-gray-400">No reviews yet</p>
        ) : (
          <div className="space-y-3">
            {clientReviews.map(review => (
              <div key={review.id} className="border-b border-gray-100 pb-3 last:border-0 last:pb-0">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs tracking-wider">
                    {[1, 2, 3, 4, 5].map(s => (
                      <span key={s} className={s <= review.rating ? 'text-[#c4a778]' : 'text-gray-200'}>★</span>
                    ))}
                  </span>
                  <span className="text-[11px] text-gray-400">
                    {new Date(review.appointmentDate).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </span>
                </div>
                <p className="text-xs text-gray-500">{review.serviceName} · {review.staffName}</p>
                {review.comment && (
                  <p className="text-xs text-gray-700 mt-1">&ldquo;{review.comment}&rdquo;</p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Marketing preferences placeholder ── */}
      <PlaceholderSection
        title="Marketing Preferences"
        icon={
          <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.34 15.84c-.688-.06-1.386-.09-2.09-.09H7.5a4.5 4.5 0 1 1 0-9h.75c.704 0 1.402-.03 2.09-.09m0 9.18c.253.962.584 1.892.985 2.783.247.55.06 1.21-.463 1.511l-.657.38c-.551.318-1.26.117-1.527-.461a20.845 20.845 0 0 1-1.44-4.282m3.102.069a18.03 18.03 0 0 1-.59-4.59c0-1.586.205-3.124.59-4.59m0 9.18a23.848 23.848 0 0 1 8.835 2.535M10.34 6.66a23.847 23.847 0 0 1 8.835-2.535m0 0A23.74 23.74 0 0 1 18.795 3m.38 1.125a23.91 23.91 0 0 1 1.014 5.395m-1.014 8.855c-.118.38-.245.754-.38 1.125m.38-1.125a23.91 23.91 0 0 0 1.014-5.395m0-3.46c.495.413.811 1.035.811 1.73 0 .695-.316 1.317-.811 1.73m0-3.46a24.347 24.347 0 0 1 0 3.46"/>
          </svg>
        }
        description="Email and SMS opt-in status, campaign eligibility, and unsubscribe history will be tracked here."
      />

    </div>
  );
}
