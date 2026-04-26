'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch, ApiError } from '../../lib/api';

// ─── Types ─────────────────────────────────────────────────────────────────────

type VipTier = 'bronze' | 'silver' | 'gold' | 'platinum';
type ChurnRisk = 'low' | 'medium' | 'high';

interface ClientProfile {
  id: string;
  clientId: string;
  vipTier: VipTier | null;
  churnRisk: ChurnRisk | null;
  totalVisits: number | null;
  totalSpendSgd: string | null;
  lastVisitAt: string | null;
  rfmMonetary: string | null;
  rfmFrequency: number | null;
  lastVisitDate: string | null;
}

interface Client {
  id: string;
  name: string | null;
  phone: string;
  email: string | null;
}

interface BookingEntry {
  booking: { id: string; startTime: string; status: string; priceSgd: string };
  service: { name: string };
  staffMember: { name: string };
}

interface ClientDetail {
  profile: ClientProfile;
  client: Client;
  recent_bookings: BookingEntry[];
}

interface NoteEntry {
  id: string;
  staffName: string | null;
  content: string;
  createdAt: string;
}

interface PackageRow {
  id: string;
  packageName: string;
  status: 'active' | 'completed' | 'expired' | 'cancelled';
  sessionsUsed: number;
  sessionsTotal: number;
  expiresAt: string;
  sessions?: Array<{
    id: string;
    sessionNumber: number;
    status: 'pending' | 'booked' | 'completed' | 'cancelled';
    serviceName?: string;
  }>;
}

const VIP_CONFIG: Record<VipTier, { emoji: string; label: string; className: string }> = {
  platinum: { emoji: '💎', label: 'Platinum', className: 'bg-grey-15 text-grey-75 border-grey-15' },
  gold:     { emoji: '🥇', label: 'Gold',     className: 'bg-semantic-warn/10 text-semantic-warn border-semantic-warn/30' },
  silver:   { emoji: '🥈', label: 'Silver',   className: 'bg-grey-15 text-grey-75 border-grey-15' },
  bronze:   { emoji: '🥉', label: 'Bronze',   className: 'bg-semantic-warn/10 text-semantic-warn border-semantic-warn/30' },
};

const CHURN_CONFIG: Record<ChurnRisk, { label: string; className: string }> = {
  low:    { label: 'Low',    className: 'bg-tone-sage/10 text-tone-sage border-tone-sage/30' },
  medium: { label: 'Medium', className: 'bg-semantic-warn/10 text-semantic-warn border-semantic-warn/30' },
  high:   { label: 'High',   className: 'bg-semantic-danger/10 text-semantic-danger border-semantic-danger/30' },
};

function formatDate(iso: string | null) {
  if (!iso) return 'Never';
  return new Date(iso).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' });
}

function formatDateTime(iso: string) {
  const d = new Date(iso);
  return `${d.toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' })} ${d.toLocaleTimeString('en-SG', { hour: '2-digit', minute: '2-digit' })}`;
}

// ─── Drawer wrapper ────────────────────────────────────────────────────────────

function DrawerShell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  // ESC-to-close
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="fixed inset-0 bg-tone-ink/30" onClick={onClose} />
      <aside className="relative bg-tone-surface shadow-2xl w-full sm:max-w-md z-10 h-full overflow-y-auto flex flex-col">
        <div className="sticky top-0 bg-tone-surface border-b border-grey-5 px-5 py-3 flex items-center justify-between z-10">
          <h2 className="text-base font-semibold text-tone-ink">{title}</h2>
          <button onClick={onClose} className="p-1.5 rounded-md text-grey-50 hover:text-tone-ink hover:bg-grey-10">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="flex-1">{children}</div>
      </aside>
    </div>
  );
}

function Avatar({ name }: { name: string | null }) {
  return (
    <div className="w-12 h-12 rounded-xl bg-grey-10 flex items-center justify-center flex-shrink-0">
      <span className="text-lg font-semibold text-tone-ink">{(name ?? '?').charAt(0).toUpperCase()}</span>
    </div>
  );
}

function VipBadge({ tier }: { tier: VipTier | null }) {
  if (!tier) return null;
  const cfg = VIP_CONFIG[tier];
  return <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${cfg.className}`}>{cfg.emoji} {cfg.label}</span>;
}

function ChurnBadge({ risk }: { risk: ChurnRisk | null }) {
  if (!risk) return null;
  const cfg = CHURN_CONFIG[risk];
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${cfg.className}`}>{cfg.label} risk</span>;
}

function Spinner() {
  return (
    <div className="flex items-center justify-center py-12">
      <div className="w-8 h-8 border-4 border-tone-sage/30 border-t-tone-ink rounded-full animate-spin" />
    </div>
  );
}

// ─── Merchant-mode panel: full client detail + treatment log ──────────────────

export function ClientDetailPanel({ profileId, onClose }: { profileId: string; onClose: () => void }) {
  const router = useRouter();
  const [detail, setDetail] = useState<ClientDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [log, setLog] = useState<NoteEntry[]>([]);
  const [pkgs, setPkgs] = useState<PackageRow[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      apiFetch(`/merchant/clients/${profileId}`),
      apiFetch(`/merchant/clients/${profileId}/notes`).catch(() => ({ notes: [] })),
    ])
      .then(([cd, nd]) => {
        const d = cd as ClientDetail;
        setDetail(d);
        setLog((nd as { notes: NoteEntry[] }).notes ?? []);
        if (d.client?.id) {
          apiFetch(`/merchant/packages/client/${d.client.id}`)
            .then((pd: { packages?: PackageRow[] }) => setPkgs(pd.packages ?? []))
            .catch(() => { /* ignore */ });
        }
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) router.push('/login');
      })
      .finally(() => setLoading(false));
  }, [profileId, router]);

  async function addNote() {
    if (!draft.trim()) return;
    setSaving(true);
    try {
      const res = (await apiFetch(`/merchant/clients/${profileId}/notes`, {
        method: 'POST',
        body: JSON.stringify({ content: draft.trim() }),
      })) as { note: NoteEntry };
      setLog((prev) => [res.note, ...prev]);
      setDraft('');
      setShowAdd(false);
    } catch {
      alert('Failed to save entry');
    } finally {
      setSaving(false);
    }
  }

  return (
    <DrawerShell title="Client" onClose={onClose}>
      {loading ? <Spinner /> : !detail ? (
        <p className="p-6 text-sm text-grey-60">Client not found</p>
      ) : (
        <div className="p-5 space-y-5">
          <div className="flex items-start gap-3">
            <Avatar name={detail.client.name} />
            <div className="flex-1 min-w-0">
              <h3 className="font-semibold text-tone-ink truncate">{detail.client.name ?? 'Unknown'}</h3>
              <p className="text-sm text-grey-60">{detail.client.phone}</p>
              {detail.client.email && <p className="text-xs text-grey-50 truncate">{detail.client.email}</p>}
              <div className="flex flex-wrap gap-1.5 mt-2">
                <VipBadge tier={detail.profile.vipTier} />
                <ChurnBadge risk={detail.profile.churnRisk} />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div className="bg-grey-5 rounded-lg p-3 text-center">
              <p className="text-lg font-semibold text-tone-ink">{detail.profile.totalVisits ?? detail.profile.rfmFrequency ?? 0}</p>
              <p className="text-xs text-grey-60">Visits</p>
            </div>
            <div className="bg-tone-sage/10 rounded-lg p-3 text-center">
              <p className="text-lg font-semibold text-tone-sage">S${parseFloat(detail.profile.totalSpendSgd ?? detail.profile.rfmMonetary ?? '0').toFixed(0)}</p>
              <p className="text-xs text-grey-60">Spend</p>
            </div>
            <div className="bg-grey-5 rounded-lg p-3 text-center">
              <p className="text-xs font-semibold text-tone-ink">{formatDate(detail.profile.lastVisitAt ?? detail.profile.lastVisitDate)}</p>
              <p className="text-xs text-grey-60">Last Visit</p>
            </div>
          </div>

          <div>
            <h4 className="text-sm font-semibold text-tone-ink mb-2">Recent Bookings</h4>
            {detail.recent_bookings.length === 0 ? (
              <p className="text-xs text-grey-50 italic">No bookings yet</p>
            ) : (
              <div className="space-y-2">
                {detail.recent_bookings.map((e) => (
                  <div key={e.booking.id} className="flex items-center justify-between bg-grey-5 rounded-lg px-3 py-2">
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-tone-ink truncate">{e.service.name}</p>
                      <p className="text-xs text-grey-60 truncate">{e.staffMember.name} · {formatDate(e.booking.startTime)}</p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-xs font-semibold text-tone-ink">S${parseFloat(e.booking.priceSgd).toFixed(2)}</p>
                      <p className="text-xs text-grey-50 capitalize">{e.booking.status.replace('_', ' ')}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-semibold text-tone-ink">Treatment Log</h4>
              <button onClick={() => setShowAdd(true)} className="text-xs font-medium text-tone-sage hover:text-tone-ink">+ Add Entry</button>
            </div>
            {showAdd && (
              <div className="space-y-2">
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  rows={3}
                  placeholder="Treatment details, client preferences, observations…"
                  className="w-full border border-grey-15 rounded-md px-3 py-2 text-sm text-tone-ink focus:outline-none focus:ring-1 focus:ring-tone-sage/50 resize-none"
                  autoFocus
                />
                <div className="flex gap-2">
                  <button onClick={addNote} disabled={!draft.trim() || saving} className="px-3 py-1.5 bg-tone-ink text-tone-surface text-xs font-medium rounded-md hover:opacity-90 disabled:opacity-50">{saving ? 'Saving…' : 'Save Entry'}</button>
                  <button onClick={() => { setShowAdd(false); setDraft(''); }} className="px-3 py-1.5 bg-grey-15 text-grey-70 text-xs font-medium rounded-md hover:bg-grey-20">Cancel</button>
                </div>
              </div>
            )}
            {log.length === 0 ? (
              <p className="text-xs text-grey-50 italic">No entries yet.</p>
            ) : (
              <div className="space-y-3">
                {log.map((e) => (
                  <div key={e.id} className="border-l-2 border-tone-sage/30 pl-3 py-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-semibold text-grey-75">{e.staffName ?? 'Admin'}</span>
                      <span className="text-[10px] text-grey-50">{formatDateTime(e.createdAt)}</span>
                    </div>
                    <p className="text-xs text-grey-75 mt-1 leading-relaxed whitespace-pre-wrap">{e.content}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          {pkgs.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold text-tone-ink mb-2">Packages</h4>
              <div className="space-y-2">
                {pkgs.map((pkg) => (
                  <div key={pkg.id} className="border border-grey-10 rounded-lg p-3">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium text-tone-ink">{pkg.packageName}</span>
                      <span className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded-full ${
                        pkg.status === 'active' ? 'bg-tone-sage/10 text-tone-sage' :
                        pkg.status === 'completed' ? 'bg-grey-15 text-grey-60' :
                        'bg-semantic-danger/10 text-semantic-danger'
                      }`}>{pkg.status}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-1.5 bg-grey-15 rounded-full overflow-hidden">
                        <div className="h-full bg-tone-ink rounded-full" style={{ width: `${(pkg.sessionsUsed / pkg.sessionsTotal) * 100}%` }} />
                      </div>
                      <span className="text-[10px] font-medium text-grey-60">{pkg.sessionsUsed}/{pkg.sessionsTotal}</span>
                    </div>
                    <p className="text-[10px] text-grey-50 mt-1">Expires {formatDate(pkg.expiresAt)}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
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
            <p className="text-xs uppercase tracking-wider text-grey-50 mb-2">Across the brand</p>
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
