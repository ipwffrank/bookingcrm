'use client';

import { useEffect, useState } from 'react';
import { apiFetch, ApiError } from '../../lib/api';

interface UtilizationApiResponse {
  period: { start: string; end: string; label: string };
  headline: {
    utilizationPct: number;
    bookedMinutes: number;
    availableMinutes: number;
    denominatorSource: 'duties' | 'estimated';
    deltaVsPriorPp: number | null;
  } | null;
  byDayOfWeek: Array<{
    dow: number;
    label: string;
    utilizationPct: number | null;
    bookedMinutes: number;
    availableMinutes: number;
    lowSample: boolean;
  }>;
  guards: { lowSampleDows: string[] };
}

export function UtilizationSection({ windowQuery }: { windowQuery: string }) {
  const [data, setData] = useState<UtilizationApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    apiFetch(`/merchant/analytics/utilization?${windowQuery}`)
      .then((json: UtilizationApiResponse) => {
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
        <div className="h-4 bg-grey-15 rounded w-48 mb-3" />
        <div className="h-10 bg-grey-15 rounded w-32 mb-4" />
        <div className="flex items-end gap-2 h-20">
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="flex-1 bg-grey-15 rounded-t" style={{ height: `${20 + ((i * 13) % 60)}%` }} />
          ))}
        </div>
      </div>
    );
  }

  if (error || !data || !data.headline) {
    return (
      <div className="bg-tone-surface rounded-xl border border-grey-15 p-5">
        <h3 className="text-sm font-medium text-tone-ink uppercase tracking-wider">Capacity utilization</h3>
        <p className="mt-3 text-sm text-grey-60">
          {error
            ? `Couldn't load utilization: ${error}`
            : 'Utilization unavailable for this period — set up staff duties or operating hours to enable.'}
        </p>
      </div>
    );
  }

  const h = data.headline;
  const displayedPct = Math.min(100, Math.round(h.utilizationPct));
  const overflow = h.utilizationPct > 100;
  const delta = h.deltaVsPriorPp;
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
        ? 'flat vs prior'
        : delta >= 0
          ? `▲ ${delta.toFixed(1)}pp vs prior ${data.period.label}`
          : `▼ ${Math.abs(delta).toFixed(1)}pp vs prior ${data.period.label}`;
  const sourceLabel = h.denominatorSource === 'duties' ? 'duty rosters' : 'estimated capacity';

  // Bar heights are scaled to the highest non-null value in the period so
  // small absolute differences are still visible. Low-sample bars render
  // at reduced opacity so the eye doesn't anchor on unreliable slices.
  const maxPct = Math.max(...data.byDayOfWeek.map((b) => b.utilizationPct ?? 0));

  return (
    <div className="bg-tone-surface rounded-xl border border-grey-15 p-5">
      <div className="flex items-baseline justify-between mb-3">
        <h3 className="text-sm font-medium text-tone-ink uppercase tracking-wider">
          Capacity utilization · {data.period.label}
        </h3>
        <span className="text-xs text-grey-45">denominator: {sourceLabel}</span>
      </div>
      <div className="flex items-baseline gap-3 mb-4">
        <span className="text-4xl font-semibold text-tone-ink">
          {displayedPct}%{overflow && <sup className="ml-1 text-xs text-grey-45">100%+</sup>}
        </span>
        {deltaText && <span className={`text-sm ${deltaTextClass}`}>{deltaText}</span>}
      </div>
      <div className="flex items-end gap-2 h-24">
        {data.byDayOfWeek.map((b) => {
          const v = b.utilizationPct ?? 0;
          const heightPct = maxPct > 0 ? Math.min(100, (v / maxPct) * 100) : 0;
          const opacity = b.lowSample ? 0.45 : 1;
          const tooltip = b.lowSample
            ? `${b.label}: limited data (<10 bookings) — interpret with caution`
            : `${b.label}: ${Math.round(v)}% (${b.bookedMinutes} of ${b.availableMinutes} staff-minutes booked)`;
          return (
            <div key={b.dow} className="flex flex-col items-center gap-1.5 flex-1" title={tooltip}>
              <div className="w-full flex items-end" style={{ height: '100%' }}>
                <div
                  className="w-full rounded-sm bg-tone-ink transition-all"
                  style={{ height: `${heightPct}%`, minHeight: heightPct > 0 ? '2px' : '0', opacity }}
                />
              </div>
              <span className="text-xs text-grey-60">{b.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
