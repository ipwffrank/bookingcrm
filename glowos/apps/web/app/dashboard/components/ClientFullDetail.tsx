'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { apiFetch, ApiError } from '../../lib/api';
import { NoShowChip } from './NoShowChip';

// ─── Types ─────────────────────────────────────────────────────────────────────

type VipTier = 'bronze' | 'silver' | 'gold' | 'platinum';
type ChurnRisk = 'low' | 'medium' | 'high';

interface ClientProfile {
  id: string;
  clientId: string;
  vipTier: VipTier | null;
  churnRisk: ChurnRisk | null;
  totalVisits: number;
  totalSpendSgd: string;
  lastVisitAt: string | null;
  notes: string | null;
  birthday: string | null;
}

interface Client {
  id: string;
  name: string | null;
  phone: string;
  email: string | null;
}

interface BookingEntry {
  booking: { id: string; startTime: string; status: string; priceSgd: string; };
  service: { name: string };
  staffMember: { name: string };
}

interface ClientDetailData {
  profile: ClientProfile;
  client: Client;
  recent_bookings: BookingEntry[];
  noShowCount?: number;
}

interface ClientReview {
  id: string;
  rating: number;
  comment: string | null;
  createdAt: string;
  serviceName: string;
  staffName: string;
  appointmentDate: string;
}

// ─── Constants ─────────────────────────────────────────────────────────────────

const VIP_CONFIG: Record<VipTier, { label: string; cls: string; dot: string }> = {
  platinum: { label: 'Platinum', cls: 'bg-grey-15 text-grey-75', dot: 'bg-grey-75' },
  gold:     { label: 'Gold',     cls: 'bg-semantic-warn/10 text-semantic-warn', dot: 'bg-semantic-warn' },
  silver:   { label: 'Silver',   cls: 'bg-grey-15 text-grey-75',   dot: 'bg-grey-45'  },
  bronze:   { label: 'Bronze',   cls: 'bg-semantic-warn/10 text-semantic-warn',   dot: 'bg-semantic-warn'  },
};

const CHURN_CONFIG: Record<ChurnRisk, { label: string; cls: string }> = {
  low:    { label: 'Low risk',    cls: 'bg-tone-sage/10 text-tone-sage'  },
  medium: { label: 'Medium risk', cls: 'bg-semantic-warn/10 text-semantic-warn' },
  high:   { label: 'High risk',   cls: 'bg-semantic-danger/10 text-semantic-danger'      },
};

const STATUS_CLS: Record<string, string> = {
  confirmed:   'text-tone-sage',
  completed:   'text-grey-60',
  cancelled:   'text-semantic-danger',
  no_show:     'text-semantic-warn',
  in_progress: 'text-tone-ink',
};

// ─── Helpers ───────────────────────────────────────────────────────────────────

function fmt(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function initials(name: string | null) {
  if (!name) return '?';
  return name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
}

// ─── Stat card ─────────────────────────────────────────────────────────────────

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-grey-5 rounded-xl p-4 text-center">
      <p className="text-2xl font-bold text-tone-ink leading-none">{value}</p>
      {sub && <p className="text-xs text-grey-45 mt-0.5">{sub}</p>}
      <p className="text-xs text-grey-60 mt-1">{label}</p>
    </div>
  );
}

// ─── Placeholder section ────────────────────────────────────────────────────────

function PlaceholderSection({ title, icon, description }: { title: string; icon: React.ReactNode; description: string }) {
  return (
    <div className="rounded-xl border border-dashed border-grey-15 bg-grey-5/50 p-5">
      <div className="flex items-center gap-2 mb-1">
        {icon}
        <h3 className="text-sm font-semibold text-grey-75">{title}</h3>
        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-grey-15 text-grey-60 uppercase tracking-wide">Coming soon</span>
      </div>
      <p className="text-xs text-grey-45">{description}</p>
    </div>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────────

export function ClientFullDetail({ profileId, compact: _compact }: { profileId: string; compact?: boolean }) {
  const router = useRouter();

  const [data,       setData]       = useState<ClientDetailData | null>(null);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState<string | null>(null);
  const [clientReviews, setClientReviews] = useState<ClientReview[]>([]);
  const [treatmentLog, setTreatmentLog] = useState<Array<{ id: string; staffName: string | null; content: string; createdAt: string }>>([]);
  const [clientPackagesData, setClientPackagesData] = useState<any[]>([]);
  const [quotes, setQuotes] = useState<Array<{
    id: string;
    serviceId: string;
    serviceName: string;
    priceSgd: string;
    notes: string | null;
    status: 'pending' | 'accepted' | 'paid' | 'expired' | 'cancelled';
    validUntil: string;
    issuedAt: string;
    acceptToken: string;
    issuedByName: string | null;
  }>>([]);
  const [showIssueQuote, setShowIssueQuote] = useState(false);
  const [availableServices, setAvailableServices] = useState<Array<{ id: string; name: string; priceSgd: string; requiresConsultFirst: boolean }>>([]);
  const [quoteServiceId, setQuoteServiceId] = useState('');
  const [quotePrice, setQuotePrice] = useState('');
  const [quoteValidDays, setQuoteValidDays] = useState('14');
  const [quoteNotes, setQuoteNotes] = useState('');
  const [issuingQuote, setIssuingQuote] = useState(false);
  const [issueQuoteError, setIssueQuoteError] = useState('');
  const [waitlistHistory, setWaitlistHistory] = useState<Array<{
    id: string;
    targetDate: string;
    windowStart: string;
    windowEnd: string;
    serviceName: string;
    staffName: string;
    status: string;
    createdAt: string;
  }>>([]);
  const [showAddNote, setShowAddNote] = useState(false);
  const [newNoteContent, setNewNoteContent] = useState('');
  const [addingNote, setAddingNote] = useState(false);

  type ActivityEvent =
    | { type: 'purchase'; when: string; packageName: string; pricePaid: string }
    | {
        type: 'redemption';
        when: string;
        serviceName: string | null;
        staffName: string | null;
        bookingId: string | null;
      };

  const activityEvents: ActivityEvent[] = useMemo(() => {
    const events: ActivityEvent[] = [];
    for (const pkg of clientPackagesData) {
      events.push({
        type: 'purchase',
        when: pkg.purchasedAt,
        packageName: pkg.packageName,
        pricePaid: pkg.pricePaidSgd,
      });
      for (const s of pkg.sessions ?? []) {
        if (s.status === 'completed' && s.completedAt) {
          events.push({
            type: 'redemption',
            when: s.completedAt,
            serviceName: s.serviceName ?? null,
            staffName: s.staffName ?? null,
            bookingId: s.bookingId ?? null,
          });
        }
      }
    }
    return events.sort((a, b) => new Date(b.when).getTime() - new Date(a.when).getTime());
  }, [clientPackagesData]);

  useEffect(() => {
    const token = localStorage.getItem('access_token');
    if (!token) { router.push('/login'); return; }

    apiFetch(`/merchant/clients/${profileId}`)
      .then((d: unknown) => {
        const detail = d as ClientDetailData;
        setData(detail);
      })
      .catch(err => {
        if (err instanceof ApiError && err.status === 401) router.push('/login');
        else setError(err instanceof Error ? err.message : 'Failed to load client');
      })
      .finally(() => setLoading(false));

    // Fetch treatment log
    apiFetch(`/merchant/clients/${profileId}/notes`)
      .then((d: unknown) => {
        const result = d as { notes: Array<{ id: string; staffName: string | null; content: string; createdAt: string }> };
        setTreatmentLog(result.notes);
      })
      .catch(() => {});

    // Fetch client reviews
    apiFetch(`/merchant/reviews?clientId=${profileId}&period=all&limit=10`)
      .then((d: unknown) => {
        const result = d as { reviews: ClientReview[] };
        setClientReviews(result.reviews);
      })
      .catch(() => {});
  }, [profileId, router]);

  // Fetch client packages once client data is available
  useEffect(() => {
    if (!data?.client?.id) return;
    apiFetch(`/merchant/packages/client/${data.client.id}`)
      .then((d: any) => setClientPackagesData(d.packages ?? []))
      .catch(() => {});
  }, [data?.client?.id]);

  // Fetch treatment quotes for this client
  useEffect(() => {
    if (!data?.client?.id) return;
    apiFetch(`/merchant/quotes/client/${data.client.id}`)
      .then((d: any) => setQuotes(d.quotes ?? []))
      .catch(() => {});
  }, [data?.client?.id]);

  // Load services once (for the issue-quote form dropdown)
  useEffect(() => {
    apiFetch('/merchant/services')
      .then((d: any) => setAvailableServices(d.services ?? []))
      .catch(() => {});
  }, []);

  async function refetchQuotes() {
    if (!data?.client?.id) return;
    try {
      const d = (await apiFetch(`/merchant/quotes/client/${data.client.id}`)) as any;
      setQuotes(d.quotes ?? []);
    } catch { /* ignore */ }
  }

  async function handleIssueQuote(e: React.FormEvent) {
    e.preventDefault();
    setIssueQuoteError('');
    if (!data?.client?.id) return;
    if (!quoteServiceId || !quotePrice || !quoteValidDays) {
      setIssueQuoteError('Service, price and validity are required.');
      return;
    }
    const price = parseFloat(quotePrice);
    const days = parseInt(quoteValidDays, 10);
    if (Number.isNaN(price) || price <= 0) {
      setIssueQuoteError('Price must be a positive number.');
      return;
    }
    if (Number.isNaN(days) || days < 1 || days > 365) {
      setIssueQuoteError('Validity must be between 1 and 365 days.');
      return;
    }
    setIssuingQuote(true);
    try {
      await apiFetch('/merchant/quotes', {
        method: 'POST',
        body: JSON.stringify({
          client_id: data.client.id,
          service_id: quoteServiceId,
          price_sgd: price,
          valid_for_days: days,
          notes: quoteNotes.trim() || undefined,
        }),
      });
      setShowIssueQuote(false);
      setQuoteServiceId('');
      setQuotePrice('');
      setQuoteValidDays('14');
      setQuoteNotes('');
      await refetchQuotes();
    } catch (err) {
      setIssueQuoteError(err instanceof Error ? err.message : 'Failed to issue quote');
    } finally {
      setIssuingQuote(false);
    }
  }

  async function handleCancelQuote(quoteId: string) {
    const reason = prompt('Why are you cancelling this quote? (optional)') ?? '';
    try {
      await apiFetch(`/merchant/quotes/${quoteId}/cancel`, {
        method: 'POST',
        body: JSON.stringify({ reason: reason.trim() || undefined }),
      });
      await refetchQuotes();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to cancel quote');
    }
  }

  // Fetch waitlist history once client data is available
  useEffect(() => {
    if (!data?.client?.id) return;
    apiFetch(`/merchant/clients/${data.client.id}/waitlist-history`)
      .then((d: any) => setWaitlistHistory((d as { entries: typeof waitlistHistory }).entries ?? []))
      .catch(() => {});
  }, [data?.client?.id]);

  async function handleAddNote() {
    if (!newNoteContent.trim()) return;
    setAddingNote(true);
    try {
      const result = await apiFetch(`/merchant/clients/${profileId}/notes`, {
        method: 'POST',
        body: JSON.stringify({ content: newNoteContent.trim() }),
      }) as { note: { id: string; staffName: string | null; content: string; createdAt: string } };
      setTreatmentLog(prev => [result.note, ...prev]);
      setNewNoteContent('');
      setShowAddNote(false);
    } catch {
      alert('Failed to save note');
    } finally {
      setAddingNote(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-grey-15 border-t-[#1a2313] rounded-full animate-spin" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3">
        <p className="text-sm text-semantic-danger">{error ?? 'Client not found'}</p>
        <Link href="/dashboard/clients" className="text-xs text-grey-60 hover:text-grey-75 underline">Back to Clients</Link>
      </div>
    );
  }

  const { profile, client, recent_bookings } = data;
  const vipCfg   = profile.vipTier   ? VIP_CONFIG[profile.vipTier]   : null;
  const churnCfg = profile.churnRisk  ? CHURN_CONFIG[profile.churnRisk] : null;
  const revenue  = parseFloat(profile.totalSpendSgd ?? '0');

  const now = new Date();
  const upcoming = recent_bookings.filter(e => new Date(e.booking.startTime) >= now);
  const past     = recent_bookings.filter(e => new Date(e.booking.startTime) <  now);

  return (
    <div className="space-y-6 font-manrope">

      {/* ── Profile header ── */}
      <div className="bg-tone-surface rounded-xl border border-grey-15 p-6">
        <div className="flex items-start gap-5">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-[#1a2313]/10 to-[#1a2313]/20 flex items-center justify-center shrink-0">
            <span className="text-xl font-bold text-[#1a2313]">{initials(client.name)}</span>
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-xl font-bold text-tone-ink">{client.name ?? 'Unknown'}</h1>
              {vipCfg && (
                <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${vipCfg.cls}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${vipCfg.dot}`} />
                  {vipCfg.label}
                </span>
              )}
              {churnCfg && (
                <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${churnCfg.cls}`}>
                  {churnCfg.label}
                </span>
              )}
              <NoShowChip count={data?.noShowCount ?? 0} />
            </div>
            <div className="flex flex-wrap gap-4 mt-2">
              <div className="flex items-center gap-1.5 text-sm text-grey-75">
                <svg className="w-4 h-4 text-grey-45" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 0 0 2.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 0 1-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 0 0-1.091-.852H4.5A2.25 2.25 0 0 0 2.25 4.5v2.25Z"/></svg>
                {client.phone}
              </div>
              {client.email && (
                <div className="flex items-center gap-1.5 text-sm text-grey-75">
                  <svg className="w-4 h-4 text-grey-45" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75"/></svg>
                  {client.email}
                </div>
              )}
              {profile.birthday && (
                <div className="flex items-center gap-1.5 text-sm text-grey-75">
                  <svg className="w-4 h-4 text-grey-45" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M12 8.25v-1.5m0 1.5c-1.355 0-2.697.056-4.024.166C6.845 8.51 6 9.473 6 10.608v2.513m6-4.871c1.355 0 2.697.056 4.024.166C17.155 8.51 18 9.473 18 10.608v2.513M15 21H3v-1a6 6 0 0 1 12 0v1Zm0 0h6v-1a6 6 0 0 0-9-5.197M13.5 7a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Z"/></svg>
                  {fmt(profile.birthday)}
                </div>
              )}
            </div>
          </div>
          {/* Action buttons — hidden when printing so the exported PDF is clean */}
          <div className="shrink-0 flex items-center gap-2 print:hidden">
            <button
              type="button"
              onClick={() => window.print()}
              className="flex items-center gap-1.5 px-3 py-2 bg-tone-surface border border-grey-15 text-grey-90 text-sm font-medium rounded-lg hover:bg-grey-5 transition-colors"
              title="Open the browser's print dialog — choose 'Save as PDF' to export."
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6.72 13.829c-.24.03-.48.062-.72.096m.72-.096a42.415 42.415 0 0 1 10.56 0m-10.56 0L6.34 18m10.94-4.171c.24.03.48.062.72.096m-.72-.096L17.66 18m0 0 .229 2.523a1.125 1.125 0 0 1-1.12 1.227H7.231c-.662 0-1.18-.568-1.12-1.227L6.34 18m11.318 0h1.091A2.25 2.25 0 0 0 21 15.75V9.456c0-1.081-.768-2.015-1.837-2.175a48.055 48.055 0 0 0-1.913-.247M6.34 18H5.25A2.25 2.25 0 0 1 3 15.75V9.456c0-1.081.768-2.015 1.837-2.175a48.041 48.041 0 0 1 1.913-.247m10.5 0a48.536 48.536 0 0 0-10.5 0m10.5 0V3.375c0-.621-.504-1.125-1.125-1.125h-8.25c-.621 0-1.125.504-1.125 1.125v3.659M18 10.5h.008v.008H18V10.5Zm-3 0h.008v.008H15V10.5Z" />
              </svg>
              Export PDF
            </button>
            <Link
              href="/dashboard"
              className="flex items-center gap-1.5 px-4 py-2 bg-[#1a2313] text-white text-sm font-medium rounded-lg hover:bg-[#2f3827] transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15"/></svg>
              New Booking
            </Link>
          </div>
        </div>
      </div>

      {/* ── Stats ── */}
      <div className="grid grid-cols-3 gap-4">
        <StatCard label="Total Visits" value={String(profile.totalVisits)} />
        <StatCard label="Total Revenue" value={`$${revenue.toFixed(0)}`} sub="SGD" />
        <StatCard label="Last Visit" value={fmt(profile.lastVisitAt)} />
      </div>

      {/* ── Upcoming bookings ── */}
      {upcoming.length > 0 && (
        <div className="bg-tone-surface rounded-xl border border-grey-15 p-5">
          <h2 className="text-sm font-semibold text-tone-ink mb-3">Upcoming</h2>
          <div className="space-y-2">
            {upcoming.map(e => (
              <div key={e.booking.id} className="flex items-center justify-between bg-tone-sage/5 rounded-lg px-4 py-3">
                <div>
                  <p className="text-sm font-medium text-tone-ink">{e.service.name}</p>
                  <p className="text-xs text-grey-60 mt-0.5">{e.staffMember.name} · {fmt(e.booking.startTime)} · {new Date(e.booking.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
                </div>
                <span className="text-sm font-semibold text-grey-90">${parseFloat(e.booking.priceSgd).toFixed(0)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Service history ── */}
      <div className="bg-tone-surface rounded-xl border border-grey-15 p-5">
        <h2 className="text-sm font-semibold text-tone-ink mb-3">Service History</h2>
        {past.length === 0 ? (
          <p className="text-sm text-grey-45 italic">No past bookings</p>
        ) : (
          <div className="space-y-1.5">
            {past.map(e => (
              <div key={e.booking.id} className="flex items-center justify-between rounded-lg px-4 py-2.5 hover:bg-grey-5 transition-colors">
                <div className="flex items-center gap-3">
                  <div className="w-2 h-2 rounded-full bg-grey-30 shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-tone-ink">{e.service.name}</p>
                    <p className="text-xs text-grey-45">{e.staffMember.name} · {fmt(e.booking.startTime)}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-sm font-medium text-grey-90">${parseFloat(e.booking.priceSgd).toFixed(0)}</p>
                  <p className={`text-xs capitalize ${STATUS_CLS[e.booking.status] ?? 'text-grey-45'}`}>
                    {e.booking.status.replace('_', ' ')}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Treatment Log ── */}
      <div className="bg-tone-surface rounded-xl border border-grey-15 p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-tone-ink">Treatment Log</h2>
          <button
            onClick={() => setShowAddNote(true)}
            className="text-xs font-medium text-tone-sage hover:text-tone-sage transition-colors print:hidden"
          >
            + Add Entry
          </button>
        </div>

        {/* Add note form */}
        {showAddNote && (
          <div className="mb-4 space-y-2">
            <textarea
              value={newNoteContent}
              onChange={e => setNewNoteContent(e.target.value)}
              rows={3}
              placeholder="Treatment details, client preferences, observations..."
              className="w-full border border-grey-15 rounded-lg px-3 py-2 text-sm text-grey-90 focus:outline-none focus:ring-1 focus:ring-tone-sage/30 resize-none"
              autoFocus
            />
            <div className="flex gap-2">
              <button
                onClick={handleAddNote}
                disabled={!newNoteContent.trim() || addingNote}
                className="px-4 py-1.5 bg-tone-ink text-white text-xs font-medium rounded-lg hover:opacity-90 disabled:opacity-50 transition-colors"
              >
                {addingNote ? 'Saving...' : 'Save Entry'}
              </button>
              <button
                onClick={() => { setShowAddNote(false); setNewNoteContent(''); }}
                className="px-4 py-1.5 bg-grey-15 text-grey-75 text-xs font-medium rounded-lg hover:bg-grey-15 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Legacy notes from old system */}
        {data?.profile.notes?.trim() && treatmentLog.length === 0 && !showAddNote && (
          <div className="mb-3 bg-semantic-warn/5 border border-semantic-warn/30 rounded-lg px-4 py-3">
            <p className="text-[10px] text-semantic-warn font-medium uppercase tracking-wide mb-1">Legacy Notes</p>
            <p className="text-xs text-semantic-warn leading-relaxed whitespace-pre-wrap">{data.profile.notes}</p>
          </div>
        )}

        {/* Log entries */}
        {treatmentLog.length === 0 && !data?.profile.notes?.trim() ? (
          <p className="text-xs text-grey-45 italic">No entries yet. Add the first treatment note above.</p>
        ) : (
          <div className="space-y-3 max-h-96 overflow-y-auto">
            {treatmentLog.map(entry => (
              <div key={entry.id} className="border-l-2 border-tone-sage/30 pl-3 py-1">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-grey-75">{entry.staffName || 'Admin'}</span>
                    <span className="text-[10px] text-grey-45">
                      {new Date(entry.createdAt).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' })}
                      {' '}
                      {new Date(entry.createdAt).toLocaleTimeString('en-SG', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                </div>
                <p className="text-xs text-grey-75 mt-1 leading-relaxed whitespace-pre-wrap">{entry.content}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Package Activity ── */}
      {activityEvents.length > 0 && (
        <div className="bg-tone-surface rounded-xl border border-grey-15 p-5">
          <h2 className="text-sm font-semibold text-tone-ink mb-3">Package Activity</h2>
          <ul className="space-y-1.5">
            {activityEvents.map((e, i) => (
              <li key={i} className="text-xs text-grey-75 flex items-start gap-2">
                <span>{e.type === 'purchase' ? '📦' : '✅'}</span>
                <span className="flex-1">
                  {new Date(e.when).toLocaleDateString('en-SG', {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                  })}{' '}
                  —{' '}
                  {e.type === 'purchase'
                    ? `Bought ${e.packageName} · S$${e.pricePaid}`
                    : `Redeemed session${e.serviceName ? ` · ${e.serviceName}` : ''}${e.staffName ? ` · ${e.staffName}` : ''}`}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ── Waitlist History ── */}
      {waitlistHistory.length > 0 && (
        <div className="bg-tone-surface rounded-xl border border-grey-15 p-4">
          <h2 className="text-sm font-semibold text-tone-ink mb-2">Waitlist history</h2>
          <ul className="space-y-1">
            {waitlistHistory.map((w) => (
              <li key={w.id} className="text-xs text-grey-75">
                <span className="text-grey-60">{new Date(w.createdAt).toLocaleDateString('en-SG', { day: 'numeric', month: 'short' })}</span>
                {' · '}
                <span>{w.serviceName} · {w.staffName}</span>
                {' · '}
                <span className="text-grey-60">{w.targetDate} {w.windowStart}–{w.windowEnd}</span>
                {' · '}
                <span className="capitalize text-grey-75">{w.status}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ── Package Progress ── */}
      <div className="bg-tone-surface rounded-xl border border-grey-15 p-5">
        <h2 className="text-sm font-semibold text-tone-ink mb-4">Packages</h2>
        {clientPackagesData.length === 0 ? (
          <p className="text-xs text-grey-45 italic">No packages assigned.</p>
        ) : (
          <div className="space-y-4">
            {clientPackagesData.map((pkg: any) => (
              <div key={pkg.id} className="border border-grey-5 rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-semibold text-tone-ink">{pkg.packageName}</h3>
                  <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${
                    pkg.status === 'active' ? 'bg-tone-sage/5 text-tone-sage' :
                    pkg.status === 'completed' ? 'bg-grey-15 text-grey-60' :
                    'bg-semantic-danger/5 text-semantic-danger'
                  }`}>{pkg.status}</span>
                </div>
                {/* Progress bar */}
                <div className="flex items-center gap-3 mb-3">
                  <div className="flex-1 h-2 bg-grey-15 rounded-full overflow-hidden">
                    <div className="h-full bg-tone-ink rounded-full transition-all" style={{ width: `${(pkg.sessionsUsed / pkg.sessionsTotal) * 100}%` }} />
                  </div>
                  <span className="text-xs font-medium text-grey-75">{pkg.sessionsUsed}/{pkg.sessionsTotal}</span>
                </div>
                {/* Session list */}
                <div className="space-y-1.5">
                  {pkg.sessions?.map((s: any) => (
                    <div key={s.id} className="flex items-center justify-between text-xs py-1 border-b border-grey-5 last:border-0">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
                          s.status === 'completed' ? 'bg-tone-sage' :
                          s.status === 'booked' ? 'bg-grey-45' :
                          'bg-grey-30'
                        }`} />
                        <span className="text-grey-75 truncate">
                          {s.serviceName ?? `Session ${s.sessionNumber}`}
                          {s.serviceName ? ` · #${s.sessionNumber}` : ''}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <span className="text-grey-45 capitalize">
                          {s.status}
                          {s.completedAt ? ` · ${new Date(s.completedAt).toLocaleDateString('en-SG', { day: 'numeric', month: 'short' })}` : ''}
                          {s.staffName ? ` · ${s.staffName}` : ''}
                        </span>
                        {(s.status === 'pending' || s.status === 'booked') && (
                          <button
                            onClick={async () => {
                              if (!confirm(`Mark ${s.serviceName ?? `Session ${s.sessionNumber}`} as completed?`)) return;
                              try {
                                await apiFetch(`/merchant/packages/sessions/${s.id}/complete`, {
                                  method: 'PUT', body: JSON.stringify({}),
                                });
                                if (data?.client?.id) {
                                  const pd = await apiFetch(`/merchant/packages/client/${data.client.id}`) as any;
                                  setClientPackagesData(pd.packages ?? []);
                                }
                              } catch { alert('Failed to update'); }
                            }}
                            className="text-[10px] text-tone-sage hover:text-tone-sage font-medium"
                          >
                            Mark Done
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
                <p className="text-[10px] text-grey-45 mt-2">Expires {new Date(pkg.expiresAt).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' })}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Treatment Quotes ── */}
      <div className="bg-tone-surface rounded-xl border border-grey-15 p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-tone-ink">Treatment Quotes</h2>
          <button
            onClick={() => setShowIssueQuote((v) => !v)}
            className="text-xs text-tone-sage font-medium hover:underline print:hidden"
          >
            {showIssueQuote ? 'Cancel' : '+ Issue Quote'}
          </button>
        </div>

        {showIssueQuote && (
          <form onSubmit={handleIssueQuote} className="mb-4 space-y-3 rounded-lg bg-grey-5 border border-grey-15 p-3">
            <div>
              <label className="block text-[11px] font-medium text-grey-75 mb-1">Service</label>
              <select
                value={quoteServiceId}
                onChange={(e) => {
                  setQuoteServiceId(e.target.value);
                  const svc = availableServices.find((s) => s.id === e.target.value);
                  if (svc && !quotePrice) setQuotePrice(svc.priceSgd);
                }}
                className="w-full rounded-lg border border-grey-15 bg-tone-surface px-3 py-2 text-sm"
              >
                <option value="">Select a service…</option>
                {availableServices.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.requiresConsultFirst ? '⚕ ' : ''}{s.name} — SGD {parseFloat(s.priceSgd).toFixed(2)}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-medium text-grey-75 mb-1">Price (SGD)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={quotePrice}
                  onChange={(e) => setQuotePrice(e.target.value)}
                  className="w-full rounded-lg border border-grey-15 bg-tone-surface px-3 py-2 text-sm"
                  placeholder="450.00"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-grey-75 mb-1">Valid for (days)</label>
                <input
                  type="number"
                  min="1"
                  max="365"
                  value={quoteValidDays}
                  onChange={(e) => setQuoteValidDays(e.target.value)}
                  className="w-full rounded-lg border border-grey-15 bg-tone-surface px-3 py-2 text-sm"
                  placeholder="14"
                />
              </div>
            </div>
            <div>
              <label className="block text-[11px] font-medium text-grey-75 mb-1">Clinical notes (optional)</label>
              <textarea
                value={quoteNotes}
                onChange={(e) => setQuoteNotes(e.target.value)}
                rows={2}
                className="w-full rounded-lg border border-grey-15 bg-tone-surface px-3 py-2 text-sm resize-none"
                placeholder="e.g. Botox 30u, forehead + glabellar areas"
              />
            </div>
            {issueQuoteError && (
              <p className="text-xs text-semantic-danger">{issueQuoteError}</p>
            )}
            <div className="flex justify-end">
              <button
                type="submit"
                disabled={issuingQuote}
                className="px-4 py-2 rounded-lg bg-tone-ink text-tone-surface text-xs font-semibold hover:opacity-90 disabled:opacity-50 transition-opacity"
              >
                {issuingQuote ? 'Issuing…' : 'Issue Quote'}
              </button>
            </div>
          </form>
        )}

        {quotes.length === 0 ? (
          <p className="text-xs text-grey-45 italic">No quotes issued for this client yet.</p>
        ) : (
          <ul className="divide-y divide-grey-5">
            {quotes.map((q) => {
              const statusCls =
                q.status === 'pending' ? 'bg-semantic-warn/10 text-semantic-warn' :
                q.status === 'accepted' ? 'bg-tone-sage/10 text-tone-sage' :
                q.status === 'paid' ? 'bg-tone-sage/20 text-tone-sage' :
                q.status === 'expired' ? 'bg-grey-15 text-grey-60' :
                'bg-semantic-danger/10 text-semantic-danger';
              const acceptUrl = typeof window !== 'undefined' && data?.client
                ? `${window.location.origin}/quote/${q.acceptToken}`
                : `/quote/${q.acceptToken}`;
              return (
                <li key={q.id} className="py-2.5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold text-tone-ink">{q.serviceName}</p>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded uppercase tracking-wider font-semibold ${statusCls}`}>
                          {q.status}
                        </span>
                      </div>
                      <p className="text-xs text-grey-75 mt-0.5">
                        SGD {parseFloat(q.priceSgd).toFixed(2)} · valid until {new Date(q.validUntil).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' })}
                        {q.issuedByName ? ` · issued by ${q.issuedByName}` : ''}
                      </p>
                      {q.notes && <p className="text-xs text-grey-60 italic mt-0.5 truncate">{q.notes}</p>}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {q.status === 'pending' && (
                        <>
                          <button
                            onClick={() => {
                              void navigator.clipboard.writeText(acceptUrl);
                              alert('Accept link copied to clipboard');
                            }}
                            className="text-[11px] text-tone-sage hover:underline"
                          >
                            Copy link
                          </button>
                          <button
                            onClick={() => handleCancelQuote(q.id)}
                            className="text-[11px] text-semantic-danger hover:underline"
                          >
                            Cancel
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* ── Reviews ── */}
      <div className="bg-tone-surface rounded-xl border border-grey-15 p-5">
        <div className="flex items-center gap-2 mb-3">
          <svg className="w-4 h-4 text-grey-45" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M11.48 3.499a.562.562 0 0 1 1.04 0l2.125 5.111a.563.563 0 0 0 .475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 0 0-.182.557l1.285 5.385a.562.562 0 0 1-.84.61l-4.725-2.885a.562.562 0 0 0-.586 0L6.982 20.54a.562.562 0 0 1-.84-.61l1.285-5.386a.562.562 0 0 0-.182-.557l-4.204-3.602a.562.562 0 0 1 .321-.988l5.518-.442a.563.563 0 0 0 .475-.345L11.48 3.5Z"/>
          </svg>
          <h3 className="text-sm font-semibold text-grey-75">Reviews</h3>
        </div>
        {clientReviews.length === 0 ? (
          <p className="text-xs text-grey-45">No reviews yet</p>
        ) : (
          <div className="space-y-3">
            {clientReviews.map(review => (
              <div key={review.id} className="border-b border-grey-5 pb-3 last:border-0 last:pb-0">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs tracking-wider">
                    {[1, 2, 3, 4, 5].map(s => (
                      <span key={s} className={s <= review.rating ? 'text-semantic-warn' : 'text-grey-15'}>★</span>
                    ))}
                  </span>
                  <span className="text-[11px] text-grey-45">
                    {new Date(review.appointmentDate).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </span>
                </div>
                <p className="text-xs text-grey-60">{review.serviceName} · {review.staffName}</p>
                {review.comment && (
                  <p className="text-xs text-grey-75 mt-1">&ldquo;{review.comment}&rdquo;</p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Marketing preferences placeholder ── */}
      <PlaceholderSection
        title="Marketing Preferences"
        icon={
          <svg className="w-4 h-4 text-grey-45" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.34 15.84c-.688-.06-1.386-.09-2.09-.09H7.5a4.5 4.5 0 1 1 0-9h.75c.704 0 1.402-.03 2.09-.09m0 9.18c.253.962.584 1.892.985 2.783.247.55.06 1.21-.463 1.511l-.657.38c-.551.318-1.26.117-1.527-.461a20.845 20.845 0 0 1-1.44-4.282m3.102.069a18.03 18.03 0 0 1-.59-4.59c0-1.586.205-3.124.59-4.59m0 9.18a23.848 23.848 0 0 1 8.835 2.535M10.34 6.66a23.847 23.847 0 0 1 8.835-2.535m0 0A23.74 23.74 0 0 1 18.795 3m.38 1.125a23.91 23.91 0 0 1 1.014 5.395m-1.014 8.855c-.118.38-.245.754-.38 1.125m.38-1.125a23.91 23.91 0 0 0 1.014-5.395m0-3.46c.495.413.811 1.035.811 1.73 0 .695-.316 1.317-.811 1.73m0-3.46a24.347 24.347 0 0 1 0 3.46"/>
          </svg>
        }
        description="Email and SMS opt-in status, campaign eligibility, and unsubscribe history will be tracked here."
      />

    </div>
  );
}
