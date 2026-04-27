'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch, ApiError } from '../../../lib/api';

export function UpgradeToGroupCard() {
  const router = useRouter();
  const [show, setShow] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const u = JSON.parse(localStorage.getItem('user') ?? '{}');
      const m = JSON.parse(localStorage.getItem('merchant') ?? '{}');
      const isOwner = u.role === 'owner';
      const noGroupOnUser = !u.brandAdminGroupId;
      const noGroupOnMerchant = !m.groupId;
      const notBrandViewing = localStorage.getItem('brandViewing') !== 'true';
      const notImpersonating = localStorage.getItem('impersonating') !== 'true';
      setShow(isOwner && noGroupOnUser && noGroupOnMerchant && notBrandViewing && notImpersonating);
    } catch { /* hide on parse error — safer default */ }
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!groupName.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const data = await apiFetch('/merchant/upgrade-to-brand', {
        method: 'POST',
        body: JSON.stringify({ groupName: groupName.trim() }),
      });
      localStorage.setItem('access_token', data.access_token);
      localStorage.setItem('refresh_token', data.refresh_token);
      localStorage.setItem('user', JSON.stringify(data.user));
      localStorage.setItem('merchant', JSON.stringify(data.merchant));
      localStorage.setItem('group', JSON.stringify(data.group));
      router.push('/dashboard/group/overview');
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError) setError(err.message ?? 'Upgrade failed');
      else setError('Upgrade failed');
      setSubmitting(false);
    }
  }

  if (!show) return null;

  return (
    <section className="bg-tone-surface border border-grey-20 rounded-lg p-6 mb-6">
      <h2 className="text-lg font-semibold text-tone-ink mb-1">
        Manage multiple branches as one group
      </h2>
      <p className="text-sm text-grey-70 mb-4">
        If you operate more than one location under a single group, upgrade your
        account to group admin. You'll be able to add new branches, edit profiles
        across the group, and switch between branches without separate logins.
        Your current branch becomes the first in your new group.
      </p>
      <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-end">
        <label className="flex-1">
          <span className="block text-xs uppercase tracking-wide text-grey-60 mb-1">Group name</span>
          <input
            type="text"
            value={groupName}
            onChange={(e) => setGroupName(e.target.value)}
            required
            maxLength={255}
            placeholder="e.g. Aura Wellness Group"
            className="w-full border border-grey-20 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-tone-sage focus:border-tone-sage"
          />
        </label>
        <button
          type="submit"
          disabled={submitting || !groupName.trim()}
          className="bg-tone-ink text-tone-surface px-4 py-2 rounded-md text-sm font-medium hover:opacity-90 disabled:opacity-50"
        >
          {submitting ? 'Converting…' : 'Convert to group admin'}
        </button>
      </form>
      {error && <p className="text-sm text-semantic-danger mt-3">{error}</p>}
    </section>
  );
}
