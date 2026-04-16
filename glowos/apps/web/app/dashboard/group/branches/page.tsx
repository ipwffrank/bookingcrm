'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface Branch {
  merchantId: string;
  name: string;
  location: string;
  category: string;
  revenue: number;
  bookingCount: number;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

function fmtCurrency(n: number) {
  return `$${n.toLocaleString('en-SG', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

export default function BranchesPage() {
  const now = new Date();
  const [from, setFrom] = useState(new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10));
  const [to, setTo] = useState(now.toISOString().slice(0, 10));
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const token = localStorage.getItem('access_token');
    if (!token) return;
    setLoading(true);
    fetch(`${API_URL}/group/branches?from=${from}&to=${to}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then((d: { branches: Branch[] }) => setBranches(d.branches))
      .catch(() => setError('Failed to load branches'))
      .finally(() => setLoading(false));
  }, [from, to]);

  return (
    <div>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <h1 className="text-2xl font-bold text-gray-900">Branches</h1>
        <div className="flex items-center gap-2">
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
            className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 text-gray-700 outline-none focus:ring-2 focus:ring-indigo-500" />
          <span className="text-xs text-gray-400">to</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
            className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 text-gray-700 outline-none focus:ring-2 focus:ring-indigo-500" />
        </div>
      </div>

      {error && <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-600">{error}</div>}

      {loading ? (
        <div className="text-sm text-gray-500">Loading...</div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Branch</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600 hidden sm:table-cell">Location</th>
                <th className="text-right px-4 py-3 font-semibold text-gray-600">Revenue</th>
                <th className="text-right px-4 py-3 font-semibold text-gray-600 hidden md:table-cell">Bookings</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {branches.map((b) => (
                <tr key={b.merchantId} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3 font-medium text-gray-800">{b.name}</td>
                  <td className="px-4 py-3 text-gray-500 hidden sm:table-cell">{b.location || '—'}</td>
                  <td className="px-4 py-3 text-right font-semibold text-green-600">{fmtCurrency(b.revenue)}</td>
                  <td className="px-4 py-3 text-right text-gray-600 hidden md:table-cell">{b.bookingCount}</td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/dashboard/group/branches/${b.merchantId}?from=${from}&to=${to}`}
                      className="text-indigo-600 hover:text-indigo-800 text-xs font-medium"
                    >
                      View →
                    </Link>
                  </td>
                </tr>
              ))}
              {branches.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400 text-sm">No branches found.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
