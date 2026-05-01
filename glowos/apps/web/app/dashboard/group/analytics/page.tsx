'use client';

import { useState } from 'react';
import { UtilizationSection } from '../../analytics/UtilizationSection';
import { CohortRetentionSection } from '../../analytics/CohortRetentionSection';
import { RebookLagSection } from '../../analytics/RebookLagSection';
import { PerBranchComparisonTable } from './PerBranchComparisonTable';

// The group analytics endpoints take `from` / `to` (date-only ISO),
// matching the existing /group/overview convention. They do NOT accept
// the `period=30d` shorthand the per-merchant analytics endpoints use.
function buildWindowQuery(from: string, to: string): string {
  return `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
}

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function daysAgoISO(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function startOfMonthISO(): string {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
}

function DateRangePicker({
  from,
  to,
  onChange,
}: {
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
}) {
  const presets = [
    { label: 'MTD', from: startOfMonthISO(), to: todayISO() },
    { label: 'Last 30d', from: daysAgoISO(30), to: todayISO() },
    { label: 'Last 90d', from: daysAgoISO(90), to: todayISO() },
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
      <input
        type="date"
        value={from}
        max={to}
        onChange={(e) => onChange(e.target.value, to)}
        className="text-xs border border-grey-20 rounded-lg px-2 py-1.5 text-tone-ink outline-none focus:ring-2 focus:ring-tone-sage"
      />
      <span className="text-xs text-grey-40">to</span>
      <input
        type="date"
        value={to}
        min={from}
        max={todayISO()}
        onChange={(e) => onChange(from, e.target.value)}
        className="text-xs border border-grey-20 rounded-lg px-2 py-1.5 text-tone-ink outline-none focus:ring-2 focus:ring-tone-sage"
      />
    </div>
  );
}

export default function GroupAnalyticsPage() {
  const [from, setFrom] = useState(daysAgoISO(30));
  const [to, setTo] = useState(todayISO());

  const windowQuery = buildWindowQuery(from, to);

  return (
    <div>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-tone-ink">Group Analytics</h1>
          <p className="text-sm text-grey-60 mt-0.5">
            Capacity, retention, and rebook trends rolled up across every branch in your group.
          </p>
        </div>
        <DateRangePicker from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} />
      </div>

      <div className="space-y-6">
        <UtilizationSection windowQuery={windowQuery} apiPath="/group/analytics/utilization" />
        <CohortRetentionSection windowQuery={windowQuery} apiPath="/group/analytics/cohort-retention" />
        <RebookLagSection windowQuery={windowQuery} apiPath="/group/analytics/rebook-lag" />
        <PerBranchComparisonTable windowQuery={windowQuery} />
      </div>
    </div>
  );
}
