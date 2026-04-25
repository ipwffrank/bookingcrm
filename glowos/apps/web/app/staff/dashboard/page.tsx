'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiFetch } from '../../lib/api';

type Period = 'today' | '7d' | '30d' | '90d' | 'all';
type VipTier = 'bronze' | 'silver' | 'gold' | 'platinum';

interface Contribution {
  staffName: string | null;
  servicesDelivered: string;
  packagesSold: string;
  total: string;
}

interface TopVipClient {
  clientId: string;
  name: string | null;
  phone: string;
  vipTier: VipTier;
  vipScore: number;
  lastVisitDate: string | null;
  visits: number;
  totalSpent: number;
}

const TIER_EMOJI: Record<VipTier, string> = {
  platinum: '💎',
  gold:     '🥇',
  silver:   '🥈',
  bronze:   '🥉',
};

const PERIOD_LABEL: Record<Period, string> = {
  today: 'Today',
  '7d': '7d',
  '30d': '30d',
  '90d': '90d',
  all: 'All',
};

export default function StaffDashboard() {
  const [today, setToday] = useState<Contribution | null>(null);
  const [month, setMonth] = useState<Contribution | null>(null);
  const [selectedPeriod, setSelectedPeriod] = useState<Period | null>(null);
  const [selectedContribution, setSelectedContribution] = useState<Contribution | null>(null);
  const [topVip, setTopVip] = useState<TopVipClient[] | null>(null);

  async function load(period: Period): Promise<Contribution | null> {
    try {
      const token = localStorage.getItem('access_token');
      const d = await apiFetch(`/staff/my-contribution?period=${period}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      return d as Contribution;
    } catch {
      return null;
    }
  }

  useEffect(() => {
    load('today').then(setToday);
    load('30d').then(setMonth);
    (async () => {
      try {
        const token = localStorage.getItem('access_token');
        const d = await apiFetch('/staff/top-vip-clients', {
          headers: { Authorization: `Bearer ${token}` },
        });
        setTopVip((d as { clients: TopVipClient[] }).clients ?? []);
      } catch {
        setTopVip([]);
      }
    })();
  }, []);

  async function pickPeriod(p: Period) {
    if (p === 'today') {
      setSelectedPeriod(null);
      setSelectedContribution(null);
      return;
    }
    setSelectedPeriod(p);
    const c = await load(p);
    setSelectedContribution(c);
  }

  const showCollapsed = selectedPeriod !== null;

  return (
    <div>
      <h1 className="text-lg font-semibold mb-1 text-tone-ink">
        Hi {today?.staffName ?? ''}
      </h1>
      <p className="text-xs text-grey-60 mb-4">Your contribution at a glance.</p>

      {!showCollapsed && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
          <ContributionCard title="Today" c={today} />
          <ContributionCard title="This month" c={month} />
        </div>
      )}

      {showCollapsed && selectedContribution && (
        <div className="mb-4">
          <ContributionCard title={PERIOD_LABEL[selectedPeriod!]} c={selectedContribution} />
        </div>
      )}

      <div className="flex gap-1 mb-6">
        {(Object.keys(PERIOD_LABEL) as Period[]).map((p) => {
          const selected = p === 'today' ? !showCollapsed : selectedPeriod === p;
          return (
            <button
              key={p}
              type="button"
              onClick={() => pickPeriod(p)}
              className={`px-2.5 py-1 text-xs font-medium rounded-full border ${
                selected
                  ? 'bg-tone-ink text-white border-tone-ink'
                  : 'bg-tone-surface text-grey-75 border-grey-15 hover:bg-grey-5'
              }`}
            >
              {PERIOD_LABEL[p]}
            </button>
          );
        })}
      </div>

      {/* Top 5 VIP clients THIS staff has served. Each row links straight into
          the staff client profile so they can pull up history with a single tap.
          Hidden when nothing yet — junior staff who haven't run a service won't
          see an empty card. */}
      {topVip && topVip.length > 0 && (
        <div className="bg-tone-surface border border-grey-15 rounded-xl p-4 mb-6">
          <h2 className="text-sm font-semibold text-tone-ink mb-1">Your top clients</h2>
          <p className="text-xs text-grey-60 mb-3">
            Top 5 of your clients by VIP score (recency + frequency + spend).
          </p>
          <div className="space-y-1.5">
            {topVip.map((c, i) => (
              <Link
                key={c.clientId}
                href={`/staff/clients/${c.clientId}`}
                className="flex items-center gap-3 rounded-lg border border-grey-15 px-3 py-2.5 hover:border-tone-sage/50 hover:bg-tone-sage/5 transition-colors"
              >
                <span className="w-5 text-xs font-semibold text-grey-45 text-center flex-shrink-0">
                  {i + 1}
                </span>
                <span className="text-base flex-shrink-0">{TIER_EMOJI[c.vipTier]}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-tone-ink truncate">{c.name ?? c.phone}</p>
                  <p className="text-[11px] text-grey-60 truncate">
                    {c.visits} visit{c.visits === 1 ? '' : 's'} · S${c.totalSpent.toLocaleString('en-SG', { maximumFractionDigits: 0 })} total
                  </p>
                </div>
                <span className="text-xs text-grey-45 capitalize flex-shrink-0">{c.vipTier}</span>
                <svg className="w-4 h-4 text-grey-30 flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
                </svg>
              </Link>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-2">
        <Link href="/staff/bookings" className="block text-sm text-tone-sage hover:underline">
          &#8594; Your upcoming bookings
        </Link>
        <Link href="/staff/clients" className="block text-sm text-tone-sage hover:underline">
          &#8594; Your clients
        </Link>
      </div>
    </div>
  );
}

function ContributionCard({ title, c }: { title: string; c: Contribution | null }) {
  return (
    <div className="bg-tone-surface border border-grey-15 rounded-xl p-4">
      <p className="text-xs font-medium text-grey-60 mb-0.5">{title}</p>
      <p className="text-2xl font-bold text-tone-ink">
        {c ? `S$${Number(c.total).toFixed(2)}` : '—'}
      </p>
      {c && (
        <div className="mt-2 space-y-0.5 text-xs text-grey-75">
          <div className="flex justify-between"><span>Services</span><span className="tabular-nums">S${Number(c.servicesDelivered).toFixed(2)}</span></div>
          <div className="flex justify-between"><span>Packages</span><span className="tabular-nums">S${Number(c.packagesSold).toFixed(2)}</span></div>
        </div>
      )}
    </div>
  );
}
