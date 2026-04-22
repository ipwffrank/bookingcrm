'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '../../lib/api';

type Period = 'today' | '7d' | '30d' | '90d' | 'all';

interface Row {
  staffId: string;
  staffName: string;
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

export function StaffContributionCard() {
  const [period, setPeriod] = useState<Period>('today');
  const [rows, setRows] = useState<Row[]>([]);

  useEffect(() => {
    const token = localStorage.getItem('access_token');
    apiFetch(`/merchant/analytics/staff-contribution?period=${period}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((d) => {
        const res = d as { rows: Row[] };
        setRows(res.rows ?? []);
      })
      .catch(() => setRows([]));
  }, [period]);

  return (
    <div className="mb-4 bg-tone-surface rounded-xl border border-grey-15 p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-tone-ink">Staff Contribution</h2>
        <div className="flex gap-1">
          {(Object.keys(PERIOD_LABEL) as Period[]).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPeriod(p)}
              className={`px-2 py-0.5 text-[10px] font-medium rounded-full border ${
                period === p
                  ? 'bg-tone-ink text-white border-tone-ink'
                  : 'bg-tone-surface text-grey-75 border-grey-15 hover:bg-grey-5'
              }`}
            >
              {PERIOD_LABEL[p]}
            </button>
          ))}
        </div>
      </div>
      {rows.length === 0 ? (
        <p className="text-xs text-grey-45 italic">No active staff yet.</p>
      ) : (
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-grey-60 border-b border-grey-5">
              <th className="py-1 font-medium">Staff</th>
              <th className="py-1 font-medium text-right">Services</th>
              <th className="py-1 font-medium text-right">Packages</th>
              <th className="py-1 font-medium text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.staffId} className="border-b border-grey-5 last:border-0">
                <td className="py-1.5 text-tone-ink">{r.staffName}</td>
                <td className="py-1.5 text-right tabular-nums text-grey-75">S${Number(r.servicesDelivered).toFixed(2)}</td>
                <td className="py-1.5 text-right tabular-nums text-grey-75">S${Number(r.packagesSold).toFixed(2)}</td>
                <td className="py-1.5 text-right tabular-nums font-semibold text-tone-ink">S${Number(r.total).toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
