'use client';

import { useEffect, useState } from 'react';
import { apiFetch, ApiError } from '../../lib/api';

interface RebookLagBin {
  id: '0-7d' | '8-14d' | '15-30d' | '31-60d' | '60d+';
  label: string;
  minDays: number;
  maxDays: number;
  count: number;
  pct: number;
}

interface RebookLagApiResponse {
  period: { start: string; end: string; label: string };
  lookforwardDays: number;
  cohort: { windowStart: string; windowEnd: string; size: number };
  headline: {
    medianDays: number | null;
    deltaVsPriorCohortDays: number | null;
    returnedCount: number;
    cohortSize: number;
  } | null;
  bins: RebookLagBin[];
  guards: { lowSample: boolean; medianSuppressed: boolean };
}

export function RebookLagSection({ windowQuery }: { windowQuery: string }) {
  const [data, setData] = useState<RebookLagApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    apiFetch(`/merchant/analytics/rebook-lag?${windowQuery}`)
      .then((json: RebookLagApiResponse) => {
        if (!cancelled) setData(json);
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          const msg = e instanceof ApiError ? e.message : String(e);
          setError(msg);
        }
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
        <div className="h-4 bg-grey-15 rounded w-44 mb-3" />
        <div className="h-10 bg-grey-15 rounded w-32 mb-4" />
        <div className="flex items-end gap-2 h-20">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex-1 bg-grey-15 rounded-t" style={{ height: `${30 + ((i * 17) % 60)}%` }} />
          ))}
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="bg-tone-surface rounded-xl border border-grey-15 p-5">
        <h3 className="text-sm font-medium text-tone-ink uppercase tracking-wider">Rebook lag</h3>
        <p className="mt-3 text-sm text-grey-60">
          {error ? `Couldn't load rebook lag: ${error}` : 'Rebook lag unavailable.'}
        </p>
      </div>
    );
  }

  if (!data.headline) {
    return (
      <div className="bg-tone-surface rounded-xl border border-grey-15 p-5">
        <h3 className="text-sm font-medium text-tone-ink uppercase tracking-wider">
          Rebook lag · {data.period.label}
        </h3>
        <p className="mt-3 text-sm text-grey-60">
          Insufficient sample ({data.cohort.size} first-timer{data.cohort.size === 1 ? '' : 's'} in trailing 60-day-ago window) — needs at least 5 to surface a rebook lag distribution.
        </p>
      </div>
    );
  }

  const h = data.headline;
  const days = h.deltaVsPriorCohortDays;
  const deltaTextClass =
    days === null
      ? 'text-grey-45'
      : days < 0
        ? 'text-tone-sage'
        : days >= 7
          ? 'text-semantic-warn'
          : 'text-grey-45';
  const deltaText =
    days === null
      ? ''
      : Math.abs(days) < 1
        ? 'flat vs prior cohort'
        : days < 0
          ? `▼ ${Math.abs(days)}d vs prior cohort`
          : `▲ ${days}d vs prior cohort`;

  // Modal bin = bin with largest count (or pct).
  const modal = data.bins.reduce((best, b) => (b.count > best.count ? b : best), data.bins[0]);
  const sixtyPlus = data.bins.find((b) => b.id === '60d+');
  const sixtyPlusPct = sixtyPlus?.pct ?? 0;

  // Bar heights normalised against the largest bin.
  const maxPct = Math.max(...data.bins.map((b) => b.pct));

  const headlineText = h.medianDays === null
    ? `Distribution shown · median suppressed (${h.returnedCount} returner${h.returnedCount === 1 ? '' : 's'} — needs ≥ 5)`
    : `${h.medianDays}d median`;

  return (
    <div className="bg-tone-surface rounded-xl border border-grey-15 p-5">
      <div className="flex items-baseline justify-between mb-3">
        <h3 className="text-sm font-medium text-tone-ink uppercase tracking-wider">
          Rebook lag · {data.period.label}
        </h3>
        <span className="text-xs text-grey-45">
          cohort size: {h.cohortSize} first-timer{h.cohortSize === 1 ? '' : 's'}
        </span>
      </div>
      <div className="flex items-baseline gap-3 mb-4">
        <span className={h.medianDays === null ? 'text-sm text-grey-60' : 'text-4xl font-semibold text-tone-ink'}>
          {headlineText}
        </span>
        {h.medianDays !== null && deltaText && (
          <span className={`text-sm ${deltaTextClass}`}>{deltaText}</span>
        )}
      </div>
      <div className="flex items-end gap-2 h-24 mb-2">
        {data.bins.map((b) => {
          const heightPct = maxPct > 0 ? Math.min(100, (b.pct / maxPct) * 100) : 0;
          const tooltip = `${b.label}: ${b.count} returner${b.count === 1 ? '' : 's'} (${b.pct.toFixed(1)}%)`;
          return (
            <div key={b.id} className="flex flex-col items-center gap-1.5 flex-1" title={tooltip}>
              <div className="w-full flex items-end" style={{ height: '100%' }}>
                <div
                  className="w-full rounded-sm bg-tone-ink transition-all"
                  style={{ height: `${heightPct}%`, minHeight: heightPct > 0 ? '2px' : '0' }}
                />
              </div>
              <span className="text-xs text-grey-60">{b.id}</span>
              <span className="text-[10px] text-grey-45">{b.pct.toFixed(1)}%</span>
            </div>
          );
        })}
      </div>
      <p className="text-xs text-grey-60 mt-3">
        {modal.id === '60d+'
          ? `${sixtyPlusPct.toFixed(1)}% didn't return within 60 days — see Cohort retention above for that group.`
          : `Most returners land in the ${modal.label} window. ${sixtyPlusPct.toFixed(1)}% didn't return within 60 days.`}
      </p>
    </div>
  );
}
