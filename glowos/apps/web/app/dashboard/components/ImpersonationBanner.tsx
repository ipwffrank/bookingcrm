'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch } from '../../lib/api';

interface ImpersonatedMerchant {
  id: string;
  name: string;
  slug: string;
}

/**
 * Thin banner that shows when the current session is superadmin-impersonating a
 * merchant. Reads local flags set by the `/super/merchants` "View as" button.
 * Clicking "Exit" swaps the token back via POST /auth/end-impersonation.
 */
export function ImpersonationBanner() {
  const router = useRouter();
  const [isImpersonating, setIsImpersonating] = useState(false);
  const [merchant, setMerchant] = useState<ImpersonatedMerchant | null>(null);
  const [actorEmail, setActorEmail] = useState('');
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const flag = localStorage.getItem('impersonating') === 'true';
    if (!flag) return;
    setIsImpersonating(true);
    try {
      const raw = localStorage.getItem('impersonatingMerchant');
      if (raw) setMerchant(JSON.parse(raw) as ImpersonatedMerchant);
    } catch { /* ignore parse error */ }
    setActorEmail(localStorage.getItem('actorEmail') ?? '');
  }, []);

  async function handleExit() {
    setExiting(true);
    try {
      const data = await apiFetch('/auth/end-impersonation', { method: 'POST' });
      localStorage.setItem('access_token', data.access_token);
      localStorage.setItem('refresh_token', data.refresh_token);
      localStorage.removeItem('impersonating');
      localStorage.removeItem('impersonatingMerchant');
      localStorage.removeItem('actorEmail');
      // superAdmin flag preserved — we want to land back on /super after exit.
      router.push('/super/merchants');
    } catch {
      setExiting(false);
    }
  }

  if (!isImpersonating) return null;

  return (
    <div className="sticky top-0 z-40 bg-tone-ink text-tone-surface px-4 py-2">
      <div className="max-w-6xl mx-auto flex items-center justify-between gap-3 text-xs">
        <p className="truncate">
          <span className="font-semibold uppercase tracking-wider mr-2">Viewing as</span>
          You are managing <span className="font-semibold">{merchant?.name ?? 'merchant'}</span>
          {actorEmail && <> as <span className="font-mono text-white/70">{actorEmail}</span></>}.
        </p>
        <button
          onClick={handleExit}
          disabled={exiting}
          className="px-3 py-1 rounded bg-white/10 hover:bg-white/15 disabled:opacity-50 font-semibold tracking-wider uppercase text-[11px] shrink-0"
        >
          {exiting ? 'Exiting…' : 'Exit impersonation'}
        </button>
      </div>
    </div>
  );
}
