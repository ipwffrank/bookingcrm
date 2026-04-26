'use client';

import { useEffect, useState } from 'react';

interface OverviewData {
  revenue: number;
  bookingCount: number;
  activeClients: number;
  revenueByBranch: { merchantId: string; name: string; revenue: number }[];
  opsHealth: { merchantId: string; name: string; bookingCount: number }[];
  topClients: { id: string; name: string; phone: string; totalSpend: number }[];
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

function fmtCurrency(n: number) {
  return `$${n.toLocaleString('en-SG', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function DateRangePicker({ from, to, onChange }: {
  from: string; to: string;
  onChange: (from: string, to: string) => void;
}) {
  const now = new Date();
  const presets = [
    { label: 'MTD', from: new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10), to: now.toISOString().slice(0, 10) },
    { label: 'Last 30d', from: new Date(now.getTime() - 30 * 86400000).toISOString().slice(0, 10), to: now.toISOString().slice(0, 10) },
    { label: 'Last 90d', from: new Date(now.getTime() - 90 * 86400000).toISOString().slice(0, 10), to: now.toISOString().slice(0, 10) },
  ];
  return (
    <div className="flex items-center gap-2 flex-wrap">
      {presets.map((p) => (
        <button
          key={p.label}
          onClick={() => onChange(p.from, p.to)}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
            from === p.from && to === p.to
              ? 'bg-tone-ink text-tone-surface'
              : 'bg-tone-surface border border-grey-20 text-grey-70 hover:bg-tone-surface-warm'
          }`}
        >
          {p.label}
        </button>
      ))}
      <input type="date" value={from} onChange={(e) => onChange(e.target.value, to)}
        className="text-xs border border-grey-20 rounded-lg px-2 py-1.5 text-tone-ink outline-none focus:ring-2 focus:ring-tone-sage" />
      <span className="text-xs text-grey-40">to</span>
      <input type="date" value={to} onChange={(e) => onChange(from, e.target.value)}
        className="text-xs border border-grey-20 rounded-lg px-2 py-1.5 text-tone-ink outline-none focus:ring-2 focus:ring-tone-sage" />
    </div>
  );
}

export default function GroupOverviewPage() {
  const now = new Date();
  const [from, setFrom] = useState(new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10));
  const [to, setTo] = useState(now.toISOString().slice(0, 10));
  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const token = localStorage.getItem('access_token');
    if (!token) return;
    setLoading(true);
    setError('');
    fetch(`${API_URL}/group/overview?from=${from}&to=${to}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then((d) => setData(d as OverviewData))
      .catch(() => setError('Failed to load overview data'))
      .finally(() => setLoading(false));
  }, [from, to]);

  const maxRevenue = Math.max(...(data?.revenueByBranch.map((b) => b.revenue) ?? [1]), 1);

  return (
    <div>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <h1 className="text-2xl font-bold text-tone-ink">Group Overview</h1>
        <DateRangePicker from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} />
      </div>

      {error && <div className="mb-4 rounded-lg bg-semantic-danger/5 border border-semantic-danger/30 px-4 py-3 text-sm text-semantic-danger">{error}</div>}

      {loading ? (
        <div className="text-sm text-grey-60">Loading...</div>
      ) : data ? (
        <div className="space-y-6">
          {/* KPI Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-tone-ink rounded-xl p-6">
              <p className="text-xs font-medium text-tone-surface/70 uppercase tracking-wide">Revenue</p>
              <p className="text-3xl font-bold text-tone-surface mt-1">{fmtCurrency(data.revenue)}</p>
            </div>
            <div className="bg-tone-surface rounded-xl border border-grey-20 p-5">
              <p className="text-xs font-medium text-grey-60 uppercase tracking-wide">Bookings</p>
              <p className="text-3xl font-bold text-tone-ink mt-1">{data.bookingCount.toLocaleString()}</p>
            </div>
            <div className="bg-tone-surface rounded-xl border border-grey-20 p-5">
              <p className="text-xs font-medium text-grey-60 uppercase tracking-wide">Active Clients</p>
              <p className="text-3xl font-bold text-tone-ink mt-1">{data.activeClients.toLocaleString()}</p>
            </div>
          </div>

          {/* Revenue by Branch */}
          <div className="bg-tone-surface rounded-xl border border-grey-20 p-5">
            <h2 className="text-sm font-semibold text-tone-ink mb-4">Revenue by Branch</h2>
            <div className="space-y-3">
              {data.revenueByBranch.map((b) => (
                <div key={b.merchantId} className="flex items-center gap-3">
                  <span className="text-sm text-tone-ink w-32 truncate">{b.name}</span>
                  <div className="flex-1 bg-grey-10 rounded-full h-2.5">
                    <div
                      className="bg-tone-sage h-2.5 rounded-full transition-all"
                      style={{ width: `${(b.revenue / maxRevenue) * 100}%` }}
                    />
                  </div>
                  <span className="text-sm font-medium text-tone-ink w-24 text-right">{fmtCurrency(b.revenue)}</span>
                </div>
              ))}
              {data.revenueByBranch.length === 0 && <p className="text-sm text-grey-40">No revenue data for this period.</p>}
            </div>
          </div>

          {/* Bottom row: Ops + Top Clients */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="bg-tone-surface rounded-xl border border-grey-20 p-5">
              <h2 className="text-sm font-semibold text-tone-ink mb-4">Operations Health</h2>
              <div className="space-y-2">
                {data.opsHealth.map((b) => {
                  const dotClass = b.bookingCount >= 50 ? 'bg-tone-sage' : b.bookingCount >= 20 ? 'bg-grey-40' : 'bg-grey-20';
                  const textClass = b.bookingCount >= 50 ? 'state-completed' : b.bookingCount >= 20 ? 'state-default' : 'state-urgent';
                  return (
                    <div key={b.merchantId} className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className={`w-2 h-2 rounded-full ${dotClass}`} />
                        <span className="text-sm text-tone-ink">{b.name}</span>
                      </div>
                      <span className={`text-sm font-medium ${textClass}`}>{b.bookingCount} bookings</span>
                    </div>
                  );
                })}
                {data.opsHealth.length === 0 && <p className="text-sm text-grey-40">No bookings in this period.</p>}
              </div>
            </div>

            <div className="bg-tone-surface rounded-xl border border-grey-20 p-5">
              <h2 className="text-sm font-semibold text-tone-ink mb-4">Top Clients</h2>
              <div className="space-y-2">
                {data.topClients.map((cl) => (
                  <div key={cl.id} className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-tone-ink">{cl.name}</p>
                      <p className="text-xs text-grey-60">{cl.phone}</p>
                    </div>
                    <span className="text-sm font-semibold text-tone-ink">{fmtCurrency(cl.totalSpend)}</span>
                  </div>
                ))}
                {data.topClients.length === 0 && <p className="text-sm text-grey-40">No client data for this period.</p>}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
