'use client';

import { useEffect, useState, useCallback } from 'react';

interface GroupClient {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  totalSpend: number;
  branchCount: number;
  lastVisit: string | null;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

function fmtCurrency(n: number) {
  return `$${n.toLocaleString('en-SG', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

export default function GroupClientsPage() {
  const [clients, setClients] = useState<GroupClient[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const limit = 20;

  const fetchClients = useCallback(() => {
    const token = localStorage.getItem('access_token');
    if (!token) return;
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), limit: String(limit) });
    if (search) params.set('search', search);
    fetch(`${API_URL}/group/clients?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then((d: { clients: GroupClient[]; total: number }) => {
        setClients(d.clients);
        setTotal(d.total);
      })
      .catch(() => setError('Failed to load clients'))
      .finally(() => setLoading(false));
  }, [page, search]);

  useEffect(() => { fetchClients(); }, [fetchClients]);

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    setPage(1);
    setSearch(searchInput.trim());
  }

  const totalPages = Math.ceil(total / limit);

  return (
    <div>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <h1 className="text-2xl font-bold text-tone-ink">Clients <span className="text-grey-40 text-lg font-normal">({total.toLocaleString()})</span></h1>
        <form onSubmit={handleSearch} className="flex gap-2">
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search name or phone..."
            className="text-sm border border-grey-20 rounded-lg px-3 py-1.5 text-tone-ink outline-none focus:ring-2 focus:ring-tone-sage w-48"
          />
          <button type="submit" className="px-3 py-1.5 bg-tone-ink text-tone-surface text-sm rounded-lg hover:opacity-90 transition-opacity">Search</button>
          {search && (
            <button type="button" onClick={() => { setSearch(''); setSearchInput(''); setPage(1); }}
              className="px-3 py-1.5 bg-tone-surface border border-grey-20 text-grey-70 text-sm rounded-lg hover:bg-tone-surface-warm transition-colors">Clear</button>
          )}
        </form>
      </div>

      {error && <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-600">{error}</div>}

      {loading ? (
        <div className="text-sm text-grey-60">Loading...</div>
      ) : (
        <>
          <div className="bg-tone-surface rounded-xl border border-grey-20 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-tone-surface-warm border-b border-grey-20">
                <tr>
                  <th className="text-left px-4 py-3 font-semibold text-grey-70">Client</th>
                  <th className="text-left px-4 py-3 font-semibold text-grey-70 hidden sm:table-cell">Phone</th>
                  <th className="text-right px-4 py-3 font-semibold text-grey-70">Total Spend</th>
                  <th className="text-center px-4 py-3 font-semibold text-grey-70 hidden md:table-cell">Branches</th>
                  <th className="text-right px-4 py-3 font-semibold text-grey-70 hidden lg:table-cell">Last Visit</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-grey-20">
                {clients.map((cl) => (
                  <tr key={cl.id} className="hover:bg-tone-surface-warm transition-colors">
                    <td className="px-4 py-3">
                      <p className="font-medium text-tone-ink">{cl.name}</p>
                      {cl.email && <p className="text-xs text-grey-40">{cl.email}</p>}
                    </td>
                    <td className="px-4 py-3 text-grey-60 hidden sm:table-cell">{cl.phone}</td>
                    <td className="px-4 py-3 text-right font-semibold text-tone-sage">{fmtCurrency(cl.totalSpend)}</td>
                    <td className="px-4 py-3 text-center hidden md:table-cell">
                      {cl.branchCount > 1 ? (
                        <span className="state-active text-xs font-medium">{cl.branchCount} branches</span>
                      ) : (
                        <span className="text-grey-40 text-xs">1</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right text-grey-60 hidden lg:table-cell text-xs">
                      {cl.lastVisit ? new Date(cl.lastVisit).toLocaleDateString('en-SG') : '—'}
                    </td>
                  </tr>
                ))}
                {clients.length === 0 && (
                  <tr><td colSpan={5} className="px-4 py-8 text-center text-grey-40 text-sm">No clients found.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-4">
              <p className="text-sm text-grey-60">Page {page} of {totalPages}</p>
              <div className="flex gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="px-3 py-1.5 text-sm border border-grey-20 rounded-lg disabled:opacity-40 hover:bg-tone-surface-warm transition-colors"
                >Previous</button>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="px-3 py-1.5 text-sm border border-grey-20 rounded-lg disabled:opacity-40 hover:bg-tone-surface-warm transition-colors"
                >Next</button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
