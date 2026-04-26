'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch } from '../../../lib/api';

interface Branch {
  merchantId: string;
  name: string;
}

/**
 * Top-of-sidebar picker. Default state: "← {currentBranchName} ▾".
 * Clicking expands a list of every branch in the group; selecting one
 * either:
 *   - takes the user to /dashboard/{currentBranch} (if same as current)
 *   - calls POST /group/view-as-branch to swap into another branch and
 *     redirects to /dashboard
 */
export function BranchPicker() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [currentName, setCurrentName] = useState<string>('');
  const [currentId, setCurrentId] = useState<string>('');
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const m = JSON.parse(localStorage.getItem('merchant') ?? 'null');
      if (m) {
        setCurrentName(m.name ?? '');
        setCurrentId(m.id ?? '');
      }
    } catch { /* ignore */ }
  }, []);

  async function ensureLoaded() {
    if (loaded) return;
    try {
      const data = await apiFetch('/group/branches');
      setBranches(
        (data.branches as Array<{ merchantId: string; name: string }>).map((b) => ({
          merchantId: b.merchantId,
          name: b.name,
        })),
      );
      setLoaded(true);
    } catch { /* swallow — picker stays empty */ }
  }

  async function pick(target: Branch) {
    setOpen(false);
    if (target.merchantId === currentId) {
      router.push('/dashboard');
      return;
    }
    setBusy(true);
    try {
      const data = await apiFetch('/group/view-as-branch', {
        method: 'POST',
        body: JSON.stringify({ merchantId: target.merchantId }),
      });
      // Persist the home branch name on first switch, so the banner can
      // render "End view → Home Branch" without an extra fetch.
      if (!localStorage.getItem('homeMerchantName')) {
        localStorage.setItem('homeMerchantName', currentName);
      }
      localStorage.setItem('access_token', data.access_token);
      localStorage.setItem('refresh_token', data.refresh_token);
      localStorage.setItem('merchant', JSON.stringify(data.merchant));
      localStorage.setItem('brandViewing', 'true');
      localStorage.setItem('homeMerchantId', data.homeMerchantId);
      router.push('/dashboard');
      router.refresh();
    } catch {
      setBusy(false);
    }
  }

  if (!currentName) {
    // Legacy group_users session: no merchant context, no picker.
    return null;
  }

  return (
    <div className="relative px-3 py-2 mb-1">
      <button
        onClick={() => { ensureLoaded(); setOpen((v) => !v); }}
        disabled={busy}
        className="w-full flex items-center justify-between gap-2 px-2 py-1.5 text-xs font-medium text-grey-60 hover:text-tone-ink rounded-md hover:bg-grey-10"
      >
        <span className="flex items-center gap-2 truncate">
          <ArrowLeftIcon className="w-4 h-4 flex-shrink-0" />
          <span className="truncate">{busy ? 'Switching…' : `Back to ${currentName}`}</span>
        </span>
        <ChevronDownIcon className="w-4 h-4 flex-shrink-0" />
      </button>
      {open && (
        <div className="absolute left-3 right-3 top-full mt-1 bg-tone-surface border border-grey-20 rounded-md shadow-lg z-50 max-h-72 overflow-y-auto">
          {branches.length === 0 && (
            <p className="px-3 py-2 text-xs text-grey-50">No other branches in this brand.</p>
          )}
          {branches.map((b) => (
            <button
              key={b.merchantId}
              onClick={() => pick(b)}
              className={`w-full text-left px-3 py-2 text-sm hover:bg-grey-10 ${
                b.merchantId === currentId ? 'text-tone-sage font-medium' : 'text-tone-ink'
              }`}
            >
              {b.name}
              {b.merchantId === currentId && <span className="text-xs text-grey-50 ml-2">(current)</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ArrowLeftIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
    </svg>
  );
}

function ChevronDownIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
    </svg>
  );
}
