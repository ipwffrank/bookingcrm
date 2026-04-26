'use client';

import { useEffect, useState } from 'react';
import { apiFetch, ApiError } from '../../../lib/api';

interface Admin {
  userId: string;
  name: string | null;
  email: string;
  homeMerchantId: string;
  homeMerchantName: string;
  isSelf: boolean;
}

interface Invite {
  id: string;
  inviteeEmail: string;
  token: string;
  expiresAt: string;
  createdAt: string;
  acceptedAt: string | null;
  canceledAt: string | null;
  createdByName: string | null;
  createdByEmail: string | null;
  status: 'outstanding' | 'accepted' | 'canceled' | 'expired';
  shareUrl: string;
}

function relativeExpiry(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return 'expired';
  const days = Math.floor(ms / (24 * 60 * 60 * 1000));
  if (days >= 1) return `in ${days} day${days === 1 ? '' : 's'}`;
  const hours = Math.floor(ms / (60 * 60 * 1000));
  return `in ${hours} hour${hours === 1 ? '' : 's'}`;
}

export default function GroupAdminsPage() {
  const [admins, setAdmins] = useState<Admin[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [loading, setLoading] = useState(true);
  const [refetchKey, setRefetchKey] = useState(0);
  const [addOpen, setAddOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [confirmingRemoval, setConfirmingRemoval] = useState<string | null>(null);
  const [confirmingCancel, setConfirmingCancel] = useState<string | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setPageError(null);
    Promise.all([
      apiFetch('/group/admins') as Promise<{ admins: Admin[] }>,
      apiFetch('/group/invites?status=outstanding') as Promise<{ invites: Invite[] }>,
    ])
      .then(([a, i]) => {
        setAdmins(a.admins);
        setInvites(i.invites);
      })
      .catch((e: unknown) => {
        if (e instanceof ApiError) setPageError(e.message ?? 'Failed to load brand admins');
        else setPageError('Failed to load brand admins');
      })
      .finally(() => setLoading(false));
  }, [refetchKey]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  async function remove(userId: string) {
    try {
      await apiFetch(`/group/admins/${userId}`, { method: 'DELETE' });
      setConfirmingRemoval(null);
      setRefetchKey((k) => k + 1);
    } catch (e) {
      setPageError(e instanceof ApiError ? e.message ?? 'Failed to remove brand admin' : 'Failed to remove brand admin');
      setConfirmingRemoval(null);
    }
  }

  async function cancelInvite(id: string) {
    try {
      await apiFetch(`/group/invites/${id}`, { method: 'DELETE' });
      setConfirmingCancel(null);
      setRefetchKey((k) => k + 1);
    } catch (e) {
      setPageError(e instanceof ApiError ? e.message ?? 'Failed to cancel invite' : 'Failed to cancel invite');
      setConfirmingCancel(null);
    }
  }

  async function copyShareUrl(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setToast('Invite link copied to clipboard');
    } catch {
      setToast('Could not copy — please copy manually');
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-tone-ink">Brand admins</h1>
          <p className="text-sm text-grey-60">Anyone here can manage every branch in this brand.</p>
        </div>
        <button
          onClick={() => setAddOpen(true)}
          className="bg-tone-ink text-tone-surface px-4 py-2 rounded-md text-sm font-medium hover:opacity-90"
        >
          + Add admin
        </button>
      </div>

      {pageError && (
        <div className="mb-4 rounded-lg bg-semantic-danger/5 border border-semantic-danger/30 px-4 py-3 text-sm text-semantic-danger">
          {pageError}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-grey-60">Loading…</p>
      ) : admins.length === 0 ? (
        <p className="text-sm text-grey-60">No brand admins yet.</p>
      ) : (
        <div className="bg-tone-surface rounded-lg border border-grey-20 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-tone-surface-warm border-b border-grey-20">
              <tr>
                <th className="text-left px-4 py-3 font-semibold text-grey-70">Name</th>
                <th className="text-left px-4 py-3 font-semibold text-grey-70">Email</th>
                <th className="text-left px-4 py-3 font-semibold text-grey-70">Home branch</th>
                <th className="text-right px-4 py-3 font-semibold text-grey-70">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-grey-10">
              {admins.map((a) => (
                <tr key={a.userId}>
                  <td className="px-4 py-3 text-tone-ink">
                    {a.name ?? <span className="text-grey-50">—</span>}
                    {a.isSelf && <span className="ml-2 text-xs text-grey-50">(you)</span>}
                  </td>
                  <td className="px-4 py-3 text-grey-70">{a.email}</td>
                  <td className="px-4 py-3 text-grey-70">{a.homeMerchantName}</td>
                  <td className="px-4 py-3 text-right">
                    {confirmingRemoval === a.userId ? (
                      <span className="inline-flex items-center gap-2">
                        <span className="text-xs text-grey-60">Remove?</span>
                        <button
                          onClick={() => remove(a.userId)}
                          className="text-sm text-semantic-danger hover:opacity-80 font-medium"
                        >
                          Yes
                        </button>
                        <button
                          onClick={() => setConfirmingRemoval(null)}
                          className="text-sm text-grey-60 hover:text-tone-ink"
                        >
                          Cancel
                        </button>
                      </span>
                    ) : (
                      <button
                        onClick={() => setConfirmingRemoval(a.userId)}
                        className="text-sm text-tone-sage hover:text-tone-ink underline underline-offset-2"
                      >
                        Remove
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-10 mb-3 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-tone-ink">Invite a brand owner</h2>
          <p className="text-sm text-grey-60">Send a one-time link. Acceptance moves their branch into this brand and makes them a co-admin.</p>
        </div>
        <button
          onClick={() => setInviteOpen(true)}
          className="bg-tone-surface text-tone-ink border border-grey-20 px-4 py-2 rounded-md text-sm font-medium hover:bg-tone-surface-warm"
        >
          + Generate invite link
        </button>
      </div>

      {invites.length === 0 ? (
        <p className="text-sm text-grey-60">No outstanding invites.</p>
      ) : (
        <div className="bg-tone-surface rounded-lg border border-grey-20 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-tone-surface-warm border-b border-grey-20">
              <tr>
                <th className="text-left px-4 py-3 font-semibold text-grey-70">Invitee email</th>
                <th className="text-left px-4 py-3 font-semibold text-grey-70">Expires</th>
                <th className="text-left px-4 py-3 font-semibold text-grey-70">Sent by</th>
                <th className="text-right px-4 py-3 font-semibold text-grey-70">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-grey-10">
              {invites.map((iv) => (
                <tr key={iv.id}>
                  <td className="px-4 py-3 text-tone-ink">{iv.inviteeEmail}</td>
                  <td className="px-4 py-3 text-grey-70">{relativeExpiry(iv.expiresAt)}</td>
                  <td className="px-4 py-3 text-grey-70">{iv.createdByName ?? iv.createdByEmail ?? '—'}</td>
                  <td className="px-4 py-3 text-right">
                    {confirmingCancel === iv.id ? (
                      <span className="inline-flex items-center gap-2">
                        <span className="text-xs text-grey-60">Cancel?</span>
                        <button
                          onClick={() => cancelInvite(iv.id)}
                          className="text-sm text-semantic-danger hover:opacity-80 font-medium"
                        >
                          Yes
                        </button>
                        <button
                          onClick={() => setConfirmingCancel(null)}
                          className="text-sm text-grey-60 hover:text-tone-ink"
                        >
                          Keep
                        </button>
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-3">
                        <button
                          onClick={() => copyShareUrl(iv.shareUrl)}
                          className="text-sm text-tone-sage hover:text-tone-ink underline underline-offset-2"
                        >
                          Copy link
                        </button>
                        <button
                          onClick={() => setConfirmingCancel(iv.id)}
                          className="text-sm text-grey-60 hover:text-tone-ink underline underline-offset-2"
                        >
                          Cancel
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

      {addOpen && (
        <AddAdminModal
          onClose={() => setAddOpen(false)}
          onAdded={() => {
            setAddOpen(false);
            setRefetchKey((k) => k + 1);
          }}
        />
      )}
      {inviteOpen && (
        <CreateInviteModal
          onClose={() => setInviteOpen(false)}
          onCreated={(url) => {
            setInviteOpen(false);
            copyShareUrl(url);
            setRefetchKey((k) => k + 1);
          }}
        />
      )}
    </div>
  );
}

function CreateInviteModal({ onClose, onCreated }: { onClose: () => void; onCreated: (url: string) => void }) {
  const [email, setEmail] = useState('');
  const [expiresInDays, setExpiresInDays] = useState(7);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = (await apiFetch('/group/invites', {
        method: 'POST',
        body: JSON.stringify({ email: email.trim().toLowerCase(), expiresInDays }),
      })) as { invite: { shareUrl: string } };
      onCreated(res.invite.shareUrl);
    } catch (e) {
      setError(e instanceof ApiError ? e.message ?? 'Failed to create invite' : 'Failed to create invite');
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-tone-ink/30 px-4" role="dialog">
      <div className="bg-tone-surface rounded-lg w-full max-w-md p-6 border border-grey-20">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-tone-ink">Generate invite link</h2>
          <button onClick={onClose} className="text-grey-50 hover:text-tone-ink">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <p className="text-sm text-grey-60 mb-4">
          One-time, email-bound link. Share via WhatsApp / email / however you prefer. The recipient must already have a GlowOS account with the same email.
        </p>
        <form onSubmit={submit} className="space-y-4">
          <label className="block">
            <span className="block text-xs uppercase tracking-wide text-grey-60 mb-1">Recipient email</span>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoFocus
              className="w-full border border-grey-20 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-tone-sage focus:border-tone-sage"
            />
          </label>
          <label className="block">
            <span className="block text-xs uppercase tracking-wide text-grey-60 mb-1">Expires in</span>
            <select
              value={expiresInDays}
              onChange={(e) => setExpiresInDays(Number(e.target.value))}
              className="w-full border border-grey-20 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-tone-sage focus:border-tone-sage"
            >
              <option value={1}>1 day</option>
              <option value={3}>3 days</option>
              <option value={7}>7 days</option>
              <option value={14}>14 days</option>
              <option value={30}>30 days</option>
            </select>
          </label>
          {error && <p className="text-sm text-semantic-danger">{error}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-grey-70 hover:text-tone-ink">
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || !email.trim()}
              className="bg-tone-ink text-tone-surface px-4 py-2 text-sm font-medium rounded-md hover:opacity-90 disabled:opacity-50"
            >
              {submitting ? 'Generating…' : 'Generate & copy link'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function AddAdminModal({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await apiFetch('/group/admins', {
        method: 'POST',
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      });
      onAdded();
    } catch (e) {
      setError(e instanceof ApiError ? e.message ?? 'Failed to add brand admin' : 'Failed to add brand admin');
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-tone-ink/30 px-4" role="dialog">
      <div className="bg-tone-surface rounded-lg w-full max-w-md p-6 border border-grey-20">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-tone-ink">Add brand admin</h2>
          <button onClick={onClose} className="text-grey-50 hover:text-tone-ink">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <p className="text-sm text-grey-60 mb-4">
          The user must already have a branch in this brand. They&apos;ll see the Group sidebar item the next time they refresh or sign in.
        </p>
        <form onSubmit={submit} className="space-y-4">
          <label className="block">
            <span className="block text-xs uppercase tracking-wide text-grey-60 mb-1">Email</span>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoFocus
              className="w-full border border-grey-20 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-tone-sage focus:border-tone-sage"
            />
          </label>
          {error && <p className="text-sm text-semantic-danger">{error}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-grey-70 hover:text-tone-ink">
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || !email.trim()}
              className="bg-tone-ink text-tone-surface px-4 py-2 text-sm font-medium rounded-md hover:opacity-90 disabled:opacity-50"
            >
              {submitting ? 'Adding…' : 'Add admin'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
