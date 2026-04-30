'use client';

import { useEffect, useState } from 'react';
import { apiFetch, ApiError } from '../../lib/api';

interface CohortRetentionApiResponse {
  period: { start: string; end: string; label: string };
  lookforwardDays: number;
  cohort: { windowStart: string; windowEnd: string; size: number };
  headline: {
    retentionPct: number;
    returnedCount: number;
    cohortSize: number;
    deltaVsPriorCohortPp: number | null;
  } | null;
  guards: { lowSample: boolean };
}

export function CohortRetentionSection({ windowQuery }: { windowQuery: string }) {
  const [data, setData] = useState<CohortRetentionApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    apiFetch(`/merchant/analytics/cohort-retention?${windowQuery}`)
      .then((json: CohortRetentionApiResponse) => {
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
        <div className="h-4 bg-grey-15 rounded w-56 mb-3" />
        <div className="h-10 bg-grey-15 rounded w-32 mb-4" />
        <div className="h-3 bg-grey-15 rounded w-3/4" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="bg-tone-surface rounded-xl border border-grey-15 p-5">
        <h3 className="text-sm font-medium text-tone-ink uppercase tracking-wider">60-day cohort retention</h3>
        <p className="mt-3 text-sm text-grey-60">
          {error ? `Couldn't load cohort retention: ${error}` : 'Cohort retention unavailable.'}
        </p>
      </div>
    );
  }

  if (!data.headline) {
    return (
      <div className="bg-tone-surface rounded-xl border border-grey-15 p-5">
        <h3 className="text-sm font-medium text-tone-ink uppercase tracking-wider">
          60-day cohort retention · {data.period.label}
        </h3>
        <p className="mt-3 text-sm text-grey-60">
          Insufficient sample ({data.cohort.size} first-timer{data.cohort.size === 1 ? '' : 's'} in trailing 60-day-ago window) — needs at least 5 to surface a reliable retention rate.
        </p>
      </div>
    );
  }

  const h = data.headline;
  const delta = h.deltaVsPriorCohortPp;
  const deltaTextClass =
    delta === null
      ? 'text-grey-45'
      : delta >= 0
        ? 'text-tone-sage'
        : delta <= -5
          ? 'text-semantic-warn'
          : 'text-grey-45';
  const deltaText =
    delta === null
      ? ''
      : Math.abs(delta) < 0.5
        ? 'flat vs prior cohort'
        : delta >= 0
          ? `▲ ${delta.toFixed(1)}pp vs prior cohort`
          : `▼ ${Math.abs(delta).toFixed(1)}pp vs prior cohort`;

  // Format cohort window as "N-M days ago" relative to today.
  const daysAgo = (iso: string) => {
    const ms = Date.now() - new Date(iso).getTime();
    return Math.round(ms / (24 * 60 * 60 * 1000));
  };
  const startDaysAgo = daysAgo(data.cohort.windowStart);
  const endDaysAgo = daysAgo(data.cohort.windowEnd);

  return (
    <div className="bg-tone-surface rounded-xl border border-grey-15 p-5">
      <div className="flex items-baseline justify-between mb-3">
        <h3 className="text-sm font-medium text-tone-ink uppercase tracking-wider">
          60-day cohort retention · {data.period.label}
        </h3>
        <span className="text-xs text-grey-45">
          cohort size: {h.cohortSize} first-timer{h.cohortSize === 1 ? '' : 's'}
        </span>
      </div>
      <div className="flex items-baseline gap-3 mb-3">
        <span className="text-4xl font-semibold text-tone-ink">
          {h.retentionPct.toFixed(1)}%
        </span>
        {deltaText && <span className={`text-sm ${deltaTextClass}`}>{deltaText}</span>}
      </div>
      <p className="text-xs text-grey-60">
        {h.returnedCount} of {h.cohortSize} first-timers ({startDaysAgo}-{endDaysAgo}d ago)
        had a follow-up booking within 60 days of their first visit.
      </p>
    </div>
  );
}
