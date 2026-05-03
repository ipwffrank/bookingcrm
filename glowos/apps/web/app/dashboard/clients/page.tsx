'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch, ApiError } from '../../lib/api';
import { NoShowChip } from '../components/NoShowChip';
import { ClientDetailPanel } from '../components/ClientDetailPanel';

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

// Tier criteria reflect the RFM (Recency, Frequency, Monetary) scoring done
// by services/api/src/workers/vip.worker.ts. Score = R*0.3 + F*0.35 + M*0.35,
// each on a 1-5 scale relative to this merchant's client base. Cutoffs:
// Platinum ≥ 4.2, Gold ≥ 3.5, Silver ≥ 2.5, Bronze < 2.5.
const VIP_CONFIG: Record<VipTier, { emoji: string; label: string; className: string; criteria: string; tooltip: string }> = {
  platinum: {
    emoji: '💎',
    label: 'Platinum',
    className: 'bg-grey-15 text-grey-75 border-grey-15',
    criteria: 'Top spenders, recent & loyal',
    tooltip: 'RFM score ≥ 4.2 / 5 — best 5–10% of your client base on recency, frequency, and spend combined.',
  },
  gold: {
    emoji: '🥇',
    label: 'Gold',
    className: 'bg-semantic-warn/10 text-semantic-warn border-semantic-warn/30',
    criteria: 'Frequent visits, strong spend',
    tooltip: 'RFM score 3.5–4.2 — regulars with above-average frequency and revenue.',
  },
  silver: {
    emoji: '🥈',
    label: 'Silver',
    className: 'bg-grey-15 text-grey-75 border-grey-15',
    criteria: 'Steady, periodic customers',
    tooltip: 'RFM score 2.5–3.5 — active clients who visit moderately and spend at typical levels.',
  },
  bronze: {
    emoji: '🥉',
    label: 'Bronze',
    className: 'bg-semantic-warn/10 text-semantic-warn border-semantic-warn/30',
    criteria: 'New, occasional, or dormant',
    tooltip: 'RFM score < 2.5 — new sign-ups, one-time visits, or clients whose last visit was long ago.',
  },
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
  // Bulk-export selection state. Rows are selected by checkbox; "Select all"
  // toggles every visible (filtered) row at once.
  const [selectedForExport, setSelectedForExport] = useState<Set<string>>(new Set());
  const [bulkExporting, setBulkExporting] = useState(false);
  const [bulkExportError, setBulkExportError] = useState<string | null>(null);
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

  // ─── Bulk-export helpers ─────────────────────────────────────────────
  const visibleIds = clients.map((c) => c.profile.id);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedForExport.has(id));
  const someVisibleSelected = !allVisibleSelected && visibleIds.some((id) => selectedForExport.has(id));

  function toggleOne(profileId: string) {
    setSelectedForExport((prev) => {
      const next = new Set(prev);
      if (next.has(profileId)) next.delete(profileId);
      else next.add(profileId);
      return next;
    });
  }
  function toggleAllVisible() {
    setSelectedForExport((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        for (const id of visibleIds) next.delete(id);
      } else {
        for (const id of visibleIds) next.add(id);
      }
      return next;
    });
  }
  function clearSelection() {
    setSelectedForExport(new Set());
  }

  async function exportSelected() {
    if (selectedForExport.size === 0) return;
    setBulkExporting(true);
    setBulkExportError(null);
    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
      const token = localStorage.getItem('access_token');
      const res = await fetch(`${apiUrl}/merchant/clients/profile-pdf-bulk`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ profile_ids: Array.from(selectedForExport) }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message ?? `Bulk export failed (${res.status})`);
      }
      // Download the combined PDF rather than open inline — bulk reports
      // are typically saved/shared, not previewed inline.
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      // Filename comes from Content-Disposition; browsers respect it on download.
      a.download = '';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch (err) {
      setBulkExportError(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setBulkExporting(false);
    }
  }

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
            title={cfg.tooltip}
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
            <p className="text-[11px] text-grey-60 mt-1 leading-snug">{cfg.criteria}</p>
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
        <>
          {/* Bulk-action toolbar — only visible when at least one row selected.
              Sticky above the table so the user keeps it in view while scrolling
              through long client lists. */}
          {selectedForExport.size > 0 && (
            <div className="sticky top-0 z-10 mb-3 rounded-xl border border-tone-sage/40 bg-tone-sage/10 px-4 py-2.5 flex items-center justify-between gap-3">
              <span className="text-sm text-tone-ink font-medium">
                {selectedForExport.size} client{selectedForExport.size === 1 ? '' : 's'} selected
              </span>
              <div className="flex items-center gap-2">
                {bulkExportError && (
                  <span className="text-xs text-semantic-danger">{bulkExportError}</span>
                )}
                <button
                  onClick={clearSelection}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium text-grey-70 hover:text-tone-ink hover:bg-grey-5 transition-colors"
                >
                  Clear
                </button>
                <button
                  onClick={() => { void exportSelected(); }}
                  disabled={bulkExporting}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold text-tone-surface bg-tone-ink hover:bg-tone-ink/90 disabled:opacity-50 transition-colors flex items-center gap-1.5"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
                  </svg>
                  {bulkExporting ? 'Generating PDF…' : `Export ${selectedForExport.size} as PDF`}
                </button>
              </div>
            </div>
          )}
        <div className="bg-tone-surface rounded-xl border border-grey-15 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-grey-5 bg-grey-5">
                  <th className="px-4 py-3 w-10">
                    {/* Indeterminate checkbox: ticks visibly when all visible
                        rows are selected; shows a dash via the indeterminate
                        attribute when only some are. Click toggles all. */}
                    <input
                      type="checkbox"
                      aria-label="Select all visible"
                      checked={allVisibleSelected}
                      ref={(el) => { if (el) el.indeterminate = someVisibleSelected; }}
                      onChange={toggleAllVisible}
                      className="w-4 h-4 accent-tone-ink cursor-pointer"
                    />
                  </th>
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
                    className={`hover:bg-grey-5 transition-colors cursor-pointer ${selectedForExport.has(row.profile.id) ? 'bg-tone-sage/5' : ''}`}
                    onClick={() => setSelectedProfileId(row.profile.id)}
                  >
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        aria-label={`Select ${row.client.name ?? row.client.phone}`}
                        checked={selectedForExport.has(row.profile.id)}
                        onChange={() => toggleOne(row.profile.id)}
                        className="w-4 h-4 accent-tone-ink cursor-pointer"
                      />
                    </td>
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
                      <svg className="w-4 h-4 text-grey-45" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
                      </svg>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        </>
      )}

      {selectedProfileId && (
        <ClientDetailPanel
          profileId={selectedProfileId}
          onClose={() => setSelectedProfileId(null)}
        />
      )}
    </>
  );
}
