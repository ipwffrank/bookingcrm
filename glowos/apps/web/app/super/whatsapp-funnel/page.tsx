'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '../../lib/api';

type Period = '7d' | '30d';

interface MerchantRow {
  merchantId: string;
  merchantName: string;
  outboundSent: number;
  inboundReplies: number;
  conversions7d: number;
  conversions30d: number;
  conversionRate7d: string;
  conversionRate30d: string;
}

interface Totals {
  outboundSent: number;
  inboundReplies: number;
  conversions7d: number;
  conversions30d: number;
}

interface FunnelResponse {
  period: Period;
  merchantId: string | null;
  totals: Totals;
  merchants: MerchantRow[];
}

function replyRate(inbound: number, outbound: number): string {
  if (outbound === 0) return '—';
  return `${((inbound / outbound) * 100).toFixed(1)}%`;
}

export default function WhatsAppFunnelPage() {
  const [period, setPeriod] = useState<Period>('30d');
  const [data, setData] = useState<FunnelResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(true);
    setError('');
    apiFetch(`/super/analytics/whatsapp-funnel?period=${period}`)
      .then((d) => setData(d as FunnelResponse))
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }, [period]);

  return (
    <div>
      <div className="flex items-start justify-between mb-6 gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-tone-ink">WhatsApp funnel</h1>
          <p className="text-sm text-grey-60 mt-0.5">
            Outbound sends → inbound replies → bookings within 7 / 30 days of the first reply.
          </p>
        </div>
        <div className="inline-flex rounded-lg border border-grey-15 bg-tone-surface overflow-hidden">
          {(['7d', '30d'] as const).map((p) => (
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

      {data && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <Card label="Outbound sent" value={data.totals.outboundSent.toLocaleString()} />
          <Card
            label="Inbound replies"
            value={data.totals.inboundReplies.toLocaleString()}
            sub={`Reply rate: ${replyRate(data.totals.inboundReplies, data.totals.outboundSent)}`}
          />
          <Card
            label="Converted (7 day)"
            value={data.totals.conversions7d.toLocaleString()}
            sub={
              data.totals.inboundReplies > 0
                ? `${((data.totals.conversions7d / data.totals.inboundReplies) * 100).toFixed(1)}% of replies`
                : '—'
            }
            accent
          />
          <Card
            label="Converted (30 day)"
            value={data.totals.conversions30d.toLocaleString()}
            sub={
              data.totals.inboundReplies > 0
                ? `${((data.totals.conversions30d / data.totals.inboundReplies) * 100).toFixed(1)}% of replies`
                : '—'
            }
            emphasis
          />
        </div>
      )}

      <div className="bg-tone-surface rounded-xl border border-grey-15 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-grey-15 text-left">
              <th className="px-4 py-3 text-xs font-semibold text-grey-60 uppercase tracking-wider">Merchant</th>
              <th className="px-4 py-3 text-xs font-semibold text-grey-60 uppercase tracking-wider text-right">Outbound</th>
              <th className="px-4 py-3 text-xs font-semibold text-grey-60 uppercase tracking-wider text-right">Inbound</th>
              <th className="px-4 py-3 text-xs font-semibold text-grey-60 uppercase tracking-wider text-right">7d conv.</th>
              <th className="px-4 py-3 text-xs font-semibold text-grey-60 uppercase tracking-wider text-right">7d rate</th>
              <th className="px-4 py-3 text-xs font-semibold text-grey-60 uppercase tracking-wider text-right">30d conv.</th>
              <th className="px-4 py-3 text-xs font-semibold text-grey-60 uppercase tracking-wider text-right">30d rate</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-grey-45 text-sm">Loading…</td></tr>
            ) : !data || data.merchants.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center text-grey-60 text-sm">
                  <p>No WhatsApp activity in this period.</p>
                  <p className="text-xs text-grey-45 mt-2">
                    Outbound sends are recorded automatically; inbound replies require the Twilio
                    webhook to be pointed at <code className="bg-grey-5 px-1.5 py-0.5 rounded">/webhooks/twilio/whatsapp-inbound</code>.
                  </p>
                </td>
              </tr>
            ) : (
              data.merchants.map((r) => (
                <tr key={r.merchantId} className="border-b border-grey-5 hover:bg-grey-5 transition-colors">
                  <td className="px-4 py-3 font-medium text-tone-ink truncate max-w-[240px]">{r.merchantName}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-grey-75">{r.outboundSent.toLocaleString()}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-grey-75">{r.inboundReplies.toLocaleString()}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-tone-ink">{r.conversions7d.toLocaleString()}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-tone-sage">{r.inboundReplies > 0 ? `${r.conversionRate7d}%` : '—'}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-tone-ink">{r.conversions30d.toLocaleString()}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-tone-sage">{r.inboundReplies > 0 ? `${r.conversionRate30d}%` : '—'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-grey-45 mt-3">
        Conversion = a distinct client replied during the period AND created a booking within N days of their first reply.
        Unattributed inbounds (no matching outbound within 72 hours) are excluded from per-merchant rows.
      </p>
    </div>
  );
}

function Card({
  label,
  value,
  sub,
  emphasis = false,
  accent = false,
}: {
  label: string;
  value: string;
  sub?: string;
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
      {sub && <p className="text-xs opacity-60 mt-1">{sub}</p>}
    </div>
  );
}
