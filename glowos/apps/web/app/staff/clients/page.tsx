'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { apiFetch, ApiError } from '../../lib/api';

interface ClientRow {
  profile: { id: string; vipTier: string | null; totalVisits?: number; totalSpendSgd?: string; lastVisitAt?: string | null };
  client: { id: string; name: string; phone: string; email: string | null };
}

export default function StaffClientsPage() {
  const router = useRouter();
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  const fetchClients = useCallback(async () => {
    try {
      const params = new URLSearchParams({ limit: '50' });
      if (search) params.set('search', search);
      const data = await apiFetch(`/merchant/clients?${params.toString()}`) as { clients: ClientRow[] };
      setClients(data.clients ?? []);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) router.push('/login');
    } finally {
      setLoading(false);
    }
  }, [search, router]);

  useEffect(() => {
    const token = localStorage.getItem('access_token');
    if (!token) { router.push('/login'); return; }
    const timer = setTimeout(fetchClients, 300);
    return () => clearTimeout(timer);
  }, [fetchClients, router]);

  return (
    <div className="space-y-4 font-manrope">
      <h1 className="text-xl font-semibold text-tone-ink">Clients</h1>

      <input
        type="text"
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder="Search by name, phone, or email..."
        className="w-full border border-grey-15 rounded-lg px-4 py-2.5 text-sm text-tone-ink placeholder-grey-45 focus:outline-none focus:ring-1 focus:ring-tone-ink/30"
      />

      {loading ? (
        <div className="text-sm text-grey-45 animate-pulse py-8 text-center">Loading...</div>
      ) : clients.length === 0 ? (
        <div className="text-sm text-grey-45 py-8 text-center">No clients found.</div>
      ) : (
        <div className="space-y-2">
          {clients.map(row => (
            <Link
              key={row.profile.id}
              href={`/staff/clients/${row.profile.id}`}
              className="flex items-center justify-between bg-tone-surface border border-grey-15 rounded-xl px-4 py-3 hover:bg-grey-5 transition-colors"
            >
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-tone-sage/15 flex items-center justify-center text-tone-sage font-semibold text-xs">
                  {(row.client.name ?? '?')[0].toUpperCase()}
                </div>
                <div>
                  <p className="text-sm font-medium text-tone-ink">{row.client.name}</p>
                  <p className="text-xs text-grey-45">{row.client.phone}</p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-xs text-grey-60">{row.profile.totalVisits ?? 0} visits</p>
                {row.profile.vipTier && (
                  <span className="text-[10px] font-medium text-grey-75 capitalize">{row.profile.vipTier}</span>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
