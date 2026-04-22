'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch } from '../../lib/api';

interface MerchantRow {
  id: string;
  name: string;
  slug: string;
  email: string | null;
  phone: string | null;
  category: string;
  country: string | null;
  createdAt: string;
  bookings30d: number;
  revenue30d: string;
  lastBookingAt: string | null;
}

interface ListResponse {
  merchants: MerchantRow[];
  total: number;
  limit: number;
  offset: number;
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-SG', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function SuperMerchantsPage() {
  const router = useRouter();
  const [rows, setRows] = useState<MerchantRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [searchDebounced, setSearchDebounced] = useState('');
  const [impersonatingId, setImpersonatingId] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setSearchDebounced(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    setLoading(true);
    setError('');
    const qs = new URLSearchParams({ limit: '100' });
    if (searchDebounced) qs.set('search', searchDebounced);
    apiFetch(`/super/merchants?${qs.toString()}`)
      .then((d: ListResponse) => {
        setRows(d.merchants);
        setTotal(d.total);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }, [searchDebounced]);

  async function handleImpersonate(m: MerchantRow) {
    setImpersonatingId(m.id);
    try {
      const data = await apiFetch('/super/impersonate', {
        method: 'POST',
        body: JSON.stringify({ merchant_id: m.id }),
      });
      localStorage.setItem('access_token', data.access_token);
      localStorage.setItem('refresh_token', data.refresh_token);
      localStorage.setItem('merchant', JSON.stringify(data.merchant));
      localStorage.setItem('impersonating', 'true');
      localStorage.setItem('impersonatingMerchant', JSON.stringify(data.merchant));
      localStorage.setItem('actorEmail', data.actorEmail);
      router.push('/dashboard');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to impersonate');
      setImpersonatingId(null);
    }
  }

  return (
    <div>
      <div className="flex items-start justify-between mb-6 gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-tone-ink">Merchants</h1>
          <p className="text-sm text-grey-60 mt-0.5">{total.toLocaleString()} total. Click “View as” to impersonate.</p>
        </div>
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name, slug, email..."
          className="w-72 rounded-lg border border-grey-15 bg-tone-surface px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-tone-sage"
        />
      </div>

      {error && (
        <div className="mb-4 rounded-lg bg-semantic-danger/5 border border-semantic-danger/30 px-4 py-3 text-sm text-semantic-danger">
          {error}
        </div>
      )}

      <div className="bg-tone-surface rounded-xl border border-grey-15 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-grey-15 text-left">
              <th className="px-4 py-3 text-xs font-semibold text-grey-60 uppercase tracking-wider">Name</th>
              <th className="px-4 py-3 text-xs font-semibold text-grey-60 uppercase tracking-wider">Slug</th>
              <th className="px-4 py-3 text-xs font-semibold text-grey-60 uppercase tracking-wider">Contact</th>
              <th className="px-4 py-3 text-xs font-semibold text-grey-60 uppercase tracking-wider">Category</th>
              <th className="px-4 py-3 text-xs font-semibold text-grey-60 uppercase tracking-wider text-right">30d bookings</th>
              <th className="px-4 py-3 text-xs font-semibold text-grey-60 uppercase tracking-wider text-right">30d revenue</th>
              <th className="px-4 py-3 text-xs font-semibold text-grey-60 uppercase tracking-wider">Last booking</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {loading && rows.length === 0 ? (
              <tr><td colSpan={8} className="px-4 py-8 text-center text-grey-45 text-sm">Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={8} className="px-4 py-8 text-center text-grey-45 text-sm">No merchants found.</td></tr>
            ) : (
              rows.map((m) => (
                <tr key={m.id} className="border-b border-grey-5 hover:bg-grey-5 transition-colors">
                  <td className="px-4 py-3 font-medium text-tone-ink">{m.name}</td>
                  <td className="px-4 py-3 text-grey-75 font-mono text-xs">{m.slug}</td>
                  <td className="px-4 py-3 text-grey-75">
                    <div className="truncate max-w-[200px]">{m.email ?? '—'}</div>
                    <div className="text-xs text-grey-45">{m.phone ?? ''}</div>
                  </td>
                  <td className="px-4 py-3 text-grey-75 text-xs capitalize">{m.category.replace(/_/g, ' ')}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-tone-ink">{m.bookings30d.toLocaleString()}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-tone-ink">S${Number(m.revenue30d).toFixed(2)}</td>
                  <td className="px-4 py-3 text-xs text-grey-60">{formatDate(m.lastBookingAt)}</td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => handleImpersonate(m)}
                      disabled={impersonatingId === m.id}
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-tone-ink text-tone-surface hover:opacity-90 disabled:opacity-50 transition-opacity"
                    >
                      {impersonatingId === m.id ? 'Opening…' : 'View as'}
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
