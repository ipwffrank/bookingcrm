'use client';

import { useEffect, useState, Suspense } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import Link from 'next/link';

interface BranchDetail {
  merchant: { id: string; name: string; location: string };
  revenue: number;
  bookingCount: number;
  activeClients: number;
  recentBookings: { id: string; startTime: string; status: string; priceSgd: string }[];
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

function fmtCurrency(n: number) {
  return `$${n.toLocaleString('en-SG', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function BranchDetailInner() {
  const params = useParams();
  const searchParams = useSearchParams();
  const merchantId = params.merchantId as string;
  const from = searchParams.get('from') ?? new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10);
  const to = searchParams.get('to') ?? new Date().toISOString().slice(0, 10);

  const [data, setData] = useState<BranchDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const token = localStorage.getItem('access_token');
    if (!token) return;
    setLoading(true);
    fetch(`${API_URL}/group/branches/${merchantId}?from=${from}&to=${to}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => { if (!r.ok) throw new Error('Not found'); return r.json(); })
      .then((d) => setData(d as BranchDetail))
      .catch(() => setError('Failed to load branch data'))
      .finally(() => setLoading(false));
  }, [merchantId, from, to]);

  return (
    <div>
      <div className="mb-6">
        <Link href="/dashboard/group/branches" className="text-sm text-indigo-600 hover:text-indigo-800">← All Branches</Link>
        <h1 className="text-2xl font-bold text-gray-900 mt-2">{data?.merchant.name ?? 'Branch Detail'}</h1>
        {data?.merchant.location && <p className="text-sm text-gray-500 mt-0.5">{data.merchant.location}</p>}
      </div>

      {error && <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-600">{error}</div>}

      {loading ? (
        <div className="text-sm text-gray-500">Loading...</div>
      ) : data ? (
        <div className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Revenue</p>
              <p className="text-3xl font-bold text-green-600 mt-1">{fmtCurrency(data.revenue)}</p>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Bookings</p>
              <p className="text-3xl font-bold text-blue-600 mt-1">{data.bookingCount}</p>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Active Clients</p>
              <p className="text-3xl font-bold text-purple-600 mt-1">{data.activeClients}</p>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100">
              <h2 className="text-sm font-semibold text-gray-700">Recent Bookings</h2>
            </div>
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600">Date</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600">Status</th>
                  <th className="text-right px-4 py-3 font-semibold text-gray-600">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {data.recentBookings.map((b) => (
                  <tr key={b.id}>
                    <td className="px-4 py-3 text-gray-700">{new Date(b.startTime).toLocaleDateString('en-SG')}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
                        b.status === 'completed' ? 'bg-green-100 text-green-700' :
                        b.status === 'confirmed' ? 'bg-blue-100 text-blue-700' :
                        'bg-gray-100 text-gray-600'
                      }`}>{b.status}</span>
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-gray-700">{fmtCurrency(parseFloat(b.priceSgd))}</td>
                  </tr>
                ))}
                {data.recentBookings.length === 0 && (
                  <tr><td colSpan={3} className="px-4 py-6 text-center text-gray-400 text-sm">No bookings in this period.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default function BranchDetailPage() {
  return (
    <Suspense fallback={<div className="text-sm text-gray-500 px-8 py-6">Loading...</div>}>
      <BranchDetailInner />
    </Suspense>
  );
}
