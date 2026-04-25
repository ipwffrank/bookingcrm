'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch, ApiError } from '../../lib/api';

// ─── Types ─────────────────────────────────────────────────────────────────────

type Period = '7d' | '30d' | '90d';

interface AnalyticsSummary {
  period: string;
  total_bookings: number;
  total_bookings_change: number | null;
  total_revenue: number;
  total_revenue_change: number | null;
  active_clients: number;
  avg_booking_value: number;
  avg_booking_value_change: number | null;
  new_clients: number;
  new_clients_change: number | null;
}

interface RevenuePoint {
  date: string;
  revenue: number;
  bookings_count: number;
}

interface RevenueData {
  period: string;
  revenue: RevenuePoint[];
}

interface StaffPerformanceRow {
  staff_id: string;
  staff_name: string;
  bookings_count: number;
  revenue: number;
  avg_rating: number | null;
}

interface StaffPerformanceData {
  period: string;
  staff_performance: StaffPerformanceRow[];
}

interface TopServiceRow {
  service_id: string;
  service_name: string;
  bookings_count: number;
  revenue: number;
}

interface TopServicesData {
  period: string;
  top_services: TopServiceRow[];
}

interface BookingSourceRow {
  source: string;
  count: number;
  revenue: number;
}

interface BookingSourcesData {
  period: string;
  booking_sources: BookingSourceRow[];
}

interface CancellationRateData {
  period: string;
  total: number;
  cancelled: number;
  no_show: number;
  completed: number;
  confirmed: number;
  in_progress: number;
  cancellation_rate: number;
  no_show_rate: number;
  completion_rate: number;
}

interface PeakHourCell { dow: number; hour: number; count: number; }
interface PeakHoursData { period: string; peak_hours: PeakHourCell[]; }

interface ClientRetentionData {
  period: string;
  new_clients: number;
  returning_clients: number;
  total_active: number;
}

interface RevByDowRow { dow: number; label: string; revenue: number; count: number; }
interface RevByDowData { period: string; revenue_by_dow: RevByDowRow[]; }

interface ClientSegmentRow {
  key: 'new' | 'returning' | 'walkin';
  label: string;
  bookings: number;
  revenue: number;
}
interface RevenueByClientSegmentData {
  period: string;
  currency: string;
  segments: ClientSegmentRow[];
  totals: { bookings: number; revenue: number };
}

interface ReviewDistributionRow { rating: number; count: number; percentage: number; }
interface ReviewDistributionData { period: string; distribution: ReviewDistributionRow[]; }

interface ReviewTrendRow { week: string; avgRating: number; count: number; }
interface ReviewTrendData { period: string; trend: ReviewTrendRow[]; }

interface FirstTimerROIData {
  period: string;
  first_timers_count: number;
  discount_given_sgd: string;
  mature_first_timers_count: number;
  returned_count: number;
  return_rate_pct: number | null;
  return_revenue_sgd: string;
  net_roi_sgd: string;
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function formatCurrency(amount: number): string {
  return `S$${amount.toFixed(2)}`;
}

function formatSourceLabel(source: string): string {
  const labels: Record<string, string> = {
    google_reserve: 'Google Reserve',
    direct_widget: 'Direct Widget',
    walkin_manual: 'Walk-in / Manual',
    instagram: 'Instagram',
    facebook: 'Facebook',
    phone: 'Phone',
    other: 'Other',
  };
  return labels[source] ?? source.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-SG', { month: 'short', day: 'numeric' });
}

// ─── Change Badge ──────────────────────────────────────────────────────────────

function ChangeBadge({ change }: { change: number | null }) {
  if (change === null) return <span className="text-xs text-grey-45">No prev data</span>;

  const isPositive = change >= 0;
  return (
    <span
      className={`inline-flex items-center gap-0.5 text-xs font-medium ${
        isPositive ? 'text-tone-sage' : 'text-semantic-danger'
      }`}
    >
      {isPositive ? (
        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 10.5 12 3m0 0 7.5 7.5M12 3v18" />
        </svg>
      ) : (
        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 13.5 12 21m0 0-7.5-7.5M12 21V3" />
        </svg>
      )}
      {Math.abs(change)}%
    </span>
  );
}

// ─── Loading Skeleton ──────────────────────────────────────────────────────────

function SkeletonCard() {
  return (
    <div className="bg-tone-surface rounded-xl border border-grey-15 p-5 animate-pulse">
      <div className="h-3 bg-grey-15 rounded w-24 mb-3" />
      <div className="h-7 bg-grey-15 rounded w-32 mb-2" />
      <div className="h-3 bg-grey-15 rounded w-16" />
    </div>
  );
}

function SkeletonTable({ rows = 4 }: { rows?: number }) {
  return (
    <div className="animate-pulse space-y-3">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex gap-4">
          <div className="h-4 bg-grey-15 rounded flex-1" />
          <div className="h-4 bg-grey-15 rounded w-16" />
          <div className="h-4 bg-grey-15 rounded w-20" />
        </div>
      ))}
    </div>
  );
}

function SkeletonChart() {
  return (
    <div className="animate-pulse flex items-end gap-1 h-40">
      {Array.from({ length: 14 }).map((_, i) => (
        <div
          key={i}
          className="flex-1 bg-grey-15 rounded-t"
          style={{ height: `${20 + Math.random() * 80}%` }}
        />
      ))}
    </div>
  );
}

// ─── Summary Cards ─────────────────────────────────────────────────────────────

function SummaryCards({
  data,
  loading,
}: {
  data: AnalyticsSummary | null;
  loading: boolean;
}) {
  if (loading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4">
        {Array.from({ length: 5 }).map((_, i) => <SkeletonCard key={i} />)}
      </div>
    );
  }

  if (!data) return null;

  // Hierarchy by visual weight, not hue:
  //  - Revenue = primary (ink-filled)
  //  - Bookings = secondary (sage tint)
  //  - The rest = supporting (neutral surface with grey border)
  const cards = [
    {
      label: 'Total Revenue',
      value: formatCurrency(data.total_revenue),
      change: data.total_revenue_change,
      accent: 'text-tone-surface bg-tone-ink border-tone-ink',
    },
    {
      label: 'Total Bookings',
      value: data.total_bookings.toLocaleString(),
      change: data.total_bookings_change,
      accent: 'text-tone-sage bg-tone-sage/10 border-tone-sage/30',
    },
    {
      label: 'Avg Booking Value',
      value: formatCurrency(data.avg_booking_value),
      change: data.avg_booking_value_change,
      accent: 'text-tone-ink bg-tone-surface border-grey-15',
    },
    {
      label: 'Active Clients',
      value: data.active_clients.toLocaleString(),
      change: null,
      accent: 'text-tone-ink bg-tone-surface border-grey-15',
    },
    {
      label: 'New Clients',
      value: data.new_clients.toLocaleString(),
      change: data.new_clients_change,
      accent: 'text-tone-ink bg-tone-surface border-grey-15',
    },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4">
      {cards.map((card) => (
        <div
          key={card.label}
          className={`rounded-xl border p-5 ${card.accent}`}
        >
          <p className="text-xs font-medium opacity-70 mb-1">{card.label}</p>
          <p className="text-2xl font-bold tracking-tight mb-1">{card.value}</p>
          <ChangeBadge change={card.change} />
        </div>
      ))}
    </div>
  );
}

// ─── Revenue Chart ─────────────────────────────────────────────────────────────

function RevenueChart({
  data,
  loading,
}: {
  data: RevenueData | null;
  loading: boolean;
}) {
  const [tooltip, setTooltip] = useState<{ index: number; x: number } | null>(null);

  if (loading) {
    return (
      <div className="bg-tone-surface rounded-xl border border-grey-15 p-6">
        <div className="h-5 bg-grey-15 rounded w-32 mb-6 animate-pulse" />
        <SkeletonChart />
      </div>
    );
  }

  if (!data || data.revenue.length === 0) {
    return (
      <div className="bg-tone-surface rounded-xl border border-grey-15 p-6">
        <h2 className="text-sm font-semibold text-grey-75 mb-4">Revenue Over Time</h2>
        <div className="flex items-center justify-center h-40 text-grey-45 text-sm">
          No revenue data for this period
        </div>
      </div>
    );
  }

  const points = data.revenue;
  const maxRevenue = Math.max(...points.map((p) => p.revenue), 1);

  return (
    <div className="bg-tone-surface rounded-xl border border-grey-15 p-6">
      <h2 className="text-sm font-semibold text-grey-75 mb-4">Revenue Over Time</h2>
      <div className="relative">
        {/* Y-axis labels */}
        <div className="flex">
          <div className="flex flex-col justify-between text-xs text-grey-45 pr-2 h-40 text-right w-14 flex-shrink-0">
            <span>S${maxRevenue.toFixed(0)}</span>
            <span>S${(maxRevenue / 2).toFixed(0)}</span>
            <span>S$0</span>
          </div>
          {/* Bars */}
          <div className="flex-1 flex items-end gap-0.5 h-40 relative">
            {points.map((point, i) => {
              const heightPct = maxRevenue > 0 ? (point.revenue / maxRevenue) * 100 : 0;
              const isHovered = tooltip?.index === i;
              return (
                <div
                  key={point.date}
                  className="flex-1 flex flex-col justify-end h-full group relative"
                  onMouseEnter={(e) => setTooltip({ index: i, x: e.currentTarget.getBoundingClientRect().left })}
                  onMouseLeave={() => setTooltip(null)}
                >
                  <div
                    className={`rounded-t transition-colors cursor-default ${
                      isHovered
                        ? 'bg-tone-ink'
                        : point.revenue > 0
                        ? 'bg-tone-sage hover:bg-tone-ink'
                        : 'bg-grey-15'
                    }`}
                    style={{ height: `${Math.max(heightPct, point.revenue > 0 ? 2 : 0)}%` }}
                  />
                  {/* Tooltip */}
                  {isHovered && (
                    <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 z-10 bg-tone-ink text-white text-xs rounded-lg px-2.5 py-1.5 whitespace-nowrap pointer-events-none shadow-lg">
                      <p className="font-medium">{formatDate(point.date)}</p>
                      <p>{formatCurrency(point.revenue)}</p>
                      <p className="text-grey-30">{point.bookings_count} bookings</p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
        {/* X-axis: show only a subset of dates to avoid crowding */}
        <div className="flex mt-1 pl-14">
          {points.map((point, i) => {
            const showLabel =
              points.length <= 10 ||
              i === 0 ||
              i === points.length - 1 ||
              i % Math.ceil(points.length / 6) === 0;
            return (
              <div key={point.date} className="flex-1 text-center">
                {showLabel ? (
                  <span className="text-xs text-grey-45">{formatDate(point.date)}</span>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Staff Performance Table ───────────────────────────────────────────────────

function StaffPerformanceTable({
  data,
  loading,
}: {
  data: StaffPerformanceData | null;
  loading: boolean;
}) {
  return (
    <div className="bg-tone-surface rounded-xl border border-grey-15 p-6">
      <h2 className="text-sm font-semibold text-grey-75 mb-4">Staff Performance</h2>
      {loading ? (
        <SkeletonTable rows={4} />
      ) : !data || data.staff_performance.length === 0 ? (
        <p className="text-sm text-grey-45 py-6 text-center">No staff data for this period</p>
      ) : (
        <div className="overflow-x-auto -mx-1">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-grey-5">
                <th className="text-left text-xs font-medium text-grey-60 pb-2 pr-3">Staff</th>
                <th className="text-right text-xs font-medium text-grey-60 pb-2 px-3">Bookings</th>
                <th className="text-right text-xs font-medium text-grey-60 pb-2 px-3">Revenue</th>
                <th className="text-right text-xs font-medium text-grey-60 pb-2 pl-3">Avg Rating</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-grey-5">
              {data.staff_performance.map((row) => (
                <tr key={row.staff_id} className="hover:bg-grey-5 transition-colors">
                  <td className="py-2.5 pr-3 font-medium text-tone-ink">{row.staff_name}</td>
                  <td className="py-2.5 px-3 text-right text-grey-75">{row.bookings_count}</td>
                  <td className="py-2.5 px-3 text-right text-tone-ink font-medium">
                    {formatCurrency(row.revenue)}
                  </td>
                  <td className="py-2.5 pl-3 text-right">
                    {row.avg_rating !== null ? (
                      <span className="inline-flex items-center gap-1 text-semantic-warn font-medium">
                        <svg className="w-3.5 h-3.5 fill-amber-400" viewBox="0 0 20 20">
                          <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                        </svg>
                        {row.avg_rating.toFixed(1)}
                      </span>
                    ) : (
                      <span className="text-grey-30 text-xs">No reviews</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Top Services Table ────────────────────────────────────────────────────────

function TopServicesTable({
  data,
  loading,
}: {
  data: TopServicesData | null;
  loading: boolean;
}) {
  return (
    <div className="bg-tone-surface rounded-xl border border-grey-15 p-6">
      <h2 className="text-sm font-semibold text-grey-75 mb-4">Top Services</h2>
      {loading ? (
        <SkeletonTable rows={4} />
      ) : !data || data.top_services.length === 0 ? (
        <p className="text-sm text-grey-45 py-6 text-center">No service data for this period</p>
      ) : (
        <div className="overflow-x-auto -mx-1">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-grey-5">
                <th className="text-left text-xs font-medium text-grey-60 pb-2 pr-3">Service</th>
                <th className="text-right text-xs font-medium text-grey-60 pb-2 px-3">Bookings</th>
                <th className="text-right text-xs font-medium text-grey-60 pb-2 pl-3">Revenue</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-grey-5">
              {data.top_services.map((row, i) => {
                const maxRevenue = data.top_services[0]?.revenue ?? 1;
                const pct = maxRevenue > 0 ? (row.revenue / maxRevenue) * 100 : 0;
                return (
                  <tr key={row.service_id} className="hover:bg-grey-5 transition-colors">
                    <td className="py-2.5 pr-3">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-grey-45 w-4 flex-shrink-0">#{i + 1}</span>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-tone-ink truncate">{row.service_name}</p>
                          <div className="mt-0.5 h-1 bg-grey-15 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-tone-sage rounded-full"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="py-2.5 px-3 text-right text-grey-75">{row.bookings_count}</td>
                    <td className="py-2.5 pl-3 text-right font-medium text-tone-ink">
                      {formatCurrency(row.revenue)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Booking Sources ───────────────────────────────────────────────────────────

function BookingSources({
  data,
  loading,
}: {
  data: BookingSourcesData | null;
  loading: boolean;
}) {
  const SOURCE_COLORS: Record<string, string> = {
    google_reserve: 'bg-grey-75',
    direct_widget: 'bg-tone-ink',
    walkin_manual: 'bg-grey-75',
    instagram: 'bg-grey-75',
    facebook: 'bg-grey-60',
    phone: 'bg-grey-60',
    other: 'bg-grey-45',
  };

  return (
    <div className="bg-tone-surface rounded-xl border border-grey-15 p-6">
      <h2 className="text-sm font-semibold text-grey-75 mb-4">Booking Sources</h2>
      {loading ? (
        <div className="space-y-3 animate-pulse">
          {[80, 60, 40, 25].map((w, i) => (
            <div key={i} className="flex items-center gap-3">
              <div className="h-4 bg-grey-15 rounded w-28 flex-shrink-0" />
              <div className="flex-1 h-3 bg-grey-15 rounded-full" style={{ maxWidth: `${w}%` }} />
              <div className="h-4 bg-grey-15 rounded w-8" />
            </div>
          ))}
        </div>
      ) : !data || data.booking_sources.length === 0 ? (
        <p className="text-sm text-grey-45 py-6 text-center">No source data for this period</p>
      ) : (
        <div className="space-y-3">
          {(() => {
            const totalCount = data.booking_sources.reduce((s, r) => s + r.count, 0);
            return data.booking_sources.map((row) => {
              const pct = totalCount > 0 ? (row.count / totalCount) * 100 : 0;
              const colorClass = SOURCE_COLORS[row.source] ?? 'bg-grey-45';
              return (
                <div key={row.source} className="flex items-center gap-3">
                  <div className="w-28 flex-shrink-0 text-xs text-grey-75 font-medium truncate">
                    {formatSourceLabel(row.source)}
                  </div>
                  <div className="flex-1 bg-grey-15 rounded-full h-2.5 overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${colorClass}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <div className="flex-shrink-0 text-right w-16">
                    <span className="text-xs font-medium text-grey-75">{row.count}</span>
                    <span className="text-xs text-grey-45 ml-1">({pct.toFixed(0)}%)</span>
                  </div>
                </div>
              );
            });
          })()}
        </div>
      )}
    </div>
  );
}

// ─── Cancellation / No-show Rates ─────────────────────────────────────────────

function CancellationRates({ data, loading }: { data: CancellationRateData | null; loading: boolean }) {
  const bars = data ? [
    { label: 'Completed',    value: data.completion_rate,   color: 'bg-tone-sage', count: data.completed },
    { label: 'Cancellations', value: data.cancellation_rate, color: 'bg-semantic-danger',     count: data.cancelled },
    { label: 'No-shows',     value: data.no_show_rate,      color: 'bg-semantic-warn',  count: data.no_show },
  ] : [];

  return (
    <div className="bg-tone-surface rounded-xl border border-grey-15 p-6">
      <h2 className="text-sm font-semibold text-grey-75 mb-4">Booking Outcomes</h2>
      {loading ? <SkeletonTable rows={3} /> : !data ? null : (
        <div className="space-y-3">
          <p className="text-xs text-grey-45 mb-3">{data.total} total bookings this period</p>
          {bars.map(({ label, value, color, count }) => (
            <div key={label} className="flex items-center gap-3">
              <div className="w-28 flex-shrink-0 text-xs font-medium text-grey-75">{label}</div>
              <div className="flex-1 bg-grey-15 rounded-full h-2.5 overflow-hidden">
                <div className={`h-full rounded-full ${color} transition-all`} style={{ width: `${value}%` }} />
              </div>
              <div className="w-20 text-right flex-shrink-0">
                <span className="text-xs font-semibold text-grey-90">{value}%</span>
                <span className="text-xs text-grey-45 ml-1">({count})</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Client Retention ──────────────────────────────────────────────────────────

function ClientRetention({ data, loading }: { data: ClientRetentionData | null; loading: boolean }) {
  const total      = data?.total_active ?? 0;
  const newPct     = total > 0 ? Math.round((data!.new_clients / total) * 100) : 0;
  const returnPct  = total > 0 ? Math.round((data!.returning_clients / total) * 100) : 0;

  return (
    <div className="bg-tone-surface rounded-xl border border-grey-15 p-6">
      <h2 className="text-sm font-semibold text-grey-75 mb-4">Client Retention</h2>
      {loading ? <SkeletonTable rows={2} /> : !data || total === 0 ? (
        <p className="text-sm text-grey-45 py-6 text-center">No client data for this period</p>
      ) : (
        <div className="space-y-4">
          <div className="flex rounded-xl overflow-hidden h-8">
            <div className="flex items-center justify-center text-xs font-semibold text-white bg-tone-ink transition-all" style={{ width: `${newPct}%` }}>
              {newPct > 15 ? `New ${newPct}%` : ''}
            </div>
            <div className="flex items-center justify-center text-xs font-semibold text-white bg-grey-45 transition-all" style={{ width: `${returnPct}%` }}>
              {returnPct > 15 ? `Return ${returnPct}%` : ''}
            </div>
          </div>
          <div className="flex gap-6">
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-tone-ink flex-shrink-0" />
              <div>
                <p className="text-base font-bold text-tone-ink">{data.new_clients}</p>
                <p className="text-xs text-grey-45">New clients ({newPct}%)</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-grey-45 flex-shrink-0" />
              <div>
                <p className="text-base font-bold text-tone-ink">{data.returning_clients}</p>
                <p className="text-xs text-grey-45">Returning ({returnPct}%)</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Revenue by Client Segment ────────────────────────────────────────────────
// Three-way split (new / returning / walk-in). Walk-in trumps tenure — even if
// a returning customer walks in, that booking counts in walk-in revenue
// because the operational pattern is what matters here.

function RevenueByClientSegment({
  data,
  loading,
}: {
  data: RevenueByClientSegmentData | null;
  loading: boolean;
}) {
  const total = data?.totals.revenue ?? 0;
  // Tone palette per segment — restricted to the three allowed dashboard tones
  // (no chromatic colors).
  const toneClass: Record<ClientSegmentRow['key'], string> = {
    new:       'bg-tone-ink',
    returning: 'bg-tone-sage',
    walkin:    'bg-grey-45',
  };
  const dotClass: Record<ClientSegmentRow['key'], string> = {
    new:       'bg-tone-ink',
    returning: 'bg-tone-sage',
    walkin:    'bg-grey-45',
  };

  return (
    <div className="bg-tone-surface rounded-xl border border-grey-15 p-6">
      <h2 className="text-sm font-semibold text-grey-75 mb-1">Revenue by Client Segment</h2>
      <p className="text-xs text-grey-60 mb-4">
        How revenue splits across walk-ins, first-time bookers, and your repeat clients.
      </p>
      {loading ? (
        <SkeletonTable rows={2} />
      ) : !data || total === 0 ? (
        <p className="text-sm text-grey-45 py-6 text-center">No revenue data for this period</p>
      ) : (
        <div className="space-y-4">
          {/* Stacked bar */}
          <div className="flex rounded-xl overflow-hidden h-8">
            {data.segments.map((seg) => {
              const pct = total > 0 ? (seg.revenue / total) * 100 : 0;
              if (pct === 0) return null;
              return (
                <div
                  key={seg.key}
                  className={`flex items-center justify-center text-xs font-semibold text-white ${toneClass[seg.key]} transition-all`}
                  style={{ width: `${pct}%` }}
                  title={`${seg.label}: SGD ${seg.revenue.toFixed(2)} (${pct.toFixed(0)}%)`}
                >
                  {pct > 12 ? `${pct.toFixed(0)}%` : ''}
                </div>
              );
            })}
          </div>

          {/* Per-segment summary */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {data.segments.map((seg) => {
              const pct = total > 0 ? (seg.revenue / total) * 100 : 0;
              return (
                <div key={seg.key} className="flex items-start gap-2">
                  <span className={`w-3 h-3 rounded-full ${dotClass[seg.key]} flex-shrink-0 mt-1.5`} />
                  <div className="min-w-0">
                    <p className="text-base font-bold text-tone-ink">
                      SGD {seg.revenue.toLocaleString('en-SG', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                    </p>
                    <p className="text-xs text-grey-60">{seg.label}</p>
                    <p className="text-[11px] text-grey-45 mt-0.5">
                      {seg.bookings} booking{seg.bookings === 1 ? '' : 's'} · {pct.toFixed(0)}%
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Revenue by Day of Week ────────────────────────────────────────────────────

function RevByDow({ data, loading }: { data: RevByDowData | null; loading: boolean }) {
  const maxRev = data ? Math.max(...data.revenue_by_dow.map(r => r.revenue), 1) : 1;
  return (
    <div className="bg-tone-surface rounded-xl border border-grey-15 p-6">
      <h2 className="text-sm font-semibold text-grey-75 mb-4">Revenue by Day of Week</h2>
      {loading ? <SkeletonChart /> : !data ? null : (
        <div className="flex items-end gap-2 h-40">
          {data.revenue_by_dow.map(row => {
            const pct = maxRev > 0 ? (row.revenue / maxRev) * 100 : 0;
            return (
              <div key={row.dow} className="flex-1 flex flex-col items-center gap-1 group relative h-full justify-end">
                <div
                  className="w-full rounded-t bg-grey-45 hover:bg-grey-75 transition-colors cursor-default relative"
                  style={{ height: `${Math.max(pct, row.revenue > 0 ? 4 : 0)}%` }}
                >
                  {/* Tooltip */}
                  <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 z-10 bg-tone-ink text-white text-xs rounded-lg px-2 py-1.5 whitespace-nowrap pointer-events-none shadow-lg opacity-0 group-hover:opacity-100 transition-opacity">
                    <p className="font-medium">{row.label}</p>
                    <p>S${row.revenue.toFixed(0)}</p>
                    <p className="text-grey-30">{row.count} bookings</p>
                  </div>
                </div>
                <span className="text-[10px] text-grey-45">{row.label}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Peak Hours Heatmap ────────────────────────────────────────────────────────

function PeakHoursHeatmap({ data, loading }: { data: PeakHoursData | null; loading: boolean }) {
  const DOW   = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const HOURS = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];

  const maxCount = data ? Math.max(...data.peak_hours.map(c => c.count), 1) : 1;
  const countAt  = (dow: number, hour: number) =>
    data?.peak_hours.find(c => c.dow === dow && c.hour === hour)?.count ?? 0;

  const opacity = (count: number) => {
    if (count === 0) return 0;
    return 0.1 + (count / maxCount) * 0.85;
  };

  return (
    <div className="bg-tone-surface rounded-xl border border-grey-15 p-6">
      <h2 className="text-sm font-semibold text-grey-75 mb-4">Peak Hours</h2>
      {loading ? (
        <div className="animate-pulse h-40 bg-grey-15 rounded-lg" />
      ) : !data || data.peak_hours.length === 0 ? (
        <p className="text-sm text-grey-45 py-6 text-center">No data for this period</p>
      ) : (
        <div className="overflow-x-auto">
          <div className="min-w-[460px]">
            {/* Day headers */}
            <div className="flex mb-1 pl-10">
              {DOW.map(d => (
                <div key={d} className="flex-1 text-center text-[10px] font-semibold text-grey-45">{d}</div>
              ))}
            </div>
            {/* Hour rows */}
            {HOURS.map(hour => (
              <div key={hour} className="flex items-center mb-0.5">
                <div className="w-10 text-[10px] text-grey-45 text-right pr-2 flex-shrink-0">
                  {hour < 12 ? `${hour}am` : hour === 12 ? '12pm' : `${hour - 12}pm`}
                </div>
                {DOW.map((_, dow) => {
                  const count = countAt(dow, hour);
                  return (
                    <div key={dow} className="flex-1 mx-0.5 relative group">
                      <div
                        className="h-6 rounded-sm transition-all"
                        style={{ backgroundColor: `rgba(26, 35, 19, ${opacity(count)})`, minHeight: 8 }}
                      />
                      {count > 0 && (
                        <div className="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 z-10 bg-tone-ink text-white text-[10px] rounded px-1.5 py-1 whitespace-nowrap pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity shadow-lg">
                          {count} booking{count !== 1 ? 's' : ''}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
            {/* Legend */}
            <div className="flex items-center gap-2 mt-3 pl-10">
              <span className="text-[10px] text-grey-45">Less</span>
              {[0.1, 0.3, 0.5, 0.7, 0.95].map(o => (
                <div key={o} className="w-4 h-4 rounded-sm" style={{ backgroundColor: `rgba(26,35,19,${o})` }} />
              ))}
              <span className="text-[10px] text-grey-45">More</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Rating Distribution ──────────────────────────────────────────────────────

function RatingDistribution({ data }: { data: ReviewDistributionData | null }) {
  if (!data || data.distribution.every(d => d.count === 0)) {
    return (
      <div className="bg-tone-surface rounded-xl border border-grey-15 p-5">
        <h3 className="text-sm font-semibold text-tone-ink mb-3">Rating Distribution</h3>
        <p className="text-xs text-grey-45">No reviews in this period.</p>
      </div>
    );
  }

  const total = data.distribution.reduce((sum, d) => sum + d.count, 0);
  const avg = total > 0
    ? data.distribution.reduce((sum, d) => sum + d.rating * d.count, 0) / total
    : 0;

  function barColor(rating: number): string {
    if (rating >= 4) return 'bg-tone-sage';
    if (rating === 3) return 'bg-semantic-warn';
    return 'bg-semantic-danger';
  }

  return (
    <div className="bg-tone-surface rounded-xl border border-grey-15 p-5">
      <h3 className="text-sm font-semibold text-tone-ink mb-4">Rating Distribution</h3>
      <div className="space-y-2">
        {data.distribution.map(d => (
          <div key={d.rating} className="flex items-center gap-2">
            <span className="text-xs text-grey-60 w-7 text-right">{d.rating} ★</span>
            <div className="flex-1 h-5 bg-grey-15 rounded overflow-hidden">
              <div
                className={`h-full ${barColor(d.rating)} rounded`}
                style={{ width: `${d.percentage}%` }}
              />
            </div>
            <span className="text-xs text-grey-60 w-16">{d.count} ({d.percentage}%)</span>
          </div>
        ))}
      </div>
      <div className="flex justify-between mt-3 pt-3 border-t border-grey-5">
        <span className="text-xs text-grey-45">{total} reviews</span>
        <span className="text-sm font-semibold text-semantic-warn">★ {avg.toFixed(1)} avg</span>
      </div>
    </div>
  );
}

// ─── Rating Trend ─────────────────────────────────────────────────────────────

function RatingTrend({ data }: { data: ReviewTrendData | null }) {
  if (!data || data.trend.length === 0) {
    return (
      <div className="bg-tone-surface rounded-xl border border-grey-15 p-5">
        <h3 className="text-sm font-semibold text-tone-ink mb-3">Average Rating Over Time</h3>
        <p className="text-xs text-grey-45">No reviews in this period.</p>
      </div>
    );
  }

  const maxRating = 5;
  const minRating = 1;
  const range = maxRating - minRating;
  const points = data.trend;
  const chartWidth = 400;
  const chartHeight = 140;
  const padding = 10;

  const xStep = points.length > 1 ? (chartWidth - 2 * padding) / (points.length - 1) : 0;

  const polyline = points
    .map((p, i) => {
      const x = padding + i * xStep;
      const y = chartHeight - padding - ((p.avgRating - minRating) / range) * (chartHeight - 2 * padding);
      return `${x},${y}`;
    })
    .join(' ');

  function formatWeek(weekStr: string): string {
    const d = new Date(weekStr + 'T00:00:00');
    return d.toLocaleDateString('en-SG', { day: 'numeric', month: 'short' });
  }

  return (
    <div className="bg-tone-surface rounded-xl border border-grey-15 p-5">
      <h3 className="text-sm font-semibold text-tone-ink mb-4">Average Rating Over Time</h3>
      <div className="relative" style={{ height: chartHeight + 30 }}>
        {[5, 4, 3, 2, 1].map(val => {
          const y = chartHeight - padding - ((val - minRating) / range) * (chartHeight - 2 * padding);
          return (
            <span key={val} className="absolute text-[10px] text-grey-45" style={{ left: 0, top: y - 6 }}>
              {val}.0
            </span>
          );
        })}

        <svg
          viewBox={`0 0 ${chartWidth} ${chartHeight}`}
          className="w-full"
          style={{ height: chartHeight, marginLeft: 28 }}
          preserveAspectRatio="none"
        >
          {[5, 4, 3, 2, 1].map(val => {
            const y = chartHeight - padding - ((val - minRating) / range) * (chartHeight - 2 * padding);
            return <line key={val} x1={0} y1={y} x2={chartWidth} y2={y} stroke="var(--color-grey-15)" strokeWidth={1} />;
          })}
          <polyline
            fill="none"
            stroke="var(--color-tone-sage)"
            strokeWidth="2.5"
            strokeLinejoin="round"
            strokeLinecap="round"
            points={polyline}
          />
          {points.map((p, i) => {
            const x = padding + i * xStep;
            const y = chartHeight - padding - ((p.avgRating - minRating) / range) * (chartHeight - 2 * padding);
            return <circle key={i} cx={x} cy={y} r={3.5} fill="var(--color-tone-sage)" />;
          })}
        </svg>

        <div className="flex justify-between" style={{ marginLeft: 28, marginTop: 4 }}>
          {points.map((p, i) => (
            <span key={i} className="text-[10px] text-grey-45">{formatWeek(p.week)}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── First-Timer Discount Performance ────────────────────────────────────────

function FirstTimerROI({
  data,
  loading,
}: {
  data: FirstTimerROIData | null;
  loading: boolean;
}) {
  if (loading) {
    return (
      <div className="bg-tone-surface rounded-xl border border-grey-15 p-6">
        <h2 className="text-sm font-semibold text-grey-75 mb-4">
          First-Timer Discount Performance
        </h2>
        <SkeletonCard />
      </div>
    );
  }

  if (!data || data.first_timers_count === 0) {
    return (
      <div className="bg-tone-surface rounded-xl border border-grey-15 p-6">
        <h2 className="text-sm font-semibold text-grey-75 mb-4">
          First-Timer Discount Performance
        </h2>
        <p className="text-sm text-grey-60">
          No first-timer discounts granted in this period.
        </p>
      </div>
    );
  }

  const net = parseFloat(data.net_roi_sgd);
  const netPositive = net >= 0;
  const netLabel = `${netPositive ? '+' : '−'}SGD ${Math.abs(net).toFixed(2)}`;
  const netColor = netPositive ? 'text-tone-sage' : 'text-semantic-warn';

  return (
    <div className="bg-tone-surface rounded-xl border border-grey-15 p-6">
      <h2 className="text-sm font-semibold text-grey-75 mb-4">
        First-Timer Discount Performance
      </h2>

      {/* Net ROI hero */}
      <div className="bg-grey-5 rounded-xl border border-grey-15 p-5 mb-4">
        <div className="text-xs text-grey-60 mb-1">Net ROI</div>
        <div
          className={`text-3xl font-bold ${netColor}`}
          aria-label={`Net return on investment: ${netPositive ? 'positive' : 'negative'} ${Math.abs(net).toFixed(2)} Singapore dollars.`}
        >
          {netLabel}
        </div>
        <div className="text-xs text-grey-45 mt-1">
          return revenue − discount given
        </div>
      </div>

      {/* 4 stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-grey-5 rounded-xl border border-grey-15 p-4">
          <div className="text-xs text-grey-60 mb-1">First-timers</div>
          <div className="text-xl font-semibold text-tone-ink">
            {data.first_timers_count}
          </div>
        </div>
        <div className="bg-grey-5 rounded-xl border border-grey-15 p-4">
          <div className="text-xs text-grey-60 mb-1">Discount given</div>
          <div className="text-xl font-semibold text-tone-ink">
            SGD {parseFloat(data.discount_given_sgd).toFixed(2)}
          </div>
        </div>
        <div className="bg-grey-5 rounded-xl border border-grey-15 p-4">
          <div
            className="text-xs text-grey-60 mb-1"
            title={
              data.return_rate_pct === null
                ? 'Need at least one first-timer from 30+ days ago.'
                : undefined
            }
          >
            Return rate (30d+)
          </div>
          <div className="text-xl font-semibold text-tone-ink">
            {data.return_rate_pct === null ? '—' : `${data.return_rate_pct}%`}
          </div>
        </div>
        <div className="bg-grey-5 rounded-xl border border-grey-15 p-4">
          <div className="text-xs text-grey-60 mb-1">Revenue from returns</div>
          <div className="text-xl font-semibold text-tone-ink">
            SGD {parseFloat(data.return_revenue_sgd).toFixed(2)}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Period Selector ───────────────────────────────────────────────────────────

function PeriodSelector({
  period,
  onChange,
}: {
  period: Period;
  onChange: (p: Period) => void;
}) {
  const options: { value: Period; label: string }[] = [
    { value: '7d', label: 'Last 7 days' },
    { value: '30d', label: 'Last 30 days' },
    { value: '90d', label: 'Last 90 days' },
  ];

  return (
    <div className="flex gap-1 bg-grey-15 rounded-xl p-1">
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={`flex-1 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
            period === opt.value
              ? 'bg-tone-surface text-tone-sage shadow-sm'
              : 'text-grey-60 hover:text-grey-75'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

export default function AnalyticsPage() {
  const router = useRouter();
  const [period, setPeriod] = useState<Period>('30d');

  const [summaryData, setSummaryData]           = useState<AnalyticsSummary | null>(null);
  const [revenueData, setRevenueData]           = useState<RevenueData | null>(null);
  const [staffData, setStaffData]               = useState<StaffPerformanceData | null>(null);
  const [servicesData, setServicesData]         = useState<TopServicesData | null>(null);
  const [sourcesData, setSourcesData]           = useState<BookingSourcesData | null>(null);
  const [cancelData, setCancelData]             = useState<CancellationRateData | null>(null);
  const [peakData, setPeakData]                 = useState<PeakHoursData | null>(null);
  const [retentionData, setRetentionData]       = useState<ClientRetentionData | null>(null);
  const [segmentData, setSegmentData]           = useState<RevenueByClientSegmentData | null>(null);
  const [revDowData, setRevDowData]             = useState<RevByDowData | null>(null);
  const [reviewDistribution, setReviewDistribution] = useState<ReviewDistributionData | null>(null);
  const [reviewTrend, setReviewTrend]           = useState<ReviewTrendData | null>(null);
  const [firstTimerROIData, setFirstTimerROIData] = useState<FirstTimerROIData | null>(null);

  const [loadingSummary, setLoadingSummary]     = useState(true);
  const [loadingRevenue, setLoadingRevenue]     = useState(true);
  const [loadingStaff, setLoadingStaff]         = useState(true);
  const [loadingServices, setLoadingServices]   = useState(true);
  const [loadingSources, setLoadingSources]     = useState(true);
  const [loadingCancel, setLoadingCancel]       = useState(true);
  const [loadingPeak, setLoadingPeak]           = useState(true);
  const [loadingRetention, setLoadingRetention] = useState(true);
  const [loadingSegment, setLoadingSegment]     = useState(true);
  const [loadingRevDow, setLoadingRevDow]       = useState(true);
  const [firstTimerROILoading, setFirstTimerROILoading] = useState(true);

  const [error, setError] = useState('');

  const fetchAll = useCallback(
    async (p: Period) => {
      const token = localStorage.getItem('access_token');
      if (!token) {
        router.push('/login');
        return;
      }

      const headers = { Authorization: `Bearer ${token}` };

      setLoadingSummary(true);
      setLoadingRevenue(true);
      setLoadingStaff(true);
      setLoadingServices(true);
      setLoadingSources(true);
      setLoadingCancel(true);
      setLoadingPeak(true);
      setLoadingRetention(true);
      setLoadingRevDow(true);
      setFirstTimerROILoading(true);
      setError('');

      const handleError = (err: unknown) => {
        const msg = err instanceof Error ? err.message : 'Failed to load analytics';
        if (err instanceof ApiError && err.status === 401) {
          router.push('/login');
        } else {
          setError(msg);
        }
      };

      // Fetch all in parallel, each independently so partial failures don't block others
      void (async () => {
        try {
          const data = await apiFetch(`/merchant/analytics/summary?period=${p}`, { headers }) as AnalyticsSummary;
          setSummaryData(data);
        } catch (e) { handleError(e); } finally { setLoadingSummary(false); }
      })();

      void (async () => {
        try {
          const data = await apiFetch(`/merchant/analytics/revenue?period=${p}`, { headers }) as RevenueData;
          setRevenueData(data);
        } catch (e) { handleError(e); } finally { setLoadingRevenue(false); }
      })();

      void (async () => {
        try {
          const data = await apiFetch(`/merchant/analytics/staff-performance?period=${p}`, { headers }) as StaffPerformanceData;
          setStaffData(data);
        } catch (e) { handleError(e); } finally { setLoadingStaff(false); }
      })();

      void (async () => {
        try {
          const data = await apiFetch(`/merchant/analytics/top-services?period=${p}`, { headers }) as TopServicesData;
          setServicesData(data);
        } catch (e) { handleError(e); } finally { setLoadingServices(false); }
      })();

      void (async () => {
        try {
          const data = await apiFetch(`/merchant/analytics/booking-sources?period=${p}`, { headers }) as BookingSourcesData;
          setSourcesData(data);
        } catch (e) { handleError(e); } finally { setLoadingSources(false); }
      })();

      void (async () => {
        try {
          const data = await apiFetch(`/merchant/analytics/cancellation-rate?period=${p}`, { headers }) as CancellationRateData;
          setCancelData(data);
        } catch (e) { handleError(e); } finally { setLoadingCancel(false); }
      })();

      void (async () => {
        try {
          const data = await apiFetch(`/merchant/analytics/peak-hours?period=${p}`, { headers }) as PeakHoursData;
          setPeakData(data);
        } catch (e) { handleError(e); } finally { setLoadingPeak(false); }
      })();

      void (async () => {
        try {
          const data = await apiFetch(`/merchant/analytics/client-retention?period=${p}`, { headers }) as ClientRetentionData;
          setRetentionData(data);
        } catch (e) { handleError(e); } finally { setLoadingRetention(false); }
      })();

      void (async () => {
        try {
          const data = await apiFetch(`/merchant/analytics/revenue-by-client-segment?period=${p}`, { headers }) as RevenueByClientSegmentData;
          setSegmentData(data);
        } catch (e) { handleError(e); } finally { setLoadingSegment(false); }
      })();

      void (async () => {
        try {
          const data = await apiFetch(`/merchant/analytics/revenue-by-dow?period=${p}`, { headers }) as RevByDowData;
          setRevDowData(data);
        } catch (e) { handleError(e); } finally { setLoadingRevDow(false); }
      })();

      void (async () => {
        try {
          const data = await apiFetch(`/merchant/analytics/review-distribution?period=${p}`, { headers }) as ReviewDistributionData;
          setReviewDistribution(data);
        } catch (e) { handleError(e); }
      })();

      void (async () => {
        try {
          const data = await apiFetch(`/merchant/analytics/review-trend?period=${p}`, { headers }) as ReviewTrendData;
          setReviewTrend(data);
        } catch (e) { handleError(e); }
      })();

      void (async () => {
        try {
          const data = await apiFetch(`/merchant/analytics/first-timer-roi?period=${p}`, { headers }) as FirstTimerROIData;
          setFirstTimerROIData(data);
        } catch (e) {
          setFirstTimerROIData(null);
          handleError(e);
        } finally { setFirstTimerROILoading(false); }
      })();
    },
    [router]
  );

  useEffect(() => {
    const token = localStorage.getItem('access_token');
    if (!token) {
      router.push('/login');
      return;
    }
    void fetchAll(period);
  }, [period, fetchAll, router]);

  function handlePeriodChange(p: Period) {
    setPeriod(p);
  }

  return (
    <>
      {/* Header */}
      <div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-tone-ink">Analytics</h1>
          <p className="text-sm text-grey-60 mt-0.5">Business performance overview</p>
        </div>
        <div className="sm:w-72">
          <PeriodSelector period={period} onChange={handlePeriodChange} />
        </div>
      </div>

      {error && (
        <div className="mb-6 rounded-xl bg-semantic-danger/5 border border-semantic-danger/30 px-4 py-3 text-sm text-semantic-danger flex items-center justify-between">
          <span>{error}</span>
          <button
            onClick={() => { setError(''); void fetchAll(period); }}
            className="ml-4 text-xs font-medium underline hover:no-underline flex-shrink-0"
          >
            Retry
          </button>
        </div>
      )}

      {/* Summary Cards */}
      <div className="mb-6">
        <SummaryCards data={summaryData} loading={loadingSummary} />
      </div>

      {/* Revenue Chart */}
      <div className="mb-6">
        <RevenueChart data={revenueData} loading={loadingRevenue} />
      </div>

      {/* Tables row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <StaffPerformanceTable data={staffData} loading={loadingStaff} />
        <TopServicesTable data={servicesData} loading={loadingServices} />
      </div>

      {/* Booking Sources */}
      <div className="mb-6">
        <BookingSources data={sourcesData} loading={loadingSources} />
      </div>

      {/* Outcomes + Retention */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <CancellationRates data={cancelData} loading={loadingCancel} />
        <ClientRetention   data={retentionData} loading={loadingRetention} />
      </div>

      {/* Revenue split by client segment — answers "where is my money coming from?" */}
      <div className="mb-6">
        <RevenueByClientSegment data={segmentData} loading={loadingSegment} />
      </div>

      {/* Revenue by Day of Week */}
      <div className="mb-6">
        <RevByDow data={revDowData} loading={loadingRevDow} />
      </div>

      {/* Peak Hours Heatmap */}
      <div className="mb-6">
        <PeakHoursHeatmap data={peakData} loading={loadingPeak} />
      </div>

      {/* Rating Distribution + Trend */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <RatingDistribution data={reviewDistribution} />
        <RatingTrend data={reviewTrend} />
      </div>

      {/* First-Timer Discount Performance */}
      <div className="mb-6">
        <FirstTimerROI data={firstTimerROIData} loading={firstTimerROILoading} />
      </div>
    </>
  );
}
