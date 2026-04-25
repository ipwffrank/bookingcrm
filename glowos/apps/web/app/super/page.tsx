'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';

type Period = '7d' | '30d' | '90d';

interface Overview {
  period: Period;
  totalMerchants: number;
  activeMerchants: number;
  newMerchants: number;
  totalBookings: number;
  totalRevenue: string;
  totalClients: number;
  gbpConnected: number;
}

const PERIOD_LABEL: Record<Period, string> = { '7d': 'Last 7 days', '30d': 'Last 30 days', '90d': 'Last 90 days' };

export default function SuperOverviewPage() {
  const [period, setPeriod] = useState<Period>('30d');
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(true);
    setError('');
    apiFetch(`/super/analytics/overview?period=${period}`)
      .then((d) => setData(d as Overview))
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }, [period]);

  return (
    <div>
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-tone-ink">Platform overview</h1>
          <p className="text-sm text-grey-60 mt-0.5">Cross-tenant aggregates across every merchant.</p>
        </div>
        <div className="inline-flex rounded-lg border border-grey-15 bg-tone-surface overflow-hidden">
          {(['7d', '30d', '90d'] as const).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                period === p ? 'bg-tone-ink text-tone-surface' : 'text-grey-75 hover:bg-grey-5'
              }`}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-lg bg-semantic-danger/5 border border-semantic-danger/30 px-4 py-3 text-sm text-semantic-danger">
          {error}
        </div>
      )}

      {loading && !data ? (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-24 rounded-xl bg-tone-surface border border-grey-15 animate-pulse" />
          ))}
        </div>
      ) : data ? (
        <>
          <p className="text-xs text-grey-60 mb-3">{PERIOD_LABEL[data.period]}</p>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <Card label="Total revenue" value={`S$${Number(data.totalRevenue).toFixed(2)}`} emphasis />
            <Card label="Total bookings" value={data.totalBookings.toLocaleString()} accent />
            <Card label="Active merchants" value={`${data.activeMerchants} / ${data.totalMerchants}`} />
            <Card label="New merchants" value={data.newMerchants.toLocaleString()} />
            <Card label="Total clients (all-time)" value={data.totalClients.toLocaleString()} />
            <Card
              label="Connected to Google"
              value={
                data.totalMerchants > 0
                  ? `${data.gbpConnected} / ${data.totalMerchants} · ${Math.round(
                      (data.gbpConnected / data.totalMerchants) * 100,
                    )}%`
                  : '0 / 0'
              }
            />
          </div>
        </>
      ) : null}
    </div>
  );
}

function Card({
  label,
  value,
  emphasis = false,
  accent = false,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
  accent?: boolean;
}) {
  const cls = emphasis
    ? 'text-tone-surface bg-tone-ink border-tone-ink'
    : accent
      ? 'text-tone-sage bg-tone-sage/10 border-tone-sage/30'
      : 'text-tone-ink bg-tone-surface border-grey-15';
  return (
    <div className={`rounded-xl border p-5 ${cls}`}>
      <p className="text-xs font-medium opacity-70 mb-1">{label}</p>
      <p className="text-2xl font-bold tracking-tight">{value}</p>
    </div>
  );
}
