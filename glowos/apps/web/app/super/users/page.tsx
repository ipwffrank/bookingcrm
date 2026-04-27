'use client';

import { useEffect, useState } from 'react';
import { apiFetch, ApiError } from '../../lib/api';

interface UserRow {
  id: string;
  name: string | null;
  email: string;
  role: 'staff' | 'manager' | 'owner';
  isActive: boolean;
  brandAdminGroupId: string | null;
  lastLoginAt: string | null;
  createdAt: string;
  merchantId: string;
  merchantName: string | null;
  isSelf: boolean;
  isSuperAdmin: boolean;
  isDeleted: boolean;
}

type StatusFilter = 'all' | 'active' | 'inactive' | 'deleted';

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-SG', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function SuperUsersPage() {
  const [rows, setRows] = useState<UserRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [searchDebounced, setSearchDebounced] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<UserRow | null>(null);
  const [refetchKey, setRefetchKey] = useState(0);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setSearchDebounced(search), 250);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    setLoading(true);
    setError('');
    const qs = new URLSearchParams({ status, limit: '100' });
    if (searchDebounced) qs.set('search', searchDebounced);
    apiFetch(`/super/users?${qs}`)
      .then((d: { users: UserRow[]; total: number }) => {
        setRows(d.users);
        setTotal(d.total);
      })
      .catch((e: unknown) => {
        setError(e instanceof ApiError ? e.message ?? 'Failed to load users' : 'Failed to load users');
      })
      .finally(() => setLoading(false));
  }, [searchDebounced, status, refetchKey]);

  async function deactivate(u: UserRow) {
    setPendingId(u.id);
    try {
      await apiFetch(`/super/users/${u.id}/deactivate`, { method: 'PATCH' });
      setToast(`Deactivated ${u.email}`);
      setRefetchKey((k) => k + 1);
    } catch (e) {
      setToast(e instanceof ApiError ? e.message ?? 'Failed' : 'Failed');
    } finally {
      setPendingId(null);
    }
  }

  async function reactivate(u: UserRow) {
    setPendingId(u.id);
    try {
      await apiFetch(`/super/users/${u.id}/reactivate`, { method: 'PATCH' });
      setToast(`Reactivated ${u.email}`);
      setRefetchKey((k) => k + 1);
    } catch (e) {
      setToast(e instanceof ApiError ? e.message ?? 'Failed' : 'Failed');
    } finally {
      setPendingId(null);
    }
  }

  async function performDelete(u: UserRow) {
    setPendingId(u.id);
    try {
      await apiFetch(`/super/users/${u.id}`, { method: 'DELETE' });
      setToast(`Deleted ${u.email}`);
      setRefetchKey((k) => k + 1);
    } catch (e) {
      setToast(e instanceof ApiError ? e.message ?? 'Failed' : 'Failed');
    } finally {
      setPendingId(null);
      setConfirmDelete(null);
    }
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-tone-ink">Users</h1>
          <p className="text-sm text-grey-60">{total} total</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as StatusFilter)}
            className="border border-grey-20 rounded-md px-3 py-2 text-sm bg-tone-surface focus:outline-none focus:ring-2 focus:ring-tone-sage focus:border-tone-sage"
          >
            <option value="all">All</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="deleted">Deleted</option>
          </select>
          <input
            type="search"
            placeholder="Search email or name…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="border border-grey-20 rounded-md px-3 py-2 text-sm bg-tone-surface w-64 focus:outline-none focus:ring-2 focus:ring-tone-sage focus:border-tone-sage"
          />
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-lg bg-semantic-danger/5 border border-semantic-danger/30 px-4 py-3 text-sm text-semantic-danger">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-grey-60">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-grey-60">No users match.</p>
      ) : (
        <div className="bg-tone-surface rounded-lg border border-grey-20 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-tone-surface-warm border-b border-grey-20">
              <tr>
                <th className="text-left px-4 py-3 font-semibold text-grey-70">User</th>
                <th className="text-left px-4 py-3 font-semibold text-grey-70">Branch</th>
                <th className="text-left px-4 py-3 font-semibold text-grey-70">Role</th>
                <th className="text-left px-4 py-3 font-semibold text-grey-70">Status</th>
                <th className="text-left px-4 py-3 font-semibold text-grey-70">Last login</th>
                <th className="text-right px-4 py-3 font-semibold text-grey-70">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-grey-10">
              {rows.map((u) => (
                <tr key={u.id} className={u.isDeleted ? 'opacity-60' : ''}>
                  <td className="px-4 py-3">
                    <div className="text-tone-ink font-medium flex items-center gap-1.5 flex-wrap">
                      {u.name ?? <span className="text-grey-50">—</span>}
                      {u.isSelf && <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-tone-ink/5 text-tone-ink border border-tone-ink/20">You</span>}
                      {u.isSuperAdmin && <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-tone-ink text-tone-surface">Super</span>}
                      {u.brandAdminGroupId && !u.isDeleted && <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-tone-sage/10 text-tone-sage border border-tone-sage/30">Group admin</span>}
                    </div>
                    <div className="text-xs text-grey-60 mt-0.5 truncate">{u.email}</div>
                  </td>
                  <td className="px-4 py-3 text-grey-70">{u.merchantName ?? '—'}</td>
                  <td className="px-4 py-3 text-grey-70 capitalize">{u.role}</td>
                  <td className="px-4 py-3">
                    {u.isDeleted ? (
                      <span className="text-xs text-grey-60">Deleted</span>
                    ) : u.isActive ? (
                      <span className="text-xs text-tone-sage">Active</span>
                    ) : (
                      <span className="text-xs text-semantic-warn">Inactive</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-grey-70">{formatDate(u.lastLoginAt)}</td>
                  <td className="px-4 py-3 text-right">
                    {u.isDeleted ? (
                      <span className="text-xs text-grey-50">No actions</span>
                    ) : (
                      <span className="inline-flex items-center gap-3 flex-wrap justify-end">
                        {u.isActive ? (
                          <button
                            onClick={() => deactivate(u)}
                            disabled={pendingId === u.id || u.isSelf}
                            className="text-sm text-semantic-warn hover:opacity-80 underline underline-offset-2 disabled:opacity-30 disabled:cursor-not-allowed"
                            title={u.isSelf ? 'Cannot deactivate yourself' : ''}
                          >
                            Deactivate
                          </button>
                        ) : (
                          <button
                            onClick={() => reactivate(u)}
                            disabled={pendingId === u.id}
                            className="text-sm text-tone-sage hover:text-tone-ink underline underline-offset-2 disabled:opacity-30"
                          >
                            Reactivate
                          </button>
                        )}
                        <button
                          onClick={() => setConfirmDelete(u)}
                          disabled={pendingId === u.id || u.isSelf}
                          className="text-sm text-semantic-danger hover:opacity-80 underline underline-offset-2 disabled:opacity-30 disabled:cursor-not-allowed"
                          title={u.isSelf ? 'Cannot delete yourself' : ''}
                        >
                          Delete
                        </button>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-6 right-6 bg-tone-ink text-tone-surface px-4 py-2 rounded-md text-sm shadow-lg z-50">
          {toast}
        </div>
      )}

      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-tone-ink/30 px-4" role="dialog">
          <div className="bg-tone-surface rounded-lg w-full max-w-md p-6 border border-grey-20">
            <h2 className="text-lg font-semibold text-tone-ink mb-2">Delete user?</h2>
            <p className="text-sm text-grey-70 mb-3">
              Permanently anonymize <strong>{confirmDelete.email}</strong>. The account&apos;s email,
              name, and password will be scrubbed; the user can never log in again. This cannot
              be undone.
            </p>
            <p className="text-sm text-grey-60 mb-4">
              The row itself stays in the database (for audit-log + booking-history integrity), but
              all PII is replaced with <code className="text-xs">deleted-&lt;uuid&gt;@deleted.glowos.app</code>.
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmDelete(null)}
                className="px-4 py-2 text-sm text-grey-70 hover:text-tone-ink"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => performDelete(confirmDelete)}
                disabled={pendingId === confirmDelete.id}
                className="bg-semantic-danger text-tone-surface px-4 py-2 text-sm font-medium rounded-md hover:opacity-90 disabled:opacity-50"
              >
                {pendingId === confirmDelete.id ? 'Deleting…' : 'Permanently delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
