'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { BranchForm } from './components/BranchForm';

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
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [refetchKey, setRefetchKey] = useState(0);

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
  }, [from, to, refetchKey]);

  return (
    <div>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-tone-ink">Branches</h1>
          <p className="text-sm text-grey-60">Every location in your brand.</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
              className="text-xs border border-grey-20 rounded-lg px-2 py-1.5 text-grey-70 outline-none focus:ring-2 focus:ring-tone-sage" />
            <span className="text-xs text-grey-40">to</span>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
              className="text-xs border border-grey-20 rounded-lg px-2 py-1.5 text-grey-70 outline-none focus:ring-2 focus:ring-tone-sage" />
          </div>
          <button
            onClick={() => setCreateOpen(true)}
            className="bg-tone-ink text-tone-surface px-4 py-2 rounded-md text-sm font-medium hover:opacity-90"
          >
            + New branch
          </button>
        </div>
      </div>

      {error && <div className="mb-4 rounded-lg bg-semantic-danger/5 border border-semantic-danger/20 px-4 py-3 text-sm text-semantic-danger">{error}</div>}

      {loading ? (
        <div className="text-sm text-grey-60">Loading...</div>
      ) : (
        <div className="bg-tone-surface rounded-xl border border-grey-20 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-tone-surface-warm border-b border-grey-20">
              <tr>
                <th className="text-left px-4 py-3 font-semibold text-grey-70">Branch</th>
                <th className="text-left px-4 py-3 font-semibold text-grey-70 hidden sm:table-cell">Location</th>
                <th className="text-right px-4 py-3 font-semibold text-grey-70">Revenue</th>
                <th className="text-right px-4 py-3 font-semibold text-grey-70 hidden md:table-cell">Bookings</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-grey-10">
              {branches.map((b) => (
                <tr key={b.merchantId} className="hover:bg-tone-surface-warm transition-colors">
                  <td className="px-4 py-3 font-medium text-tone-ink">{b.name}</td>
                  <td className="px-4 py-3 text-grey-60 hidden sm:table-cell">{b.location || '—'}</td>
                  <td className="px-4 py-3 text-right font-semibold text-tone-ink">{fmtCurrency(b.revenue)}</td>
                  <td className="px-4 py-3 text-right text-grey-70 hidden md:table-cell">{b.bookingCount}</td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-3">
                      <button
                        onClick={() => setEditing(b.merchantId)}
                        className="text-sm text-tone-sage hover:text-tone-ink underline underline-offset-2"
                      >
                        Edit
                      </button>
                      <Link
                        href={`/dashboard/group/branches/${b.merchantId}?from=${from}&to=${to}`}
                        className="text-tone-sage hover:text-tone-ink text-xs font-medium"
                      >
                        View →
                      </Link>
                    </div>
                  </td>
                </tr>
              ))}
              {branches.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-grey-40 text-sm">No branches found.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {createOpen && (
        <BranchForm
          mode="create"
          onClose={() => setCreateOpen(false)}
          onSaved={() => {
            setCreateOpen(false);
            setRefetchKey((k) => k + 1);
          }}
        />
      )}
      {editing && (
        <BranchForm
          mode="edit"
          merchantId={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            setRefetchKey((k) => k + 1);
          }}
        />
      )}
    </div>
  );
}
