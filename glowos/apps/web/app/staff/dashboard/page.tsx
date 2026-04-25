'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiFetch } from '../../lib/api';

type Period = 'today' | '7d' | '30d' | '90d' | 'all';

interface Contribution {
  staffName: string | null;
  servicesDelivered: string;
  packagesSold: string;
  total: string;
}

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
