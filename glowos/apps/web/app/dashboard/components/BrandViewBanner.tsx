'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch } from '../../lib/api';

interface ViewingMerchant {
  id: string;
  name: string;
}

/**
 * Visible when the current session is a brand admin viewing a branch other
 * than their home branch. Reads the local flag set by the BranchPicker.
 * Sage tint — informational, not warn.
 */
export function BrandViewBanner() {
  const router = useRouter();
  const [active, setActive] = useState(false);
  const [merchant, setMerchant] = useState<ViewingMerchant | null>(null);
  const [homeName, setHomeName] = useState<string>('');
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const flag = localStorage.getItem('brandViewing') === 'true';
    if (!flag) return;
    setActive(true);
    try {
      const m = JSON.parse(localStorage.getItem('merchant') ?? 'null');
      if (m) setMerchant({ id: m.id, name: m.name });
    } catch { /* ignore */ }
    setHomeName(localStorage.getItem('homeMerchantName') ?? 'your home branch');
  }, []);

  async function handleExit() {
    setExiting(true);
    try {
      const data = await apiFetch('/auth/end-brand-view', { method: 'POST' });
      localStorage.setItem('access_token', data.access_token);
      localStorage.setItem('refresh_token', data.refresh_token);
      localStorage.setItem('merchant', JSON.stringify(data.merchant));
      localStorage.removeItem('brandViewing');
      localStorage.removeItem('homeMerchantId');
      localStorage.removeItem('homeMerchantName');
      // Hard reload to /dashboard. router.push doesn't trigger navigation when
      // we're already on /dashboard, and the banner state wouldn't reset on its
      // own — useEffect only runs on mount. window.location forces a remount
      // and re-reads localStorage, which is the simplest correct path.
      window.location.assign('/dashboard');
    } catch {
      setExiting(false);
    }
  }

  if (!active || !merchant) return null;

  return (
    <div className="bg-tone-sage/10 border-b border-tone-sage/30 px-4 py-2 text-sm flex items-center justify-between">
      <span className="text-tone-ink">
        Viewing <strong>{merchant.name}</strong> as a brand admin.
      </span>
      <button
        onClick={handleExit}
        disabled={exiting}
        className="text-tone-sage hover:text-tone-ink underline underline-offset-2 disabled:opacity-50"
      >
        {exiting ? 'Exiting…' : `End view → ${homeName}`}
      </button>
    </div>
  );
}
