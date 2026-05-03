'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch, ApiError } from '../../lib/api';
import { ClientFullDetail } from './ClientFullDetail';

// ─── Types ─────────────────────────────────────────────────────────────────────

interface Client {
  id: string;
  name: string | null;
  phone: string;
  email: string | null;
}

function formatDate(iso: string | null) {
  if (!iso) return 'Never';
  return new Date(iso).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' });
}

// ─── Drawer wrapper ────────────────────────────────────────────────────────────

function DrawerShell({
  title,
  onClose,
  headerAction,
  children,
}: {
  title: string;
  onClose: () => void;
  headerAction?: React.ReactNode;
  children: React.ReactNode;
}) {
  // ESC-to-close
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="fixed inset-0 bg-tone-ink/30" onClick={onClose} />
      <aside className="relative bg-tone-surface shadow-2xl w-full lg:max-w-3xl sm:max-w-xl z-10 h-full overflow-y-auto flex flex-col">
        <div className="sticky top-0 bg-tone-surface border-b border-grey-5 px-5 py-3 flex items-center justify-between z-10 gap-3">
          <h2 className="text-base font-semibold text-tone-ink">{title}</h2>
          <div className="flex items-center gap-2">
            {headerAction}
            <button onClick={onClose} className="p-1.5 rounded-md text-grey-50 hover:text-tone-ink hover:bg-grey-10">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
        <div className="flex-1">{children}</div>
      </aside>
    </div>
  );
}

// ─── Single-client PDF export button (used in the drawer header) ───────────────
//
// Same idempotent fetch-blob-and-open-tab pattern as the receipt button.
// Surfaces inline in the header so the user doesn't have to hunt for it.

function ExportClientPdfButton({ profileId }: { profileId: string }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onExport() {
    setBusy(true);
    setErr(null);
    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
      const token = localStorage.getItem('access_token');
      const res = await fetch(`${apiUrl}/merchant/clients/${profileId}/profile-pdf`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message ?? `Export failed (${res.status})`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank', 'noopener');
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Export failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        onClick={onExport}
        disabled={busy}
        title="Generate a clean, branded PDF of this client's full profile."
        className="px-3 py-1.5 rounded-lg text-xs font-medium text-tone-ink bg-tone-sage/15 hover:bg-tone-sage/30 border border-tone-sage/40 disabled:opacity-50 transition-colors flex items-center gap-1.5"
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
        </svg>
        {busy ? 'Generating…' : 'Export PDF'}
      </button>
      {err && <span className="text-[10px] text-semantic-danger">{err}</span>}
    </>
  );
}

function Avatar({ name }: { name: string | null }) {
  return (
    <div className="w-12 h-12 rounded-xl bg-grey-10 flex items-center justify-center flex-shrink-0">
      <span className="text-lg font-semibold text-tone-ink">{(name ?? '?').charAt(0).toUpperCase()}</span>
    </div>
  );
}

function Spinner() {
  return (
    <div className="flex items-center justify-center py-12">
      <div className="w-8 h-8 border-4 border-tone-sage/30 border-t-tone-ink rounded-full animate-spin" />
    </div>
  );
}

// ─── Merchant-mode panel: full client detail (delegates to ClientFullDetail) ───

export function ClientDetailPanel({ profileId, onClose }: { profileId: string; onClose: () => void }) {
  return (
    <DrawerShell
      title="Client"
      onClose={onClose}
      headerAction={<ExportClientPdfButton profileId={profileId} />}
    >
      <div id="client-profile-print-root" className="p-5">
        <ClientFullDetail profileId={profileId} />
      </div>
    </DrawerShell>
  );
}

// ─── Group-mode panel: cross-branch aggregate + per-branch breakdown ──────────

interface GroupClientDetail {
  client: Client;
  aggregate: {
    totalSpend: number;
    totalVisits: number;
    lastVisit: string | null;
    branchCount: number;
  };
  branches: Array<{
    merchantId: string;
    merchantName: string;
    visits: number;
    spend: number;
    lastVisit: string | null;
  }>;
}

export function GroupClientDetailPanel({ clientId, onClose }: { clientId: string; onClose: () => void }) {
  const router = useRouter();
  const [data, setData] = useState<GroupClientDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [pivoting, setPivoting] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    apiFetch(`/group/clients/${clientId}`)
      .then((d: GroupClientDetail) => setData(d))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [clientId]);

  async function viewAtBranch(merchantId: string, merchantName: string) {
    setPivoting(merchantId);
    try {
      const res = (await apiFetch('/group/view-as-branch', {
        method: 'POST',
        body: JSON.stringify({ merchantId }),
      })) as { access_token: string; refresh_token: string; merchant: unknown; homeMerchantId: string };
      // Persist home name on first switch so the banner can render the return target.
      if (!localStorage.getItem('homeMerchantName')) {
        try {
          const m = JSON.parse(localStorage.getItem('merchant') ?? 'null');
          if (m?.name) localStorage.setItem('homeMerchantName', m.name);
        } catch { /* ignore */ }
      }
      localStorage.setItem('access_token', res.access_token);
      localStorage.setItem('refresh_token', res.refresh_token);
      localStorage.setItem('merchant', JSON.stringify(res.merchant));
      localStorage.setItem('brandViewing', 'true');
      localStorage.setItem('homeMerchantId', res.homeMerchantId);
      // Land on the branch's clients page so the user can immediately drill in.
      window.location.assign(`/dashboard/clients?focus=${clientId}&branch=${encodeURIComponent(merchantName)}`);
    } catch {
      setPivoting(null);
      alert('Failed to switch into branch');
    }
  }

  return (
    <DrawerShell title="Client across brand" onClose={onClose}>
      {loading ? <Spinner /> : !data ? (
        <p className="p-6 text-sm text-grey-60">Client not found in this brand.</p>
      ) : (
        <div className="p-5 space-y-5">
          <div className="flex items-start gap-3">
            <Avatar name={data.client.name} />
            <div className="flex-1 min-w-0">
              <h3 className="font-semibold text-tone-ink truncate">{data.client.name ?? 'Unknown'}</h3>
              <p className="text-sm text-grey-60">{data.client.phone}</p>
              {data.client.email && <p className="text-xs text-grey-50 truncate">{data.client.email}</p>}
            </div>
          </div>

          <div>
            <p className="text-xs uppercase tracking-wider text-grey-50 mb-2">Across the group</p>
            <div className="grid grid-cols-3 gap-2">
              <div className="bg-grey-5 rounded-lg p-3 text-center">
                <p className="text-lg font-semibold text-tone-ink">{data.aggregate.totalVisits}</p>
                <p className="text-xs text-grey-60">Visits</p>
              </div>
              <div className="bg-tone-sage/10 rounded-lg p-3 text-center">
                <p className="text-lg font-semibold text-tone-sage">S${data.aggregate.totalSpend.toFixed(0)}</p>
                <p className="text-xs text-grey-60">Spend</p>
              </div>
              <div className="bg-grey-5 rounded-lg p-3 text-center">
                <p className="text-xs font-semibold text-tone-ink">{formatDate(data.aggregate.lastVisit)}</p>
                <p className="text-xs text-grey-60">Last Visit</p>
              </div>
            </div>
            <p className="text-xs text-grey-50 mt-2">Visited {data.aggregate.branchCount} branch{data.aggregate.branchCount === 1 ? '' : 'es'}.</p>
          </div>

          <div>
            <p className="text-xs uppercase tracking-wider text-grey-50 mb-2">By branch</p>
            <p className="text-xs text-grey-60 mb-3">
              Notes and treatment log are kept at the branch level. Open a branch below to view or add entries there.
            </p>
            <div className="space-y-2">
              {data.branches.map((b) => (
                <div key={b.merchantId} className="border border-grey-10 rounded-lg p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-tone-ink truncate">{b.merchantName}</p>
                      <p className="text-xs text-grey-60">{b.visits} visit{b.visits === 1 ? '' : 's'} · S${b.spend.toFixed(0)} · last {formatDate(b.lastVisit)}</p>
                    </div>
                    <button
                      onClick={() => viewAtBranch(b.merchantId, b.merchantName)}
                      disabled={pivoting === b.merchantId}
                      className="text-xs text-tone-sage hover:text-tone-ink underline underline-offset-2 disabled:opacity-50 flex-shrink-0"
                    >
                      {pivoting === b.merchantId ? 'Switching…' : 'Open at this branch →'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </DrawerShell>
  );
}
