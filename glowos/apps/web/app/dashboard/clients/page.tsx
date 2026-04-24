'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { apiFetch, ApiError } from '../../lib/api';
import { NoShowChip } from '../components/NoShowChip';

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
  noShowCount?: number;
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
  platinum: { emoji: '💎', label: 'Platinum', className: 'bg-grey-15 text-grey-75 border-grey-15' },
  gold:     { emoji: '🥇', label: 'Gold',     className: 'bg-semantic-warn/10 text-semantic-warn border-semantic-warn/30' },
  silver:   { emoji: '🥈', label: 'Silver',   className: 'bg-grey-15 text-grey-75 border-grey-15' },
  bronze:   { emoji: '🥉', label: 'Bronze',   className: 'bg-semantic-warn/10 text-semantic-warn border-semantic-warn/30' },
};

const CHURN_CONFIG: Record<ChurnRisk, { label: string; className: string }> = {
  low:    { label: 'Low',    className: 'bg-tone-sage/10 text-tone-sage border-tone-sage/30' },
  medium: { label: 'Medium', className: 'bg-semantic-warn/10 text-semantic-warn border-semantic-warn/30' },
  high:   { label: 'High',   className: 'bg-semantic-danger/10 text-semantic-danger border-semantic-danger/30' },
};

// ─── Helpers ───────────────────────────────────────────────────────────────────

function Spinner({ small = false }: { small?: boolean }) {
  const size = small ? 'w-5 h-5 border-2' : 'w-8 h-8 border-4';
  return (
    <div className={`flex items-center justify-center ${small ? '' : 'py-16'}`}>
      <div className={`${size} border-tone-sage/30 border-t-tone-ink rounded-full animate-spin`} />
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

interface NoteEntry {
  id: string;
  staffName: string | null;
  content: string;
  createdAt: string;
}

function ClientDetailDrawer({
  profileId,
  onClose,
}: {
  profileId: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [detail, setDetail] = useState<ClientDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [treatmentLog, setTreatmentLog] = useState<NoteEntry[]>([]);
  const [newNoteContent, setNewNoteContent] = useState('');
  const [addingNote, setAddingNote] = useState(false);
  const [showAddNote, setShowAddNote] = useState(false);
  const [clientPkgs, setClientPkgs] = useState<any[]>([]);

  useEffect(() => {
    const token = localStorage.getItem('access_token');
    if (!token) { router.push('/login'); return; }

    Promise.all([
      apiFetch(`/merchant/clients/${profileId}`, {
        headers: { Authorization: `Bearer ${token}` },
      }),
      apiFetch(`/merchant/clients/${profileId}/notes`).catch(() => ({ notes: [] })),
    ])
      .then(([clientData, notesData]) => {
        const d = clientData as ClientDetail;
        setDetail(d);
        setTreatmentLog((notesData as { notes: NoteEntry[] }).notes ?? []);
        // Fetch packages
        if (d.client?.id) {
          apiFetch(`/merchant/packages/client/${d.client.id}`)
            .then((pd: any) => setClientPkgs(pd.packages ?? []))
            .catch(() => {});
        }
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) {
          router.push('/login');
        }
      })
      .finally(() => setLoading(false));
  }, [profileId, router]);

  async function handleAddNote() {
    if (!newNoteContent.trim()) return;
    setAddingNote(true);
    try {
      const result = await apiFetch(`/merchant/clients/${profileId}/notes`, {
        method: 'POST',
        body: JSON.stringify({ content: newNoteContent.trim() }),
      }) as { note: NoteEntry };
      setTreatmentLog(prev => [result.note, ...prev]);
      setNewNoteContent('');
      setShowAddNote(false);
    } catch {
      alert('Failed to save note');
    } finally {
      setAddingNote(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center px-0 sm:px-4">
      <div className="fixed inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-tone-surface rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-lg z-10 max-h-[85vh] overflow-y-auto">
        <div className="sticky top-0 bg-tone-surface border-b border-grey-5 px-6 py-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-tone-ink">Client Details</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg text-grey-45 hover:text-grey-75 hover:bg-grey-15 transition-colors">
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
                <span className="text-xl font-bold text-tone-sage">
                  {(detail.client.name ?? '?').charAt(0).toUpperCase()}
                </span>
              </div>
              <div className="flex-1">
                <h3 className="font-bold text-tone-ink text-lg">{detail.client.name ?? 'Unknown'}</h3>
                <p className="text-sm text-grey-60">{detail.client.phone}</p>
                {detail.client.email && <p className="text-xs text-grey-45 mt-0.5">{detail.client.email}</p>}
                <div className="flex flex-wrap gap-1.5 mt-2">
                  <VipBadge tier={detail.profile.vipTier} />
                  <ChurnBadge risk={detail.profile.churnRisk} />
                </div>
              </div>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-3 gap-2">
              <div className="bg-grey-5 rounded-xl p-3 text-center">
                <p className="text-xl font-bold text-tone-ink">{detail.profile.totalVisits ?? detail.profile.rfmFrequency ?? 0}</p>
                <p className="text-xs text-grey-60">Visits</p>
              </div>
              <div className="bg-tone-sage/10 rounded-xl p-3 text-center">
                <p className="text-xl font-bold text-tone-sage">
                  S${parseFloat(detail.profile.totalSpendSgd ?? detail.profile.rfmMonetary ?? '0').toFixed(0)}
                </p>
                <p className="text-xs text-grey-60">Spend</p>
              </div>
              <div className="bg-grey-5 rounded-xl p-3 text-center">
                <p className="text-xs font-semibold text-tone-ink">{formatDate(detail.profile.lastVisitAt ?? detail.profile.lastVisitDate)}</p>
                <p className="text-xs text-grey-60">Last Visit</p>
              </div>
            </div>

            {/* Recent bookings */}
            <div>
              <h4 className="text-sm font-semibold text-tone-ink mb-2">Recent Bookings</h4>
              {detail.recent_bookings.length === 0 ? (
                <p className="text-sm text-grey-45 italic">No bookings yet</p>
              ) : (
                <div className="space-y-2">
                  {detail.recent_bookings.map((entry) => (
                    <div key={entry.booking.id} className="flex items-center justify-between bg-grey-5 rounded-lg px-3 py-2.5">
                      <div>
                        <p className="text-xs font-medium text-tone-ink">{entry.service.name}</p>
                        <p className="text-xs text-grey-60">{entry.staffMember.name} · {formatDate(entry.booking.startTime)}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs font-semibold text-tone-ink">S${parseFloat(entry.booking.priceSgd).toFixed(2)}</p>
                        <p className="text-xs text-grey-45 capitalize">{entry.booking.status.replace('_', ' ')}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Treatment Log */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-semibold text-tone-ink">Treatment Log</h4>
                <button
                  onClick={() => setShowAddNote(true)}
                  className="text-xs font-medium text-tone-sage hover:text-tone-sage transition-colors"
                >
                  + Add Entry
                </button>
              </div>

              {/* Add note form */}
              {showAddNote && (
                <div className="space-y-2">
                  <textarea
                    value={newNoteContent}
                    onChange={e => setNewNoteContent(e.target.value)}
                    rows={3}
                    placeholder="Treatment details, client preferences, observations..."
                    className="w-full border border-grey-15 rounded-lg px-3 py-2 text-sm text-grey-90 focus:outline-none focus:ring-1 focus:ring-tone-sage/30 resize-none"
                    autoFocus
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={handleAddNote}
                      disabled={!newNoteContent.trim() || addingNote}
                      className="px-4 py-1.5 bg-tone-ink text-white text-xs font-medium rounded-lg hover:opacity-90 disabled:opacity-50 transition-colors"
                    >
                      {addingNote ? 'Saving...' : 'Save Entry'}
                    </button>
                    <button
                      onClick={() => { setShowAddNote(false); setNewNoteContent(''); }}
                      className="px-4 py-1.5 bg-grey-15 text-grey-75 text-xs font-medium rounded-lg hover:bg-grey-15 transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {treatmentLog.length === 0 ? (
                <p className="text-xs text-grey-45 italic">No entries yet.</p>
              ) : (
                <div className="space-y-3 max-h-64 overflow-y-auto">
                  {treatmentLog.map(entry => (
                    <div key={entry.id} className="border-l-2 border-tone-sage/30 pl-3 py-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-grey-75">{entry.staffName || 'Admin'}</span>
                        <span className="text-[10px] text-grey-45">
                          {new Date(entry.createdAt).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' })}
                          {' '}
                          {new Date(entry.createdAt).toLocaleTimeString('en-SG', { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                      <p className="text-xs text-grey-75 mt-1 leading-relaxed whitespace-pre-wrap">{entry.content}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Packages */}
            {clientPkgs.length > 0 && (
              <div>
                <h4 className="text-sm font-semibold text-tone-ink mb-3">Packages</h4>
                <div className="space-y-3">
                  {clientPkgs.map((pkg: any) => (
                    <div key={pkg.id} className="border border-grey-5 rounded-lg p-3">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-semibold text-tone-ink">{pkg.packageName}</span>
                        <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${
                          pkg.status === 'active' ? 'bg-tone-sage/5 text-tone-sage' :
                          pkg.status === 'completed' ? 'bg-grey-15 text-grey-60' :
                          'bg-semantic-danger/5 text-semantic-danger'
                        }`}>{pkg.status}</span>
                      </div>
                      <div className="flex items-center gap-2 mb-2">
                        <div className="flex-1 h-1.5 bg-grey-15 rounded-full overflow-hidden">
                          <div className="h-full bg-tone-ink rounded-full" style={{ width: `${(pkg.sessionsUsed / pkg.sessionsTotal) * 100}%` }} />
                        </div>
                        <span className="text-[10px] font-medium text-grey-60">{pkg.sessionsUsed}/{pkg.sessionsTotal}</span>
                      </div>
                      <div className="space-y-1">
                        {pkg.sessions?.map((s: any) => (
                          <div key={s.id} className="flex items-center justify-between text-xs py-1">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className={`w-2 h-2 rounded-full flex-shrink-0 ${s.status === 'completed' ? 'bg-tone-sage' : s.status === 'booked' ? 'bg-grey-45' : 'bg-grey-30'}`} />
                              <span className="text-grey-75 truncate">
                                {s.serviceName ?? `Session ${s.sessionNumber}`}
                                {s.serviceName ? ` · #${s.sessionNumber}` : ''}
                              </span>
                            </div>
                            <div className="flex items-center gap-2 flex-shrink-0">
                              <span className="text-grey-45 capitalize">{s.status}</span>
                              {s.status === 'pending' || s.status === 'booked' ? (
                                <button
                                  onClick={async () => {
                                    if (!confirm(`Mark ${s.serviceName ?? `Session ${s.sessionNumber}`} as completed?`)) return;
                                    try {
                                      await apiFetch(`/merchant/packages/sessions/${s.id}/complete`, {
                                        method: 'PUT',
                                        body: JSON.stringify({}),
                                      });
                                      // Refresh packages
                                      if (detail?.client?.id) {
                                        const pd = await apiFetch(`/merchant/packages/client/${detail.client.id}`) as any;
                                        setClientPkgs(pd.packages ?? []);
                                      }
                                    } catch { alert('Failed to update session'); }
                                  }}
                                  className="text-[10px] text-tone-sage hover:text-tone-sage font-medium"
                                >
                                  Mark Done
                                </button>
                              ) : null}
                            </div>
                          </div>
                        ))}
                      </div>
                      <p className="text-[10px] text-grey-45 mt-1">Expires {new Date(pkg.expiresAt).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' })}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
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
            const d = await apiFetch(`/merchant/clients?tier=${tier}&limit=1`) as { pagination: { total: number } };
            counts[tier] = d.pagination?.total ?? 0;
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
        <h1 className="text-2xl font-bold text-tone-ink">Clients</h1>
        <p className="text-sm text-grey-60 mt-0.5">{clients.length} client{clients.length !== 1 ? 's' : ''} shown</p>
      </div>

      {/* VIP summary bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        {(Object.entries(VIP_CONFIG) as [VipTier, typeof VIP_CONFIG[VipTier]][]).map(([tier, cfg]) => (
          <button
            key={tier}
            onClick={() => setTierFilter(tierFilter === tier ? '' : tier)}
            className={`rounded-xl border p-3 text-left transition-all ${
              tierFilter === tier
                ? `${cfg.className} ring-2 ring-tone-sage`
                : 'bg-tone-surface border-grey-15 hover:border-grey-30'
            }`}
          >
            <div className="flex items-center gap-1.5 mb-1">
              <span className="text-lg">{cfg.emoji}</span>
              <span className="text-sm font-semibold text-tone-ink">{cfg.label}</span>
            </div>
            <p className="text-xs text-grey-60">{tierCounts[tier]} client{tierCounts[tier] !== 1 ? 's' : ''}</p>
          </button>
        ))}
      </div>

      {/* Search and filters */}
      <div className="flex flex-col sm:flex-row gap-3 mb-5">
        <div className="flex-1 relative">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-grey-45" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
          </svg>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or phone..."
            className="w-full rounded-xl border border-grey-30 pl-9 pr-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-tone-sage"
          />
        </div>
        <select
          value={churnFilter}
          onChange={(e) => setChurnFilter(e.target.value)}
          className="rounded-xl border border-grey-30 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-tone-sage"
        >
          <option value="">All churn risk</option>
          <option value="low">Low risk</option>
          <option value="medium">Medium risk</option>
          <option value="high">High risk</option>
        </select>
        {(search || tierFilter || churnFilter) && (
          <button
            onClick={() => { setSearch(''); setTierFilter(''); setChurnFilter(''); }}
            className="px-4 py-2.5 rounded-xl border border-grey-30 text-sm text-grey-75 hover:bg-grey-5 transition-colors whitespace-nowrap"
          >
            Clear filters
          </button>
        )}
      </div>

      {loading && <Spinner />}

      {!loading && error && (
        <div className="rounded-xl bg-semantic-danger/5 border border-semantic-danger/30 p-6 text-center">
          <p className="text-semantic-danger font-medium mb-3">{error}</p>
          <button
            onClick={() => { setError(''); setLoading(true); fetchClients().finally(() => setLoading(false)); }}
            className="px-4 py-2 rounded-lg bg-semantic-danger text-white text-sm font-medium hover:bg-semantic-danger transition-colors"
          >
            Retry
          </button>
        </div>
      )}

      {!loading && !error && clients.length === 0 && (
        <div className="bg-tone-surface rounded-xl border border-grey-15 p-12 text-center">
          <div className="text-4xl mb-3">👤</div>
          <h3 className="text-lg font-semibold text-tone-ink mb-1">
            {search || tierFilter || churnFilter ? 'No clients match your filters' : 'No clients yet'}
          </h3>
          <p className="text-sm text-grey-60">
            {search || tierFilter || churnFilter
              ? 'Try clearing your filters'
              : 'Clients will appear here after their first booking.'}
          </p>
        </div>
      )}

      {!loading && !error && clients.length > 0 && (
        <div className="bg-tone-surface rounded-xl border border-grey-15 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-grey-5 bg-grey-5">
                  <th className="text-left px-4 py-3 text-xs font-semibold text-grey-60 uppercase tracking-wide">Client</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-grey-60 uppercase tracking-wide hidden sm:table-cell">VIP</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-grey-60 uppercase tracking-wide hidden md:table-cell">Last Visit</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-grey-60 uppercase tracking-wide hidden lg:table-cell">Spend</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-grey-60 uppercase tracking-wide hidden md:table-cell">Churn</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-grey-5">
                {clients.map((row) => (
                  <tr
                    key={row.profile.id}
                    className="hover:bg-grey-5 transition-colors cursor-pointer"
                    onClick={() => setSelectedProfileId(row.profile.id)}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-indigo-100 to-purple-100 flex items-center justify-center flex-shrink-0">
                          <span className="text-sm font-bold text-tone-sage">
                            {(row.client.name ?? '?').charAt(0).toUpperCase()}
                          </span>
                        </div>
                        <div>
                          <div className="flex items-center gap-1.5">
                            <p className="text-sm font-medium text-tone-ink">{row.client.name ?? 'Unknown'}</p>
                            <NoShowChip count={row.noShowCount ?? 0} compact />
                          </div>
                          <p className="text-xs text-grey-60">{row.client.phone}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 hidden sm:table-cell">
                      <VipBadge tier={row.profile.vipTier} />
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell">
                      <span className="text-sm text-grey-75">{formatDate(row.profile.lastVisitAt ?? row.profile.lastVisitDate)}</span>
                    </td>
                    <td className="px-4 py-3 hidden lg:table-cell">
                      <span className="text-sm font-medium text-tone-ink">
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
                        <svg className="w-4 h-4 text-grey-45" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
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
        <ClientDetailDrawer
          profileId={selectedProfileId}
          onClose={() => setSelectedProfileId(null)}
        />
      )}
    </>
  );
}
