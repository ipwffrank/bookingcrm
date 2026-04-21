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
    <div className="mb-4 bg-white rounded-xl border border-gray-200 p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-gray-900">Staff Contribution</h2>
        <div className="flex gap-1">
          {(Object.keys(PERIOD_LABEL) as Period[]).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPeriod(p)}
              className={`px-2 py-0.5 text-[10px] font-medium rounded-full border ${
                period === p
                  ? 'bg-indigo-600 text-white border-indigo-600'
                  : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
              }`}
            >
              {PERIOD_LABEL[p]}
            </button>
          ))}
        </div>
      </div>
      {rows.length === 0 ? (
        <p className="text-xs text-gray-400 italic">No active staff yet.</p>
      ) : (
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-gray-500 border-b border-gray-100">
              <th className="py-1 font-medium">Staff</th>
              <th className="py-1 font-medium text-right">Services</th>
              <th className="py-1 font-medium text-right">Packages</th>
              <th className="py-1 font-medium text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.staffId} className="border-b border-gray-50 last:border-0">
                <td className="py-1.5 text-gray-900">{r.staffName}</td>
                <td className="py-1.5 text-right tabular-nums text-gray-700">S${Number(r.servicesDelivered).toFixed(2)}</td>
                <td className="py-1.5 text-right tabular-nums text-gray-700">S${Number(r.packagesSold).toFixed(2)}</td>
                <td className="py-1.5 text-right tabular-nums font-semibold text-gray-900">S${Number(r.total).toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
