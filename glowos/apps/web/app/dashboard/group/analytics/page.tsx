'use client';

import { useState } from 'react';
import { UtilizationSection } from '../../analytics/UtilizationSection';
import { CohortRetentionSection } from '../../analytics/CohortRetentionSection';
import { RebookLagSection } from '../../analytics/RebookLagSection';
import { PerBranchComparisonTable } from './PerBranchComparisonTable';

// Server-rendered PDF — same UX pattern as the per-merchant analytics
// export. Hits GET /group/analytics/export-pdf which returns a structured
// 1–2 page report with a per-branch comparison table and footnotes
// explaining each metric's derivation.

function ExportPdfButton({ from, to }: { from: string; to: string }) {
  const [exporting, setExporting] = useState(false);

  async function exportPdf() {
    setExporting(true);
    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
      const token = localStorage.getItem('access_token');
      const res = await fetch(
        `${apiUrl}/group/analytics/export-pdf?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!res.ok) throw new Error(`Export failed (${res.status})`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const opened = window.open(url, '_blank', 'noopener');
      if (!opened) {
        const a = document.createElement('a');
        a.href = url;
        a.download = 'group-analytics.pdf';
        a.click();
      }
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to export PDF';
      alert(message);
    } finally {
      setExporting(false);
    }
  }

  return (
    <button
      type="button"
      onClick={exportPdf}
      disabled={exporting}
      className="flex items-center gap-1.5 px-3 py-2 bg-tone-surface border border-grey-15 text-grey-90 text-sm font-medium rounded-lg hover:bg-grey-5 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
      title="Generate a structured PDF report of this period's group analytics."
    >
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
      </svg>
      {exporting ? 'Generating…' : 'Export PDF'}
    </button>
  );
}

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
        <div className="flex items-center gap-2 flex-wrap">
          <ExportPdfButton from={from} to={to} />
          <DateRangePicker from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} />
        </div>
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
