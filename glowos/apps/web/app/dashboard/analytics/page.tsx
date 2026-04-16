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
  if (change === null) return <span className="text-xs text-gray-400">No prev data</span>;

  const isPositive = change >= 0;
  return (
    <span
      className={`inline-flex items-center gap-0.5 text-xs font-medium ${
        isPositive ? 'text-green-600' : 'text-red-500'
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
    <div className="bg-white rounded-xl border border-gray-200 p-5 animate-pulse">
      <div className="h-3 bg-gray-200 rounded w-24 mb-3" />
      <div className="h-7 bg-gray-200 rounded w-32 mb-2" />
      <div className="h-3 bg-gray-200 rounded w-16" />
    </div>
  );
}

function SkeletonTable({ rows = 4 }: { rows?: number }) {
  return (
    <div className="animate-pulse space-y-3">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex gap-4">
          <div className="h-4 bg-gray-200 rounded flex-1" />
          <div className="h-4 bg-gray-200 rounded w-16" />
          <div className="h-4 bg-gray-200 rounded w-20" />
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
          className="flex-1 bg-gray-200 rounded-t"
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

  const cards = [
    {
      label: 'Total Bookings',
      value: data.total_bookings.toLocaleString(),
      change: data.total_bookings_change,
      accent: 'text-indigo-700 bg-indigo-50 border-indigo-100',
    },
    {
      label: 'Total Revenue',
      value: formatCurrency(data.total_revenue),
      change: data.total_revenue_change,
      accent: 'text-purple-700 bg-purple-50 border-purple-100',
    },
    {
      label: 'Active Clients',
      value: data.active_clients.toLocaleString(),
      change: null,
      accent: 'text-blue-700 bg-blue-50 border-blue-100',
    },
    {
      label: 'Avg Booking Value',
      value: formatCurrency(data.avg_booking_value),
      change: data.avg_booking_value_change,
      accent: 'text-violet-700 bg-violet-50 border-violet-100',
    },
    {
      label: 'New Clients',
      value: data.new_clients.toLocaleString(),
      change: data.new_clients_change,
      accent: 'text-fuchsia-700 bg-fuchsia-50 border-fuchsia-100',
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
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="h-5 bg-gray-200 rounded w-32 mb-6 animate-pulse" />
        <SkeletonChart />
      </div>
    );
  }

  if (!data || data.revenue.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-sm font-semibold text-gray-700 mb-4">Revenue Over Time</h2>
        <div className="flex items-center justify-center h-40 text-gray-400 text-sm">
          No revenue data for this period
        </div>
      </div>
    );
  }

  const points = data.revenue;
  const maxRevenue = Math.max(...points.map((p) => p.revenue), 1);

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      <h2 className="text-sm font-semibold text-gray-700 mb-4">Revenue Over Time</h2>
      <div className="relative">
        {/* Y-axis labels */}
        <div className="flex">
          <div className="flex flex-col justify-between text-xs text-gray-400 pr-2 h-40 text-right w-14 flex-shrink-0">
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
                        ? 'bg-indigo-600'
                        : point.revenue > 0
                        ? 'bg-indigo-400 hover:bg-indigo-500'
                        : 'bg-gray-100'
                    }`}
                    style={{ height: `${Math.max(heightPct, point.revenue > 0 ? 2 : 0)}%` }}
                  />
                  {/* Tooltip */}
                  {isHovered && (
                    <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 z-10 bg-gray-900 text-white text-xs rounded-lg px-2.5 py-1.5 whitespace-nowrap pointer-events-none shadow-lg">
                      <p className="font-medium">{formatDate(point.date)}</p>
                      <p>{formatCurrency(point.revenue)}</p>
                      <p className="text-gray-300">{point.bookings_count} bookings</p>
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
                  <span className="text-xs text-gray-400">{formatDate(point.date)}</span>
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
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      <h2 className="text-sm font-semibold text-gray-700 mb-4">Staff Performance</h2>
      {loading ? (
        <SkeletonTable rows={4} />
      ) : !data || data.staff_performance.length === 0 ? (
        <p className="text-sm text-gray-400 py-6 text-center">No staff data for this period</p>
      ) : (
        <div className="overflow-x-auto -mx-1">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="text-left text-xs font-medium text-gray-500 pb-2 pr-3">Staff</th>
                <th className="text-right text-xs font-medium text-gray-500 pb-2 px-3">Bookings</th>
                <th className="text-right text-xs font-medium text-gray-500 pb-2 px-3">Revenue</th>
                <th className="text-right text-xs font-medium text-gray-500 pb-2 pl-3">Avg Rating</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {data.staff_performance.map((row) => (
                <tr key={row.staff_id} className="hover:bg-gray-50 transition-colors">
                  <td className="py-2.5 pr-3 font-medium text-gray-900">{row.staff_name}</td>
                  <td className="py-2.5 px-3 text-right text-gray-600">{row.bookings_count}</td>
                  <td className="py-2.5 px-3 text-right text-gray-900 font-medium">
                    {formatCurrency(row.revenue)}
                  </td>
                  <td className="py-2.5 pl-3 text-right">
                    {row.avg_rating !== null ? (
                      <span className="inline-flex items-center gap-1 text-amber-600 font-medium">
                        <svg className="w-3.5 h-3.5 fill-amber-400" viewBox="0 0 20 20">
                          <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                        </svg>
                        {row.avg_rating.toFixed(1)}
                      </span>
                    ) : (
                      <span className="text-gray-300 text-xs">No reviews</span>
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
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      <h2 className="text-sm font-semibold text-gray-700 mb-4">Top Services</h2>
      {loading ? (
        <SkeletonTable rows={4} />
      ) : !data || data.top_services.length === 0 ? (
        <p className="text-sm text-gray-400 py-6 text-center">No service data for this period</p>
      ) : (
        <div className="overflow-x-auto -mx-1">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="text-left text-xs font-medium text-gray-500 pb-2 pr-3">Service</th>
                <th className="text-right text-xs font-medium text-gray-500 pb-2 px-3">Bookings</th>
                <th className="text-right text-xs font-medium text-gray-500 pb-2 pl-3">Revenue</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {data.top_services.map((row, i) => {
                const maxRevenue = data.top_services[0]?.revenue ?? 1;
                const pct = maxRevenue > 0 ? (row.revenue / maxRevenue) * 100 : 0;
                return (
                  <tr key={row.service_id} className="hover:bg-gray-50 transition-colors">
                    <td className="py-2.5 pr-3">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-400 w-4 flex-shrink-0">#{i + 1}</span>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-gray-900 truncate">{row.service_name}</p>
                          <div className="mt-0.5 h-1 bg-gray-100 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-indigo-400 rounded-full"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="py-2.5 px-3 text-right text-gray-600">{row.bookings_count}</td>
                    <td className="py-2.5 pl-3 text-right font-medium text-gray-900">
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
    google_reserve: 'bg-blue-500',
    direct_widget: 'bg-indigo-500',
    walkin_manual: 'bg-purple-500',
    instagram: 'bg-pink-500',
    facebook: 'bg-sky-500',
    phone: 'bg-teal-500',
    other: 'bg-gray-400',
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      <h2 className="text-sm font-semibold text-gray-700 mb-4">Booking Sources</h2>
      {loading ? (
        <div className="space-y-3 animate-pulse">
          {[80, 60, 40, 25].map((w, i) => (
            <div key={i} className="flex items-center gap-3">
              <div className="h-4 bg-gray-200 rounded w-28 flex-shrink-0" />
              <div className="flex-1 h-3 bg-gray-200 rounded-full" style={{ maxWidth: `${w}%` }} />
              <div className="h-4 bg-gray-200 rounded w-8" />
            </div>
          ))}
        </div>
      ) : !data || data.booking_sources.length === 0 ? (
        <p className="text-sm text-gray-400 py-6 text-center">No source data for this period</p>
      ) : (
        <div className="space-y-3">
          {(() => {
            const totalCount = data.booking_sources.reduce((s, r) => s + r.count, 0);
            return data.booking_sources.map((row) => {
              const pct = totalCount > 0 ? (row.count / totalCount) * 100 : 0;
              const colorClass = SOURCE_COLORS[row.source] ?? 'bg-gray-400';
              return (
                <div key={row.source} className="flex items-center gap-3">
                  <div className="w-28 flex-shrink-0 text-xs text-gray-600 font-medium truncate">
                    {formatSourceLabel(row.source)}
                  </div>
                  <div className="flex-1 bg-gray-100 rounded-full h-2.5 overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${colorClass}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <div className="flex-shrink-0 text-right w-16">
                    <span className="text-xs font-medium text-gray-700">{row.count}</span>
                    <span className="text-xs text-gray-400 ml-1">({pct.toFixed(0)}%)</span>
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
    { label: 'Completed',    value: data.completion_rate,   color: 'bg-emerald-400', count: data.completed },
    { label: 'Cancellations', value: data.cancellation_rate, color: 'bg-red-400',     count: data.cancelled },
    { label: 'No-shows',     value: data.no_show_rate,      color: 'bg-orange-400',  count: data.no_show },
  ] : [];

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      <h2 className="text-sm font-semibold text-gray-700 mb-4">Booking Outcomes</h2>
      {loading ? <SkeletonTable rows={3} /> : !data ? null : (
        <div className="space-y-3">
          <p className="text-xs text-gray-400 mb-3">{data.total} total bookings this period</p>
          {bars.map(({ label, value, color, count }) => (
            <div key={label} className="flex items-center gap-3">
              <div className="w-28 flex-shrink-0 text-xs font-medium text-gray-600">{label}</div>
              <div className="flex-1 bg-gray-100 rounded-full h-2.5 overflow-hidden">
                <div className={`h-full rounded-full ${color} transition-all`} style={{ width: `${value}%` }} />
              </div>
              <div className="w-20 text-right flex-shrink-0">
                <span className="text-xs font-semibold text-gray-800">{value}%</span>
                <span className="text-xs text-gray-400 ml-1">({count})</span>
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
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      <h2 className="text-sm font-semibold text-gray-700 mb-4">Client Retention</h2>
      {loading ? <SkeletonTable rows={2} /> : !data || total === 0 ? (
        <p className="text-sm text-gray-400 py-6 text-center">No client data for this period</p>
      ) : (
        <div className="space-y-4">
          <div className="flex rounded-xl overflow-hidden h-8">
            <div className="flex items-center justify-center text-xs font-semibold text-white bg-indigo-500 transition-all" style={{ width: `${newPct}%` }}>
              {newPct > 15 ? `New ${newPct}%` : ''}
            </div>
            <div className="flex items-center justify-center text-xs font-semibold text-white bg-violet-400 transition-all" style={{ width: `${returnPct}%` }}>
              {returnPct > 15 ? `Return ${returnPct}%` : ''}
            </div>
          </div>
          <div className="flex gap-6">
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-indigo-500 flex-shrink-0" />
              <div>
                <p className="text-base font-bold text-gray-900">{data.new_clients}</p>
                <p className="text-xs text-gray-400">New clients ({newPct}%)</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-violet-400 flex-shrink-0" />
              <div>
                <p className="text-base font-bold text-gray-900">{data.returning_clients}</p>
                <p className="text-xs text-gray-400">Returning ({returnPct}%)</p>
              </div>
            </div>
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
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      <h2 className="text-sm font-semibold text-gray-700 mb-4">Revenue by Day of Week</h2>
      {loading ? <SkeletonChart /> : !data ? null : (
        <div className="flex items-end gap-2 h-40">
          {data.revenue_by_dow.map(row => {
            const pct = maxRev > 0 ? (row.revenue / maxRev) * 100 : 0;
            return (
              <div key={row.dow} className="flex-1 flex flex-col items-center gap-1 group relative h-full justify-end">
                <div
                  className="w-full rounded-t bg-purple-400 hover:bg-purple-500 transition-colors cursor-default relative"
                  style={{ height: `${Math.max(pct, row.revenue > 0 ? 4 : 0)}%` }}
                >
                  {/* Tooltip */}
                  <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 z-10 bg-gray-900 text-white text-xs rounded-lg px-2 py-1.5 whitespace-nowrap pointer-events-none shadow-lg opacity-0 group-hover:opacity-100 transition-opacity">
                    <p className="font-medium">{row.label}</p>
                    <p>S${row.revenue.toFixed(0)}</p>
                    <p className="text-gray-300">{row.count} bookings</p>
                  </div>
                </div>
                <span className="text-[10px] text-gray-400">{row.label}</span>
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
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      <h2 className="text-sm font-semibold text-gray-700 mb-4">Peak Hours</h2>
      {loading ? (
        <div className="animate-pulse h-40 bg-gray-100 rounded-lg" />
      ) : !data || data.peak_hours.length === 0 ? (
        <p className="text-sm text-gray-400 py-6 text-center">No data for this period</p>
      ) : (
        <div className="overflow-x-auto">
          <div className="min-w-[460px]">
            {/* Day headers */}
            <div className="flex mb-1 pl-10">
              {DOW.map(d => (
                <div key={d} className="flex-1 text-center text-[10px] font-semibold text-gray-400">{d}</div>
              ))}
            </div>
            {/* Hour rows */}
            {HOURS.map(hour => (
              <div key={hour} className="flex items-center mb-0.5">
                <div className="w-10 text-[10px] text-gray-400 text-right pr-2 flex-shrink-0">
                  {hour < 12 ? `${hour}am` : hour === 12 ? '12pm' : `${hour - 12}pm`}
                </div>
                {DOW.map((_, dow) => {
                  const count = countAt(dow, hour);
                  return (
                    <div key={dow} className="flex-1 mx-0.5 relative group">
                      <div
                        className="h-6 rounded-sm transition-all"
                        style={{ backgroundColor: `rgba(99, 102, 241, ${opacity(count)})`, minHeight: 8 }}
                      />
                      {count > 0 && (
                        <div className="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 z-10 bg-gray-900 text-white text-[10px] rounded px-1.5 py-1 whitespace-nowrap pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity shadow-lg">
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
              <span className="text-[10px] text-gray-400">Less</span>
              {[0.1, 0.3, 0.5, 0.7, 0.95].map(o => (
                <div key={o} className="w-4 h-4 rounded-sm" style={{ backgroundColor: `rgba(99,102,241,${o})` }} />
              ))}
              <span className="text-[10px] text-gray-400">More</span>
            </div>
          </div>
        </div>
      )}
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
    <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={`flex-1 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
            period === opt.value
              ? 'bg-white text-indigo-700 shadow-sm'
              : 'text-gray-500 hover:text-gray-700'
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
  const [revDowData, setRevDowData]             = useState<RevByDowData | null>(null);

  const [loadingSummary, setLoadingSummary]     = useState(true);
  const [loadingRevenue, setLoadingRevenue]     = useState(true);
  const [loadingStaff, setLoadingStaff]         = useState(true);
  const [loadingServices, setLoadingServices]   = useState(true);
  const [loadingSources, setLoadingSources]     = useState(true);
  const [loadingCancel, setLoadingCancel]       = useState(true);
  const [loadingPeak, setLoadingPeak]           = useState(true);
  const [loadingRetention, setLoadingRetention] = useState(true);
  const [loadingRevDow, setLoadingRevDow]       = useState(true);

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
          const data = await apiFetch(`/merchant/analytics/revenue-by-dow?period=${p}`, { headers }) as RevByDowData;
          setRevDowData(data);
        } catch (e) { handleError(e); } finally { setLoadingRevDow(false); }
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
          <h1 className="text-2xl font-bold text-gray-900">Analytics</h1>
          <p className="text-sm text-gray-500 mt-0.5">Business performance overview</p>
        </div>
        <div className="sm:w-72">
          <PeriodSelector period={period} onChange={handlePeriodChange} />
        </div>
      </div>

      {error && (
        <div className="mb-6 rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-600 flex items-center justify-between">
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

      {/* Revenue by Day of Week */}
      <div className="mb-6">
        <RevByDow data={revDowData} loading={loadingRevDow} />
      </div>

      {/* Peak Hours Heatmap */}
      <div className="mb-6">
        <PeakHoursHeatmap data={peakData} loading={loadingPeak} />
      </div>
    </>
  );
}
