'use client';

import { useEffect, useState } from 'react';
import { apiFetch, ApiError } from '../../../lib/api';

interface UtilPerBranch {
  merchantId: string;
  merchantName: string;
  headline: { utilizationPct: number; bookedMinutes: number; availableMinutes: number; deltaVsPriorPp: number | null } | null;
}
interface CohortPerBranch {
  merchantId: string;
  merchantName: string;
  cohort: { size: number };
  headline: { retentionPct: number; cohortSize: number; returnedCount: number; deltaVsPriorCohortPp: number | null } | null;
}
interface RebookPerBranch {
  merchantId: string;
  merchantName: string;
  cohort: { size: number };
  headline: { medianDays: number | null; cohortSize: number; returnedCount: number; deltaVsPriorCohortDays: number | null } | null;
}

interface CombinedRow {
  merchantId: string;
  merchantName: string;
  utilizationPct: number | null;
  retentionPct: number | null;
  cohortSize: number;
  medianRebookDays: number | null;
}

export function PerBranchComparisonTable({ windowQuery }: { windowQuery: string }) {
  const [rows, setRows] = useState<CombinedRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    Promise.all([
      apiFetch(`/group/analytics/utilization?${windowQuery}`) as Promise<{ perBranch: UtilPerBranch[] }>,
      apiFetch(`/group/analytics/cohort-retention?${windowQuery}`) as Promise<{ perBranch: CohortPerBranch[] }>,
      apiFetch(`/group/analytics/rebook-lag?${windowQuery}`) as Promise<{ perBranch: RebookPerBranch[] }>,
    ])
      .then(([util, cohort, rebook]) => {
        if (cancelled) return;
        // Merge by merchantId. A branch missing from one endpoint (rare —
        // would mean Promise.allSettled in the aggregator dropped that
        // branch's metric for one signal but not others) still shows up
        // with nulls in the missing columns.
        const byId = new Map<string, CombinedRow>();
        const ensure = (id: string, name: string) => {
          if (!byId.has(id)) {
            byId.set(id, {
              merchantId: id,
              merchantName: name,
              utilizationPct: null,
              retentionPct: null,
              cohortSize: 0,
              medianRebookDays: null,
            });
          }
          return byId.get(id)!;
        };
        for (const b of util.perBranch) {
          const row = ensure(b.merchantId, b.merchantName);
          row.utilizationPct = b.headline?.utilizationPct ?? null;
        }
        for (const b of cohort.perBranch) {
          const row = ensure(b.merchantId, b.merchantName);
          row.retentionPct = b.headline?.retentionPct ?? null;
          row.cohortSize = Math.max(row.cohortSize, b.cohort.size);
        }
        for (const b of rebook.perBranch) {
          const row = ensure(b.merchantId, b.merchantName);
          row.medianRebookDays = b.headline?.medianDays ?? null;
          row.cohortSize = Math.max(row.cohortSize, b.cohort.size);
        }
        setRows(Array.from(byId.values()).sort((a, b) => a.merchantName.localeCompare(b.merchantName)));
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof ApiError ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [windowQuery]);

  if (loading) {
    return (
      <div className="bg-tone-surface rounded-xl border border-grey-15 p-5 animate-pulse">
        <div className="h-4 bg-grey-15 rounded w-48 mb-4" />
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex gap-4">
              <div className="h-4 bg-grey-15 rounded flex-1" />
              <div className="h-4 bg-grey-15 rounded w-16" />
              <div className="h-4 bg-grey-15 rounded w-16" />
              <div className="h-4 bg-grey-15 rounded w-16" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error || !rows) {
    return (
      <div className="bg-tone-surface rounded-xl border border-grey-15 p-5">
        <h3 className="text-sm font-medium text-tone-ink uppercase tracking-wider">Per-branch comparison</h3>
        <p className="mt-3 text-sm text-grey-60">
          {error ? `Couldn't load per-branch comparison: ${error}` : 'No per-branch data available.'}
        </p>
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="bg-tone-surface rounded-xl border border-grey-15 p-5">
        <h3 className="text-sm font-medium text-tone-ink uppercase tracking-wider">Per-branch comparison</h3>
        <p className="mt-3 text-sm text-grey-60">No active branches in this group.</p>
      </div>
    );
  }

  const fmtPct = (v: number | null) => (v === null ? '—' : `${v.toFixed(1)}%`);
  const fmtDays = (v: number | null) => (v === null ? '—' : `${v}d`);

  return (
    <div className="bg-tone-surface rounded-xl border border-grey-15 p-5">
      <div className="flex items-baseline justify-between mb-4">
        <h3 className="text-sm font-medium text-tone-ink uppercase tracking-wider">Per-branch comparison</h3>
        <span className="text-xs text-grey-45">{rows.length} branch{rows.length === 1 ? '' : 'es'}</span>
      </div>
      <div className="overflow-x-auto -mx-1">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-grey-15">
              <th className="text-left text-xs font-medium text-grey-60 pb-2 pr-3">Branch</th>
              <th className="text-right text-xs font-medium text-grey-60 pb-2 px-3">Utilization</th>
              <th className="text-right text-xs font-medium text-grey-60 pb-2 px-3">Cohort retention</th>
              <th className="text-right text-xs font-medium text-grey-60 pb-2 px-3">Median rebook</th>
              <th className="text-right text-xs font-medium text-grey-60 pb-2 pl-3">Cohort n</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-grey-5">
            {rows.map((r) => (
              <tr key={r.merchantId} className="hover:bg-grey-5 transition-colors">
                <td className="py-2.5 pr-3 font-medium text-tone-ink">{r.merchantName}</td>
                <td className="py-2.5 px-3 text-right text-tone-ink">
                  {r.utilizationPct === null ? '—' : `${Math.round(r.utilizationPct)}%`}
                </td>
                <td className="py-2.5 px-3 text-right text-tone-ink">{fmtPct(r.retentionPct)}</td>
                <td className="py-2.5 px-3 text-right text-tone-ink">{fmtDays(r.medianRebookDays)}</td>
                <td className="py-2.5 pl-3 text-right text-grey-60">{r.cohortSize}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-grey-45 mt-3">
        Cohort retention and median rebook lag share the same trailing 60-day-ago cohort. Branches with cohort {'<'} 5 first-timers show "—" — too noisy to surface a rate.
      </p>
    </div>
  );
}
