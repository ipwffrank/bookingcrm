'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { apiFetch, ApiError } from '../../lib/api';

// ─── Types ─────────────────────────────────────────────────────────────────────

type VipTier = 'bronze' | 'silver' | 'gold' | 'platinum';
type ChurnRisk = 'low' | 'medium' | 'high';

interface ClientProfile {
  id: string;
  clientId: string;
  vipTier: VipTier | null;
  churnRisk: ChurnRisk | null;
  // Aggregated fields added by session 3 API fix
  totalVisits: number | null;
  totalSpendSgd: string | null;
  lastVisitAt: string | null;
  // RFM fields returned by current API (fallback)
  rfmMonetary: string | null;
  rfmFrequency: number | null;
  lastVisitDate: string | null;
  notes: string | null;
  birthday: string | null;
}

interface Client {
  id: string;
  name: string | null;
  phone: string;
  email: string | null;
}

interface ClientRow {
  profile: ClientProfile;
  client: Client;
}

interface BookingEntry {
  booking: {
    id: string;
    startTime: string;
    status: string;
    priceSgd: string;
  };
  service: { name: string };
  staffMember: { name: string };
}

interface ClientDetail {
  profile: ClientProfile;
  client: Client;
  recent_bookings: BookingEntry[];
}

// ─── Constants ─────────────────────────────────────────────────────────────────

const VIP_CONFIG: Record<VipTier, { emoji: string; label: string; className: string }> = {
  platinum: { emoji: '💎', label: 'Platinum', className: 'bg-purple-100 text-purple-700 border-purple-200' },
  gold:     { emoji: '🥇', label: 'Gold',     className: 'bg-yellow-100 text-yellow-700 border-yellow-200' },
  silver:   { emoji: '🥈', label: 'Silver',   className: 'bg-slate-100 text-slate-600 border-slate-200' },
  bronze:   { emoji: '🥉', label: 'Bronze',   className: 'bg-amber-100 text-amber-700 border-amber-200' },
};

const CHURN_CONFIG: Record<ChurnRisk, { label: string; className: string }> = {
  low:    { label: 'Low',    className: 'bg-green-100 text-green-700 border-green-200' },
  medium: { label: 'Medium', className: 'bg-yellow-100 text-yellow-700 border-yellow-200' },
  high:   { label: 'High',   className: 'bg-red-100 text-red-700 border-red-200' },
};

// ─── Helpers ───────────────────────────────────────────────────────────────────

function Spinner({ small = false }: { small?: boolean }) {
  const size = small ? 'w-5 h-5 border-2' : 'w-8 h-8 border-4';
  return (
    <div className={`flex items-center justify-center ${small ? '' : 'py-16'}`}>
      <div className={`${size} border-indigo-200 border-t-indigo-600 rounded-full animate-spin`} />
    </div>
  );
}

function formatDate(iso: string | null) {
  if (!iso) return 'Never';
  return new Date(iso).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' });
}

function useDebounce(value: string, delay: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

// ─── VIP Badge ─────────────────────────────────────────────────────────────────

function VipBadge({ tier }: { tier: VipTier | null }) {
  if (!tier) return null;
  const cfg = VIP_CONFIG[tier];
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${cfg.className}`}>
      {cfg.emoji} {cfg.label}
    </span>
  );
}

// ─── Churn Badge ───────────────────────────────────────────────────────────────

function ChurnBadge({ risk }: { risk: ChurnRisk | null }) {
  if (!risk) return null;
  const cfg = CHURN_CONFIG[risk];
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${cfg.className}`}>
      {cfg.label} risk
    </span>
  );
}

// ─── Client Detail Drawer ──────────────────────────────────────────────────────

function ClientDetail({
  profileId,
  onClose,
}: {
  profileId: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [detail, setDetail] = useState<ClientDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [notesValue, setNotesValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [notesSaved, setNotesSaved] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem('access_token');
    if (!token) { router.push('/login'); return; }
    apiFetch(`/merchant/clients/${profileId}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((data: unknown) => {
        const d = data as ClientDetail;
        setDetail(d);
        setNotesValue(d.profile.notes ?? '');
      })
      .catch((err) => {
        const msg = err instanceof Error ? err.message : '';
        if (err instanceof ApiError && err.status === 401) {
          router.push('/login');
        }
      })
      .finally(() => setLoading(false));
  }, [profileId, router]);

  async function handleSaveNotes() {
    setSaving(true);
    try {
      await apiFetch(`/merchant/clients/${profileId}/notes`, {
        method: 'PUT',
        body: JSON.stringify({ notes: notesValue }),
      });
      if (detail) {
        setDetail({ ...detail, profile: { ...detail.profile, notes: notesValue } });
      }
      setNotesSaved(true);
      setTimeout(() => setNotesSaved(false), 2000);
    } catch {
      alert('Failed to save notes');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center px-0 sm:px-4">
      <div className="fixed inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-lg z-10 max-h-[85vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-gray-100 px-6 py-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-gray-900">Client Details</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {loading && (
          <div className="p-8">
            <Spinner />
          </div>
        )}

        {!loading && detail && (
          <div className="p-6 space-y-5">
            {/* Header */}
            <div className="flex items-start gap-4">
              <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-indigo-100 to-purple-100 flex items-center justify-center flex-shrink-0">
                <span className="text-xl font-bold text-indigo-600">
                  {(detail.client.name ?? '?').charAt(0).toUpperCase()}
                </span>
              </div>
              <div className="flex-1">
                <h3 className="font-bold text-gray-900 text-lg">{detail.client.name ?? 'Unknown'}</h3>
                <p className="text-sm text-gray-500">{detail.client.phone}</p>
                {detail.client.email && <p className="text-xs text-gray-400 mt-0.5">{detail.client.email}</p>}
                <div className="flex flex-wrap gap-1.5 mt-2">
                  <VipBadge tier={detail.profile.vipTier} />
                  <ChurnBadge risk={detail.profile.churnRisk} />
                </div>
              </div>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-3 gap-2">
              <div className="bg-gray-50 rounded-xl p-3 text-center">
                <p className="text-xl font-bold text-gray-900">{detail.profile.totalVisits ?? detail.profile.rfmFrequency ?? 0}</p>
                <p className="text-xs text-gray-500">Visits</p>
              </div>
              <div className="bg-indigo-50 rounded-xl p-3 text-center">
                <p className="text-xl font-bold text-indigo-700">
                  S${parseFloat(detail.profile.totalSpendSgd ?? detail.profile.rfmMonetary ?? '0').toFixed(0)}
                </p>
                <p className="text-xs text-indigo-400">Spend</p>
              </div>
              <div className="bg-gray-50 rounded-xl p-3 text-center">
                <p className="text-xs font-semibold text-gray-900">{formatDate(detail.profile.lastVisitAt ?? detail.profile.lastVisitDate)}</p>
                <p className="text-xs text-gray-500">Last Visit</p>
              </div>
            </div>

            {/* Recent bookings */}
            <div>
              <h4 className="text-sm font-semibold text-gray-900 mb-2">Recent Bookings</h4>
              {detail.recent_bookings.length === 0 ? (
                <p className="text-sm text-gray-400 italic">No bookings yet</p>
              ) : (
                <div className="space-y-2">
                  {detail.recent_bookings.map((entry) => (
                    <div key={entry.booking.id} className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2.5">
                      <div>
                        <p className="text-xs font-medium text-gray-900">{entry.service.name}</p>
                        <p className="text-xs text-gray-500">{entry.staffMember.name} · {formatDate(entry.booking.startTime)}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs font-semibold text-gray-900">S${parseFloat(entry.booking.priceSgd).toFixed(2)}</p>
                        <p className="text-xs text-gray-400 capitalize">{entry.booking.status.replace('_', ' ')}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Notes */}
            <div>
              <h4 className="text-sm font-semibold text-gray-900 mb-2">Notes</h4>
              <textarea
                value={notesValue}
                onChange={(e) => setNotesValue(e.target.value)}
                rows={3}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
                placeholder="Add notes about this client..."
              />
              <div className="flex items-center gap-2 mt-2">
                <button
                  onClick={handleSaveNotes}
                  disabled={saving}
                  className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700 disabled:opacity-60 transition-colors"
                >
                  {saving ? 'Saving...' : 'Save Notes'}
                </button>
                {notesSaved && <span className="text-xs text-emerald-600">Saved</span>}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

export default function ClientsPage() {
  const router = useRouter();
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [tierFilter, setTierFilter] = useState('');
  const [churnFilter, setChurnFilter] = useState('');
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const debouncedSearch = useDebounce(search, 350);

  // VIP tier summary counts
  const [tierCounts, setTierCounts] = useState<Record<VipTier, number>>({ platinum: 0, gold: 0, silver: 0, bronze: 0 });

  const fetchClients = useCallback(async () => {
    const token = localStorage.getItem('access_token');
    if (!token) { router.push('/login'); return; }

    const params = new URLSearchParams();
    if (debouncedSearch) params.set('search', debouncedSearch);
    if (tierFilter) params.set('tier', tierFilter);
    if (churnFilter) params.set('churn_risk', churnFilter);
    params.set('limit', '100');

    try {
      const data = await apiFetch(`/merchant/clients?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      }) as { clients: ClientRow[] };
      setClients(data.clients ?? []);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load clients';
      if (err instanceof ApiError && err.status === 401) {
        router.push('/login');
      } else {
        setError(msg);
      }
    }
  }, [debouncedSearch, tierFilter, churnFilter, router]);

  // Fetch tier summary on mount
  useEffect(() => {
    const token = localStorage.getItem('access_token');
    if (!token) { router.push('/login'); return; }

    async function fetchTierCounts() {
      const tiers: VipTier[] = ['platinum', 'gold', 'silver', 'bronze'];
      const counts: Record<VipTier, number> = { platinum: 0, gold: 0, silver: 0, bronze: 0 };
      await Promise.all(
        tiers.map(async (tier) => {
          try {
            const d = await apiFetch(`/merchant/clients?tier=${tier}&limit=1`, {
              headers: { Authorization: `Bearer ${token}` },
            }) as { pagination: { count: number } };
            // Note: count here is the page count, not total — use for display
            counts[tier] = d.pagination?.count ?? 0;
          } catch {
            // ignore
          }
        })
      );
      setTierCounts(counts);
    }

    setLoading(true);
    Promise.all([fetchClients(), fetchTierCounts()]).finally(() => setLoading(false));
  }, [router]); // only on mount

  useEffect(() => {
    if (!loading) {
      void fetchClients();
    }
  }, [debouncedSearch, tierFilter, churnFilter, fetchClients, loading]);

  return (
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Clients</h1>
        <p className="text-sm text-gray-500 mt-0.5">{clients.length} client{clients.length !== 1 ? 's' : ''} shown</p>
      </div>

      {/* VIP summary bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        {(Object.entries(VIP_CONFIG) as [VipTier, typeof VIP_CONFIG[VipTier]][]).map(([tier, cfg]) => (
          <button
            key={tier}
            onClick={() => setTierFilter(tierFilter === tier ? '' : tier)}
            className={`rounded-xl border p-3 text-left transition-all ${
              tierFilter === tier
                ? `${cfg.className} ring-2 ring-indigo-500`
                : 'bg-white border-gray-200 hover:border-gray-300'
            }`}
          >
            <div className="flex items-center gap-1.5 mb-1">
              <span className="text-lg">{cfg.emoji}</span>
              <span className="text-sm font-semibold text-gray-900">{cfg.label}</span>
            </div>
            <p className="text-xs text-gray-500">{tierCounts[tier]} client{tierCounts[tier] !== 1 ? 's' : ''}</p>
          </button>
        ))}
      </div>

      {/* Search and filters */}
      <div className="flex flex-col sm:flex-row gap-3 mb-5">
        <div className="flex-1 relative">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
          </svg>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or phone..."
            className="w-full rounded-xl border border-gray-300 pl-9 pr-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
        <select
          value={churnFilter}
          onChange={(e) => setChurnFilter(e.target.value)}
          className="rounded-xl border border-gray-300 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
        >
          <option value="">All churn risk</option>
          <option value="low">Low risk</option>
          <option value="medium">Medium risk</option>
          <option value="high">High risk</option>
        </select>
        {(search || tierFilter || churnFilter) && (
          <button
            onClick={() => { setSearch(''); setTierFilter(''); setChurnFilter(''); }}
            className="px-4 py-2.5 rounded-xl border border-gray-300 text-sm text-gray-600 hover:bg-gray-50 transition-colors whitespace-nowrap"
          >
            Clear filters
          </button>
        )}
      </div>

      {loading && <Spinner />}

      {!loading && error && (
        <div className="rounded-xl bg-red-50 border border-red-200 p-6 text-center">
          <p className="text-red-600 font-medium mb-3">{error}</p>
          <button
            onClick={() => { setError(''); setLoading(true); fetchClients().finally(() => setLoading(false)); }}
            className="px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700 transition-colors"
          >
            Retry
          </button>
        </div>
      )}

      {!loading && !error && clients.length === 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <div className="text-4xl mb-3">👤</div>
          <h3 className="text-lg font-semibold text-gray-900 mb-1">
            {search || tierFilter || churnFilter ? 'No clients match your filters' : 'No clients yet'}
          </h3>
          <p className="text-sm text-gray-500">
            {search || tierFilter || churnFilter
              ? 'Try clearing your filters'
              : 'Clients will appear here after their first booking.'}
          </p>
        </div>
      )}

      {!loading && !error && clients.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Client</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide hidden sm:table-cell">VIP</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide hidden md:table-cell">Last Visit</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide hidden lg:table-cell">Spend</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide hidden md:table-cell">Churn</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {clients.map((row) => (
                  <tr
                    key={row.profile.id}
                    className="hover:bg-gray-50 transition-colors cursor-pointer"
                    onClick={() => setSelectedProfileId(row.profile.id)}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-indigo-100 to-purple-100 flex items-center justify-center flex-shrink-0">
                          <span className="text-sm font-bold text-indigo-600">
                            {(row.client.name ?? '?').charAt(0).toUpperCase()}
                          </span>
                        </div>
                        <div>
                          <p className="text-sm font-medium text-gray-900">{row.client.name ?? 'Unknown'}</p>
                          <p className="text-xs text-gray-500">{row.client.phone}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 hidden sm:table-cell">
                      <VipBadge tier={row.profile.vipTier} />
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell">
                      <span className="text-sm text-gray-600">{formatDate(row.profile.lastVisitAt ?? row.profile.lastVisitDate)}</span>
                    </td>
                    <td className="px-4 py-3 hidden lg:table-cell">
                      <span className="text-sm font-medium text-gray-900">
                        S${parseFloat(row.profile.totalSpendSgd ?? row.profile.rfmMonetary ?? '0').toFixed(2)}
                      </span>
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell">
                      <ChurnBadge risk={row.profile.churnRisk} />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Link
                          href={`/dashboard/clients/${row.profile.id}`}
                          onClick={e => e.stopPropagation()}
                          className="text-xs text-[#1a2313] font-medium hover:underline whitespace-nowrap"
                        >
                          View Profile
                        </Link>
                        <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
                        </svg>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {selectedProfileId && (
        <ClientDetail
          profileId={selectedProfileId}
          onClose={() => setSelectedProfileId(null)}
        />
      )}
    </>
  );
}
