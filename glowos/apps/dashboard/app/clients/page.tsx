'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { apiFetch } from '../lib/api';
import DashboardShell from '../components/DashboardShell';

type VipTier = 'bronze' | 'silver' | 'gold' | 'platinum';
type ChurnRisk = 'low' | 'medium' | 'high';

interface ClientRow {
  id: string;
  name: string | null;
  phone: string;
  email: string | null;
  vipTier: VipTier | null;
  churnRisk: ChurnRisk | null;
  totalSpend: string | null;
  visitCount: number | null;
  lastVisitAt: string | null;
}

const VIP_BADGES: Record<VipTier, string> = {
  platinum: '💎',
  gold: '🥇',
  silver: '🥈',
  bronze: '🥉',
};

const CHURN_STYLES: Record<ChurnRisk, string> = {
  low: 'bg-green-100 text-green-700',
  medium: 'bg-amber-100 text-amber-700',
  high: 'bg-red-100 text-red-600',
};

const TIER_COLORS: Record<VipTier, string> = {
  platinum: 'bg-purple-100 text-purple-700',
  gold: 'bg-yellow-100 text-yellow-700',
  silver: 'bg-gray-100 text-gray-600',
  bronze: 'bg-orange-100 text-orange-700',
};

export default function ClientsPage() {
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [tierFilter, setTierFilter] = useState('');
  const [churnFilter, setChurnFilter] = useState('');

  const fetchClients = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = (await apiFetch('/merchant/clients')) as { clients: ClientRow[] };
      setClients(res.clients);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load clients');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchClients();
  }, [fetchClients]);

  const filtered = clients.filter((c) => {
    const q = search.toLowerCase();
    const matchSearch =
      !q ||
      (c.name ?? '').toLowerCase().includes(q) ||
      c.phone.includes(q) ||
      (c.email ?? '').toLowerCase().includes(q);
    const matchTier = !tierFilter || c.vipTier === tierFilter;
    const matchChurn = !churnFilter || c.churnRisk === churnFilter;
    return matchSearch && matchTier && matchChurn;
  });

  // VIP summary
  const tierCounts = (['platinum', 'gold', 'silver', 'bronze'] as VipTier[]).map((tier) => ({
    tier,
    count: clients.filter((c) => c.vipTier === tier).length,
  }));

  const attentionNeeded = clients.filter((c) => c.churnRisk === 'high');

  return (
    <DashboardShell>
      <div className="max-w-5xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Clients</h1>
          <p className="text-gray-500 text-sm mt-0.5">Your client database — {clients.length} total</p>
        </div>

        {/* VIP Summary */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {tierCounts.map(({ tier, count }) => (
            <div
              key={tier}
              className="bg-white rounded-xl border border-gray-100 px-4 py-3 flex items-center gap-3"
            >
              <span className="text-2xl">{VIP_BADGES[tier]}</span>
              <div>
                <div className="text-xl font-bold text-gray-900">{count}</div>
                <div className="text-xs text-gray-500 capitalize">{tier}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Attention Needed */}
        {attentionNeeded.length > 0 && (
          <div className="bg-red-50 border border-red-100 rounded-xl px-5 py-4">
            <div className="text-sm font-semibold text-red-700 mb-2">
              ⚠️ {attentionNeeded.length} client{attentionNeeded.length > 1 ? 's' : ''} at risk of
              churning
            </div>
            <div className="flex flex-wrap gap-2">
              {attentionNeeded.slice(0, 5).map((c) => (
                <Link
                  key={c.id}
                  href={`/clients/${c.id}`}
                  className="inline-flex items-center gap-1.5 rounded-full bg-white border border-red-200 px-3 py-1 text-xs font-medium text-red-700 hover:bg-red-50 transition-colors"
                >
                  {c.vipTier && VIP_BADGES[c.vipTier]} {c.name ?? c.phone}
                </Link>
              ))}
              {attentionNeeded.length > 5 && (
                <span className="text-xs text-red-500 self-center">
                  +{attentionNeeded.length - 5} more
                </span>
              )}
            </div>
          </div>
        )}

        {/* Filters */}
        <div className="flex flex-wrap gap-3">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, phone, email…"
            className="flex-1 min-w-48 rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <select
            value={tierFilter}
            onChange={(e) => setTierFilter(e.target.value)}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="">All tiers</option>
            <option value="platinum">💎 Platinum</option>
            <option value="gold">🥇 Gold</option>
            <option value="silver">🥈 Silver</option>
            <option value="bronze">🥉 Bronze</option>
          </select>
          <select
            value={churnFilter}
            onChange={(e) => setChurnFilter(e.target.value)}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="">All risk levels</option>
            <option value="high">High churn risk</option>
            <option value="medium">Medium risk</option>
            <option value="low">Low risk</option>
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

        {!loading && !error && filtered.length === 0 && (
          <div className="text-center py-16 text-gray-400">
            <div className="text-5xl mb-3">👥</div>
            <p>No clients found</p>
          </div>
        )}

        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          {filtered.map((client, idx) => (
            <Link
              key={client.id}
              href={`/clients/${client.id}`}
              className={`flex items-center gap-4 px-5 py-4 hover:bg-indigo-50 transition-colors ${
                idx > 0 ? 'border-t border-gray-50' : ''
              }`}
            >
              {/* Avatar */}
              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-indigo-300 to-purple-400 flex items-center justify-center text-white text-sm font-semibold shrink-0">
                {(client.name ?? client.phone).charAt(0).toUpperCase()}
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-gray-900 truncate">
                    {client.name ?? '—'}
                  </span>
                  {client.vipTier && (
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${TIER_COLORS[client.vipTier]}`}
                    >
                      {VIP_BADGES[client.vipTier]} {client.vipTier}
                    </span>
                  )}
                </div>
                <div className="text-xs text-gray-500 mt-0.5">
                  {client.phone}
                  {client.email ? ` · ${client.email}` : ''}
                </div>
              </div>

              <div className="text-right shrink-0 space-y-1">
                {client.totalSpend && (
                  <div className="text-sm font-medium text-gray-900">
                    SGD {parseFloat(client.totalSpend).toFixed(0)}
                  </div>
                )}
                {client.visitCount != null && (
                  <div className="text-xs text-gray-400">{client.visitCount} visits</div>
                )}
                {client.churnRisk && client.churnRisk !== 'low' && (
                  <span
                    className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${CHURN_STYLES[client.churnRisk]}`}
                  >
                    {client.churnRisk === 'high' ? '⚠️ High risk' : '⚡ Medium risk'}
                  </span>
                )}
              </div>
            </Link>
          ))}
        </div>
      </div>
    </DashboardShell>
  );
}
