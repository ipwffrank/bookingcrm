'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { apiFetch, ApiError } from '../../lib/api';
import { NoShowChip } from './NoShowChip';
import { PrivatePhoto } from './PrivatePhoto';
import { BookingForm } from '../bookings/BookingForm';
import { CheckoutModal } from './CheckoutModal';
import { CancelBookingDialog, describeRefund } from './CancelBookingDialog';
import { Odontogram } from './odontogram/Odontogram';

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
  booking: {
    id: string;
    startTime: string;
    status: string;
    priceSgd: string;
    paymentMethod?: string | null;
    discountSgd?: string | null;
    loyaltyPointsRedeemed?: number | null;
  };
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
  const [showNewBooking, setShowNewBooking] = useState(false);
  // Inline status actions in the Upcoming list. acting tracks which booking
  // is currently in flight so we can disable buttons during the request.
  const [acting, setActing] = useState<{ bookingId: string; action: string } | null>(null);
  // Cancel dialog target — null when closed. We carry the label here so the
  // dialog can show the service + time without re-deriving it from upcoming[].
  const [cancelTarget, setCancelTarget] = useState<{ bookingId: string; label: string } | null>(null);
  const [statusActionError, setStatusActionError] = useState<string | null>(null);
  // Checkout modal — same pattern as the dashboard. Opens for Complete /
  // Checkout Now actions on Upcoming bookings.
  const [checkoutBookingId, setCheckoutBookingId] = useState<string | null>(null);
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

  // ── Clinical Records state ──────────────────────────────────────────────────
  type ClinicalRecordType = 'consultation_note' | 'treatment_log' | 'prescription';

  interface ClinicalAttachment {
    id: string;
    url: string;
    pathname?: string;   // private blob path — present on new uploads
    mime: string;
    size: number;
    name: string;
    kind: 'before' | 'after' | 'other';
    uploadedAt: string;
    uploadedByName: string;
  }

  interface ClinicalSignedConsent {
    formText: string;
    signerName: string;
    signedAt: string;
    signerIp: string | null;
    signatureUrl: string;
    signaturePathname?: string;  // private blob path — present on new uploads
    contentHash: string;
  }

  interface ClinicalRecord {
    id: string;
    type: ClinicalRecordType | 'amendment';
    title: string | null;
    body: string;
    recordedByName: string;
    recordedByEmail: string;
    amendsId: string | null;
    amendmentReason: string | null;
    attachments: ClinicalAttachment[] | null;
    signedConsent: ClinicalSignedConsent | null;
    lockedAt: string | null;
    createdAt: string;
  }
  interface AuditEntry {
    id: string;
    recordId: string;
    userEmail: string;
    action: 'read' | 'write' | 'amend';
    ipAddress: string | null;
    createdAt: string;
  }
  const [clinicalRecords, setClinicalRecords] = useState<ClinicalRecord[]>([]);
  const [clinicalRecordsForbidden, setClinicalRecordsForbidden] = useState(false);
  const [showNewRecordForm, setShowNewRecordForm] = useState(false);
  const [newRecordType, setNewRecordType] = useState<ClinicalRecordType>('consultation_note');
  const [newRecordTitle, setNewRecordTitle] = useState('');
  const [newRecordBody, setNewRecordBody] = useState('');
  const [savingRecord, setSavingRecord] = useState(false);
  const [amendingRecordId, setAmendingRecordId] = useState<string | null>(null);
  const [amendBody, setAmendBody] = useState('');
  const [amendTitle, setAmendTitle] = useState('');
  const [amendReason, setAmendReason] = useState('');
  const [savingAmend, setSavingAmend] = useState(false);
  const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([]);
  const [showAuditLog, setShowAuditLog] = useState(false);
  const [auditLoading, setAuditLoading] = useState(false);

  // ── Staged photos for new-record form ─────────────────────────────────────

  interface StagedPhoto {
    id: string;          // local-only, used for keying + remove
    file: File;
    kind: 'before' | 'after' | 'other';
    previewUrl: string;  // URL.createObjectURL() — revoke on remove + on form close
  }

  const [stagedPhotos, setStagedPhotos] = useState<StagedPhoto[]>([]);
  const [photoConsent, setPhotoConsent] = useState(false);
  const [dragActive, setDragActive] = useState(false);

  // Photo upload state (keyed by recordId)
  const [showPhotoUpload, setShowPhotoUpload] = useState<string | null>(null);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoKind, setPhotoKind] = useState<'before' | 'after' | 'other'>('other');
  const [uploadingPhoto, setUploadingPhoto] = useState(false);

  // Lightbox for full-size private photo view
  const [lightbox, setLightbox] = useState<{ recordId: string; attachmentId: string; alt: string } | null>(null);

  // Consent form state (keyed by recordId)
  const [showConsentForm, setShowConsentForm] = useState<string | null>(null);
  const [consentFormText, setConsentFormText] = useState('');
  const [consentSignerName, setConsentSignerName] = useState('');
  const [consentSignatureDataUrl, setConsentSignatureDataUrl] = useState<string | null>(null);
  const [submittingConsent, setSubmittingConsent] = useState(false);

  // PDPA data export state
  const [exporting, setExporting] = useState(false);

  // ── Loyalty state ──────────────────────────────────────────────────────────
  interface LoyaltyProgram {
    id: string | null;
    enabled: boolean;
    pointsPerDollar: number;
    pointsPerVisit: number;
    pointsPerDollarRedeem: number;
    minRedeemPoints: number;
    earnExpiryMonths: number;
  }
  interface LoyaltyTransaction {
    id: string;
    kind: string;
    amount: number;
    reason: string | null;
    actorName: string | null;
    createdAt: string;
    earnedFromSgd: string | null;
    redeemedSgd: string | null;
    bookingId: string | null;
  }
  const [loyaltyBalance, setLoyaltyBalance] = useState<number | null>(null);
  const [loyaltyProgram, setLoyaltyProgram] = useState<LoyaltyProgram | null>(null);
  const [loyaltyTransactionsData, setLoyaltyTransactionsData] = useState<LoyaltyTransaction[]>([]);
  const [loyaltyLoading, setLoyaltyLoading] = useState(true);
  const [loyaltyError, setLoyaltyError] = useState<string | null>(null);

  // Adjust form
  const [showAdjust, setShowAdjust] = useState(false);
  const [adjustAmount, setAdjustAmount] = useState('');
  const [adjustReason, setAdjustReason] = useState('');
  const [adjusting, setAdjusting] = useState(false);
  const [adjustError, setAdjustError] = useState<string | null>(null);

  // Redeem form
  const [showRedeem, setShowRedeem] = useState(false);
  const [redeemPoints, setRedeemPoints] = useState('');
  const [redeeming, setRedeeming] = useState(false);
  const [redeemError, setRedeemError] = useState<string | null>(null);

  async function refetchLoyalty() {
    try {
      const d = (await apiFetch(`/merchant/clients/${profileId}/loyalty`)) as {
        balance: number;
        program: LoyaltyProgram;
        recentTransactions: LoyaltyTransaction[];
      };
      setLoyaltyBalance(d.balance);
      setLoyaltyProgram(d.program);
      setLoyaltyTransactionsData(d.recentTransactions ?? []);
    } catch { /* swallow */ }
  }

  async function refetchClientData() {
    try {
      const d = (await apiFetch(`/merchant/clients/${profileId}`)) as ClientDetailData;
      setData(d);
    } catch { /* swallow — view stays on stale data */ }
  }

  // Inline status actions for the Upcoming list. Used when staff calls a
  // client offline and needs to update the booking status without going to
  // the dashboard for that future date.
  async function handleStatusAction(
    bookingId: string,
    action: 'confirm' | 'check-in' | 'no-show',
  ) {
    setStatusActionError(null);
    setActing({ bookingId, action });
    try {
      await apiFetch(`/merchant/bookings/${bookingId}/${action}`, { method: 'PUT' });
      await refetchClientData();
    } catch (e) {
      setStatusActionError(
        e instanceof ApiError
          ? (e.message ?? `Failed to ${action}`)
          : `Failed to ${action}`,
      );
    } finally {
      setActing(null);
    }
  }

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

    // Fetch clinical records
    apiFetch(`/merchant/clients/${profileId}/clinical-records`)
      .then((d: unknown) => {
        const result = d as { records: ClinicalRecord[] };
        setClinicalRecords(result.records ?? []);
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 403) {
          setClinicalRecordsForbidden(true);
        }
      });

    // Fetch loyalty balance + transactions
    apiFetch(`/merchant/clients/${profileId}/loyalty`)
      .then((d: unknown) => {
        const result = d as { balance: number; program: LoyaltyProgram; recentTransactions: LoyaltyTransaction[] };
        setLoyaltyBalance(result.balance);
        setLoyaltyProgram(result.program);
        setLoyaltyTransactionsData(result.recentTransactions ?? []);
      })
      .catch((err) => setLoyaltyError(err instanceof Error ? err.message : 'Failed to load loyalty'))
      .finally(() => setLoyaltyLoading(false));
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

  // ── Staged-photo helpers ───────────────────────────────────────────────────

  function stagePhotos(files: File[]) {
    const valid = files.filter(f => f.size <= 10 * 1024 * 1024); // 10 MB cap
    const newOnes: StagedPhoto[] = valid.map(file => ({
      id: Math.random().toString(36).slice(2, 10),
      file,
      kind: 'other' as const,
      previewUrl: URL.createObjectURL(file),
    }));
    setStagedPhotos(curr => [...curr, ...newOnes]);
    if (files.length !== valid.length) {
      alert('Some files were too large (max 10 MB each) and were skipped.');
    }
  }

  function removeStagedPhoto(id: string) {
    setStagedPhotos(curr => {
      const target = curr.find(x => x.id === id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return curr.filter(x => x.id !== id);
    });
  }

  function resetNewRecordForm() {
    setShowNewRecordForm(false);
    setNewRecordBody('');
    setNewRecordTitle('');
    setNewRecordType('consultation_note');
    setStagedPhotos(curr => {
      curr.forEach(p => URL.revokeObjectURL(p.previewUrl));
      return [];
    });
    setPhotoConsent(false);
    setDragActive(false);
  }

  // ── Clinical record handlers ────────────────────────────────────────────────

  async function refreshClinicalRecords() {
    try {
      const result = await apiFetch(`/merchant/clients/${profileId}/clinical-records`) as { records: ClinicalRecord[] };
      setClinicalRecords(result.records ?? []);
    } catch {
      // best-effort refresh; ignore errors
    }
  }

  async function handleCreateClinicalRecord() {
    if (!newRecordBody.trim() || savingRecord) return;
    // Block if photos staged but consent not given
    if (stagedPhotos.length > 0 && !photoConsent) {
      alert('Please confirm the PDPA consent acknowledgement to attach photos.');
      return;
    }
    setSavingRecord(true);
    try {
      const created = (await apiFetch(`/merchant/clients/${profileId}/clinical-records`, {
        method: 'POST',
        body: JSON.stringify({
          type: newRecordType,
          title: newRecordTitle.trim() || undefined,
          body: newRecordBody.trim(),
        }),
      })) as { record: ClinicalRecord };

      // Sequential photo uploads (don't parallelize — keeps order + progress clear)
      const recordId = created.record.id;
      for (const p of stagedPhotos) {
        const fd = new FormData();
        fd.append('file', p.file);
        fd.append('kind', p.kind);
        fd.append('pdpaConsent', String(photoConsent));
        const token = localStorage.getItem('access_token');
        const res = await fetch(
          `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'}/merchant/clients/${profileId}/clinical-records/${recordId}/photos`,
          { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd },
        );
        if (!res.ok) {
          // Best-effort: don't unwind. Log + continue. The record is saved already.
          console.error('Photo upload failed', await res.text().catch(() => ''));
        }
      }

      resetNewRecordForm();
      void refreshClinicalRecords();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to save record');
    } finally {
      setSavingRecord(false);
    }
  }

  function startAmend(record: ClinicalRecord) {
    setAmendingRecordId(record.id);
    setAmendBody(record.body);
    setAmendTitle(record.title ?? '');
    setAmendReason('');
  }

  function cancelAmend() {
    setAmendingRecordId(null);
    setAmendBody('');
    setAmendTitle('');
    setAmendReason('');
  }

  async function handleAmendRecord() {
    if (!amendingRecordId || !amendBody.trim() || !amendReason.trim()) return;
    setSavingAmend(true);
    try {
      const result = await apiFetch(
        `/merchant/clients/${profileId}/clinical-records/${amendingRecordId}/amend`,
        {
          method: 'POST',
          body: JSON.stringify({
            body: amendBody.trim(),
            title: amendTitle.trim() || undefined,
            amendmentReason: amendReason.trim(),
          }),
        },
      ) as { record: ClinicalRecord };
      // Replace the amended record with the new amendment in the list
      setClinicalRecords(prev =>
        prev
          .filter(r => r.id !== amendingRecordId)
          .concat(result.record)
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
      );
      cancelAmend();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to amend record');
    } finally {
      setSavingAmend(false);
    }
  }

  async function loadAuditLog() {
    if (auditEntries.length > 0) { setShowAuditLog(v => !v); return; }
    setAuditLoading(true);
    setShowAuditLog(true);
    try {
      const result = await apiFetch(
        `/merchant/clients/${profileId}/clinical-records/audit-log`,
      ) as { entries: AuditEntry[] };
      setAuditEntries(result.entries ?? []);
    } catch {
      setAuditEntries([]);
    } finally {
      setAuditLoading(false);
    }
  }

  // ── PDPA data export handler ───────────────────────────────────────────────

  async function handleExport() {
    setExporting(true);
    try {
      const token = localStorage.getItem('access_token');
      const apiBase = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
      const res = await fetch(`${apiBase}/merchant/clients/${profileId}/data-export`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`Export failed: ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `client-data-export-${profileId}-${Date.now()}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      alert('Export failed');
    } finally {
      setExporting(false);
    }
  }

  // ── Photo upload / delete handlers ─────────────────────────────────────────

  function patchRecord(updated: ClinicalRecord) {
    setClinicalRecords(prev =>
      prev.map(r => (r.id === updated.id ? updated : r)),
    );
  }

  async function handleUploadPhoto(recordId: string) {
    if (!photoFile) return;
    setUploadingPhoto(true);
    try {
      const fd = new FormData();
      fd.append('file', photoFile);
      fd.append('kind', photoKind);
      const token = localStorage.getItem('access_token');
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL ?? ''}/merchant/clients/${profileId}/clinical-records/${recordId}/photos`,
        { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd },
      );
      if (!res.ok) {
        const data = await res.json() as { message?: string };
        throw new Error(data.message ?? 'Upload failed');
      }
      const data = await res.json() as { attachments: ClinicalAttachment[] };
      setClinicalRecords(prev =>
        prev.map(r => r.id === recordId ? { ...r, attachments: data.attachments } : r),
      );
      setShowPhotoUpload(null);
      setPhotoFile(null);
      setPhotoKind('other');
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Photo upload failed');
    } finally {
      setUploadingPhoto(false);
    }
  }

  async function handleDeletePhoto(recordId: string, photoId: string) {
    if (!confirm('Delete this photo? This cannot be undone.')) return;
    try {
      const result = await apiFetch(
        `/merchant/clients/${profileId}/clinical-records/${recordId}/photos/${photoId}`,
        { method: 'DELETE' },
      ) as { attachments: ClinicalAttachment[] };
      setClinicalRecords(prev =>
        prev.map(r => r.id === recordId ? { ...r, attachments: result.attachments } : r),
      );
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete photo');
    }
  }

  // ── Consent form handler ────────────────────────────────────────────────────

  function openConsentForm(record: ClinicalRecord) {
    setShowConsentForm(record.id);
    setConsentFormText(
      'I consent to the treatment described above. I understand the risks and have had my questions answered.',
    );
    setConsentSignerName('');
    setConsentSignatureDataUrl(null);
  }

  async function handleSubmitConsent(recordId: string) {
    if (!consentSignatureDataUrl) { alert('Please provide a signature.'); return; }
    if (!consentSignerName.trim()) { alert('Please enter the signer name.'); return; }
    setSubmittingConsent(true);
    try {
      const result = await apiFetch(
        `/merchant/clients/${profileId}/clinical-records/${recordId}/consent`,
        {
          method: 'POST',
          body: JSON.stringify({
            formText: consentFormText,
            signatureDataUrl: consentSignatureDataUrl,
            signerName: consentSignerName.trim(),
          }),
        },
      ) as { record: ClinicalRecord };
      patchRecord(result.record);
      setShowConsentForm(null);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to submit consent');
    } finally {
      setSubmittingConsent(false);
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
              <BirthdayField profileId={profile.id} initialValue={profile.birthday} />
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
            <button
              type="button"
              onClick={() => setShowNewBooking(true)}
              className="flex items-center gap-1.5 px-4 py-2 bg-[#1a2313] text-white text-sm font-medium rounded-lg hover:bg-[#2f3827] transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15"/></svg>
              New Booking
            </button>
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
          {statusActionError && (
            <p className="mb-2 text-xs text-semantic-danger">{statusActionError}</p>
          )}
          <div className="space-y-2">
            {upcoming.map(e => {
              const gross = parseFloat(e.booking.priceSgd);
              const discount = parseFloat(e.booking.discountSgd ?? '0');
              const ptsRedeemed = e.booking.loyaltyPointsRedeemed ?? 0;
              const net = Math.max(0, gross - discount);
              const statusLabel = (() => {
                switch (e.booking.status) {
                  case 'pending': return 'Pending confirmation';
                  case 'confirmed': return 'Confirmed';
                  case 'in_progress': return 'In progress';
                  default: return null;
                }
              })();
              const statusClass = e.booking.status === 'pending' ? 'state-notified' : 'state-default';
              const isActing = acting?.bookingId === e.booking.id;
              const canConfirm = e.booking.status === 'pending';
              const canCheckIn = e.booking.status === 'pending' || e.booking.status === 'confirmed';
              const canCheckoutNow = e.booking.status === 'confirmed';
              const canComplete = e.booking.status === 'in_progress';
              const canNoShow =
                e.booking.status === 'pending' ||
                e.booking.status === 'confirmed' ||
                e.booking.status === 'in_progress';
              // Cancel mirrors the backend guard: any non-terminal status is
              // cancellable. Backend rejects already-cancelled / completed /
              // no-show with 409.
              const canCancel = canNoShow;
              const hasActions =
                canConfirm || canCheckIn || canCheckoutNow || canComplete || canNoShow || canCancel;
              return (
                <div key={e.booking.id} className="bg-tone-sage/5 rounded-lg px-4 py-3">
                  <div className="flex items-center justify-between">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-medium text-tone-ink">{e.service.name}</p>
                        {statusLabel && (
                          <span className={`text-[10px] uppercase tracking-wider ${statusClass}`}>
                            {statusLabel}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-grey-60 mt-0.5">{e.staffMember.name} · {fmt(e.booking.startTime)} · {new Date(e.booking.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-grey-60">
                        {e.booking.paymentMethod && (
                          <span className="capitalize">💳 {e.booking.paymentMethod}</span>
                        )}
                        {ptsRedeemed > 0 && (
                          <span className="text-tone-sage">
                            ✦ {ptsRedeemed} pts redeemed (−${discount.toFixed(2)})
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="text-right shrink-0 ml-2">
                      {discount > 0 ? (
                        <>
                          <span className="text-xs text-grey-45 line-through block leading-none">${gross.toFixed(0)}</span>
                          <span className="text-sm font-semibold text-grey-90">${net.toFixed(2)}</span>
                        </>
                      ) : (
                        <span className="text-sm font-semibold text-grey-90">${gross.toFixed(0)}</span>
                      )}
                    </div>
                  </div>

                  {hasActions && (
                    <div className="mt-2 pt-2 border-t border-tone-sage/15 flex flex-wrap gap-1.5 print:hidden">
                      {canConfirm && (
                        <button
                          type="button"
                          onClick={() => void handleStatusAction(e.booking.id, 'confirm')}
                          disabled={isActing}
                          title="Confirm on behalf of the customer (e.g. they confirmed by phone)"
                          className="px-2.5 py-1 rounded-lg text-[11px] font-semibold text-tone-surface bg-semantic-warn hover:opacity-90 disabled:opacity-50 transition-opacity"
                        >
                          {isActing && acting?.action === 'confirm' ? '…' : 'Confirm'}
                        </button>
                      )}
                      {canCheckIn && (
                        <button
                          type="button"
                          onClick={() => void handleStatusAction(e.booking.id, 'check-in')}
                          disabled={isActing}
                          title="Check the customer in (marks in progress)."
                          className="px-2.5 py-1 rounded-lg text-[11px] font-semibold text-tone-surface bg-tone-sage hover:opacity-90 disabled:opacity-50 transition-opacity"
                        >
                          {isActing && acting?.action === 'check-in' ? '…' : 'Check In'}
                        </button>
                      )}
                      {canCheckoutNow && (
                        <button
                          type="button"
                          onClick={() => setCheckoutBookingId(e.booking.id)}
                          disabled={isActing}
                          title="Take payment now (before service). Applies loyalty redemption and marks complete."
                          className="px-2.5 py-1 rounded-lg text-[11px] font-semibold text-tone-ink bg-tone-sage/15 hover:bg-tone-sage/30 border border-tone-sage/40 disabled:opacity-50 transition-colors"
                        >
                          Checkout Now
                        </button>
                      )}
                      {canComplete && (
                        <button
                          type="button"
                          onClick={() => setCheckoutBookingId(e.booking.id)}
                          disabled={isActing}
                          title="Take payment, optionally apply loyalty redemption, and mark complete."
                          className="px-2.5 py-1 rounded-lg text-[11px] font-semibold text-tone-surface bg-tone-ink hover:opacity-90 disabled:opacity-50 transition-opacity"
                        >
                          Complete
                        </button>
                      )}
                      {canNoShow && (
                        <button
                          type="button"
                          onClick={() => void handleStatusAction(e.booking.id, 'no-show')}
                          disabled={isActing}
                          className="px-2.5 py-1 rounded-lg text-[11px] font-medium text-semantic-danger border border-semantic-danger/30 hover:bg-semantic-danger/5 disabled:opacity-50 transition-colors"
                        >
                          {isActing && acting?.action === 'no-show' ? '…' : 'No-Show'}
                        </button>
                      )}
                      {canCancel && (
                        <button
                          type="button"
                          onClick={() => setCancelTarget({
                            bookingId: e.booking.id,
                            label: `${e.service.name} · ${new Date(e.booking.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} with ${e.staffMember.name}`,
                          })}
                          disabled={isActing}
                          title="Cancel this appointment on behalf of the customer"
                          className="px-2.5 py-1 rounded-lg text-[11px] font-medium text-semantic-danger border border-semantic-danger/30 hover:bg-semantic-danger/5 disabled:opacity-50 transition-colors"
                        >
                          Cancel
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
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

      {/* ── Clinical Records ── */}
      <div className="bg-tone-surface rounded-xl border border-grey-15 p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-tone-ink">Clinical Records</h2>
          {!clinicalRecordsForbidden && (
            <div className="flex items-center gap-3 print:hidden">
              <div className="text-right">
                <button
                  onClick={() => { void handleExport(); }}
                  disabled={exporting}
                  className="text-xs font-medium text-grey-60 hover:text-tone-ink transition-colors disabled:opacity-50"
                  title="Download this client's full record as JSON. Provide on request per PDPA right of access."
                >
                  {exporting ? 'Exporting...' : 'Export client data (PDPA)'}
                </button>
                <p className="text-[10px] text-grey-45 mt-0.5">Download full record as JSON on PDPA right-of-access request</p>
              </div>
              <button
                onClick={() => { if (showNewRecordForm) resetNewRecordForm(); else setShowNewRecordForm(true); }}
                className="text-xs font-medium text-tone-sage hover:text-tone-sage transition-colors"
              >
                {showNewRecordForm ? 'Cancel' : '+ New Clinical Record'}
              </button>
            </div>
          )}
        </div>

        {clinicalRecordsForbidden ? (
          <p className="text-xs text-grey-45 italic">Clinical records are gated to owner / manager.</p>
        ) : (
          <>
            {/* New record form */}
            {showNewRecordForm && (
              <div className="mb-4 space-y-2 rounded-lg bg-grey-5 border border-grey-15 p-3">
                <div className="flex gap-2">
                  <div className="flex-1">
                    <label className="block text-[11px] font-medium text-grey-75 mb-1">Type</label>
                    <select
                      value={newRecordType}
                      onChange={e => setNewRecordType(e.target.value as ClinicalRecordType)}
                      className="w-full border border-grey-15 rounded-lg px-3 py-2 text-sm text-grey-90 bg-tone-surface focus:outline-none focus:ring-1 focus:ring-tone-sage/30"
                    >
                      <option value="consultation_note">Consultation Note</option>
                      <option value="treatment_log">Treatment Log</option>
                      <option value="prescription">Prescription</option>
                    </select>
                  </div>
                  <div className="flex-1">
                    <label className="block text-[11px] font-medium text-grey-75 mb-1">Title (optional)</label>
                    <input
                      type="text"
                      value={newRecordTitle}
                      onChange={e => setNewRecordTitle(e.target.value)}
                      placeholder="e.g. Botox 30u forehead"
                      className="w-full border border-grey-15 rounded-lg px-3 py-2 text-sm text-grey-90 bg-tone-surface focus:outline-none focus:ring-1 focus:ring-tone-sage/30"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-grey-75 mb-1">Record body</label>
                  <textarea
                    value={newRecordBody}
                    onChange={e => setNewRecordBody(e.target.value)}
                    rows={4}
                    placeholder="Clinical observations, treatment details, dosage, areas treated..."
                    className="w-full border border-grey-15 rounded-lg px-3 py-2 text-sm text-grey-90 focus:outline-none focus:ring-1 focus:ring-tone-sage/30 resize-none"
                    autoFocus
                  />
                </div>

                {/* Photo staging zone */}
                <div className="space-y-2">
                  <label className="block text-[11px] font-medium text-grey-75">
                    Photos <span className="font-normal text-grey-45">(optional — drag in or use the picker; before/after/other tags applied per photo)</span>
                  </label>

                  <div
                    onDragEnter={(e) => { e.preventDefault(); setDragActive(true); }}
                    onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
                    onDragLeave={() => setDragActive(false)}
                    onDrop={(e) => {
                      e.preventDefault();
                      setDragActive(false);
                      const files = Array.from(e.dataTransfer.files).filter(f => /^image\/(jpe?g|png|webp)$/.test(f.type));
                      stagePhotos(files);
                    }}
                    className={`border-2 border-dashed rounded-lg p-4 text-center transition-colors ${
                      dragActive ? 'border-tone-sage bg-tone-sage/5' : 'border-grey-15 bg-grey-5'
                    }`}
                  >
                    <p className="text-xs text-grey-60">
                      {stagedPhotos.length === 0 ? 'Drag images here, or' : `${stagedPhotos.length} photo${stagedPhotos.length === 1 ? '' : 's'} staged. Drop more, or`}
                    </p>
                    <label className="inline-block mt-1 cursor-pointer">
                      <input
                        type="file"
                        multiple
                        accept="image/jpeg,image/png,image/webp"
                        className="hidden"
                        onChange={(e) => stagePhotos(Array.from(e.target.files ?? []))}
                      />
                      <span className="text-xs font-medium text-tone-sage hover:text-tone-ink underline">
                        choose from your computer
                      </span>
                    </label>
                  </div>

                  {/* Staged thumbnails */}
                  {stagedPhotos.length > 0 && (
                    <div className="grid grid-cols-3 gap-2">
                      {stagedPhotos.map(p => (
                        <div key={p.id} className="relative group bg-tone-surface rounded-md border border-grey-15 overflow-hidden">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={p.previewUrl} alt="" className="w-full h-24 object-cover" />
                          <select
                            value={p.kind}
                            onChange={(e) => setStagedPhotos(curr => curr.map(x => x.id === p.id ? { ...x, kind: e.target.value as StagedPhoto['kind'] } : x))}
                            className="w-full text-[10px] py-0.5 px-1 border-t border-grey-10 bg-tone-surface text-grey-75 focus:outline-none"
                          >
                            <option value="before">Before</option>
                            <option value="after">After</option>
                            <option value="other">Other</option>
                          </select>
                          <button
                            type="button"
                            onClick={() => removeStagedPhoto(p.id)}
                            className="absolute top-1 right-1 p-1 rounded-full bg-tone-ink/70 text-tone-surface opacity-0 group-hover:opacity-100 transition-opacity text-[10px]"
                            title="Remove"
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* PDPA consent */}
                {stagedPhotos.length > 0 && (
                  <label className="flex items-start gap-2 p-3 rounded-lg bg-semantic-warn/5 border border-semantic-warn/30 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={photoConsent}
                      onChange={(e) => setPhotoConsent(e.target.checked)}
                      className="mt-0.5 flex-shrink-0"
                    />
                    <span className="text-xs text-grey-75 leading-relaxed">
                      <strong className="text-tone-ink">PDPA consent.</strong> I confirm the client has given verbal or written consent to capture and store these photos as part of their treatment record under this clinic's privacy policy. Consent acknowledgement is logged with this record.
                    </span>
                  </label>
                )}

                <div className="flex gap-2">
                  <button
                    onClick={handleCreateClinicalRecord}
                    disabled={!newRecordBody.trim() || savingRecord || (stagedPhotos.length > 0 && !photoConsent)}
                    className="px-4 py-1.5 bg-tone-ink text-white text-xs font-medium rounded-lg hover:opacity-90 disabled:opacity-50 transition-colors"
                  >
                    {savingRecord ? 'Saving...' : 'Save Record'}
                  </button>
                  <button
                    onClick={resetNewRecordForm}
                    className="px-4 py-1.5 bg-grey-15 text-grey-75 text-xs font-medium rounded-lg hover:bg-grey-15 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* Record feed */}
            {clinicalRecords.length === 0 && !showNewRecordForm ? (
              <p className="text-xs text-grey-45 italic">No clinical records yet. Create the first one above.</p>
            ) : (
              <div className="space-y-3 max-h-[480px] overflow-y-auto">
                {clinicalRecords.map(record => {
                  const typeLabel: Record<string, string> = {
                    consultation_note: 'Consultation',
                    treatment_log: 'Treatment',
                    prescription: 'Prescription',
                    amendment: 'Amendment',
                  };
                  const isAmending = amendingRecordId === record.id;
                  const isLocked = Boolean(record.lockedAt);
                  const attachments = record.attachments ?? [];
                  const isShowingPhotoUpload = showPhotoUpload === record.id;
                  const isShowingConsentForm = showConsentForm === record.id;
                  const kindLabel = { before: 'Before', after: 'After', other: 'Other' };
                  return (
                    <div key={record.id} className="border-l-2 border-tone-sage/30 pl-3 py-1">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[10px] font-semibold uppercase tracking-wide text-tone-sage">
                            {typeLabel[record.type] ?? record.type}
                          </span>
                          {record.title && (
                            <span className="text-xs font-semibold text-grey-75">{record.title}</span>
                          )}
                          {record.amendsId && (
                            <span className="text-[10px] text-grey-45 italic">amended</span>
                          )}
                          {isLocked && (
                            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-grey-15 text-grey-60 uppercase tracking-wide">
                              Locked
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-[10px] text-grey-45">
                            {new Date(record.createdAt).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' })}
                            {' '}
                            {new Date(record.createdAt).toLocaleTimeString('en-SG', { hour: '2-digit', minute: '2-digit' })}
                          </span>
                          {!isAmending && !isLocked && (
                            <button
                              onClick={() => startAmend(record)}
                              className="text-[10px] text-tone-sage hover:underline print:hidden"
                            >
                              Amend
                            </button>
                          )}
                        </div>
                      </div>
                      <p className="text-[11px] text-grey-45 mt-0.5">{record.recordedByName}</p>
                      <p className="text-xs text-grey-75 mt-1 leading-relaxed whitespace-pre-wrap">{record.body}</p>
                      {record.amendmentReason && (
                        <p className="text-[10px] text-grey-45 italic mt-1">Reason: {record.amendmentReason}</p>
                      )}

                      {/* ── Photo gallery ── */}
                      {attachments.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {attachments.map(att => (
                            <div key={att.id} className="relative group">
                              <PrivatePhoto
                                proxyPath={`/merchant/clients/${profileId}/clinical-records/${record.id}/photos/${att.id}`}
                                alt={att.name}
                                className="w-20 h-20 object-cover rounded-lg border border-grey-15 cursor-pointer"
                                onClick={() => setLightbox({ recordId: record.id, attachmentId: att.id, alt: att.name })}
                              />
                              <span className="absolute top-1 left-1 text-[9px] font-semibold px-1 py-0.5 rounded bg-tone-ink/70 text-white uppercase tracking-wide">
                                {kindLabel[att.kind as keyof typeof kindLabel] ?? att.kind}
                              </span>
                              {!isLocked && (
                                <button
                                  type="button"
                                  onClick={() => handleDeletePhoto(record.id, att.id)}
                                  className="absolute top-1 right-1 w-4 h-4 rounded-full bg-semantic-danger text-white text-[10px] font-bold hidden group-hover:flex items-center justify-center print:hidden"
                                  title="Delete photo"
                                >
                                  x
                                </button>
                              )}
                            </div>
                          ))}
                        </div>
                      )}

                      {/* ── Photo upload form ── */}
                      {!isLocked && (
                        <div className="mt-2 print:hidden">
                          {!isShowingPhotoUpload ? (
                            <button
                              type="button"
                              onClick={() => { setShowPhotoUpload(record.id); setPhotoFile(null); setPhotoKind('other'); }}
                              className="text-[11px] text-tone-sage hover:underline"
                            >
                              + Add Photo
                            </button>
                          ) : (
                            <div className="mt-1 space-y-2 rounded-lg bg-grey-5 border border-grey-15 p-3">
                              <p className="text-[11px] font-medium text-grey-75">Add photo</p>
                              <input
                                type="file"
                                accept="image/jpeg,image/png,image/webp"
                                onChange={e => setPhotoFile(e.target.files?.[0] ?? null)}
                                className="text-xs text-grey-75 w-full"
                              />
                              <select
                                value={photoKind}
                                onChange={e => setPhotoKind(e.target.value as 'before' | 'after' | 'other')}
                                className="w-full border border-grey-15 rounded-lg px-3 py-1.5 text-xs text-grey-90 bg-tone-surface focus:outline-none focus:ring-1 focus:ring-tone-sage/30"
                              >
                                <option value="before">Before</option>
                                <option value="after">After</option>
                                <option value="other">Other</option>
                              </select>
                              <div className="flex gap-2">
                                <button
                                  type="button"
                                  onClick={() => handleUploadPhoto(record.id)}
                                  disabled={!photoFile || uploadingPhoto}
                                  className="px-3 py-1 bg-tone-ink text-white text-xs font-medium rounded-lg hover:opacity-90 disabled:opacity-50 transition-colors"
                                >
                                  {uploadingPhoto ? 'Uploading...' : 'Upload'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => { setShowPhotoUpload(null); setPhotoFile(null); }}
                                  className="px-3 py-1 bg-grey-15 text-grey-75 text-xs font-medium rounded-lg hover:bg-grey-15 transition-colors"
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      {/* ── Signed consent display ── */}
                      {record.signedConsent && (
                        <div className="mt-2 rounded-lg bg-grey-5 border border-grey-15 p-3 space-y-1">
                          <p className="text-[10px] font-semibold uppercase tracking-wide text-grey-60">Consent Signed</p>
                          <p className="text-xs text-grey-75">
                            Signed by <span className="font-semibold">{record.signedConsent.signerName}</span>
                            {' '}at {new Date(record.signedConsent.signedAt).toLocaleString('en-SG', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                          </p>
                          {(record.signedConsent.signaturePathname || record.signedConsent.signatureUrl) && (
                            <PrivatePhoto
                              proxyPath={`/merchant/clients/${profileId}/clinical-records/${record.id}/consent-signature`}
                              alt="Client signature"
                              className="mt-1 border border-grey-15 rounded-md bg-tone-surface max-h-24 w-full object-contain"
                            />
                          )}
                        </div>
                      )}

                      {/* ── Add Consent Form button ── */}
                      {!record.signedConsent && !isLocked && (
                        <div className="mt-2 print:hidden">
                          {!isShowingConsentForm ? (
                            <button
                              type="button"
                              onClick={() => openConsentForm(record)}
                              className="text-[11px] text-tone-sage hover:underline"
                            >
                              Add Consent Form
                            </button>
                          ) : (
                            <div className="mt-1 space-y-3 rounded-lg bg-grey-5 border border-grey-15 p-3">
                              <p className="text-[11px] font-medium text-grey-75">Consent Form</p>
                              <textarea
                                value={consentFormText}
                                onChange={e => setConsentFormText(e.target.value)}
                                rows={4}
                                className="w-full border border-grey-15 rounded-lg px-3 py-2 text-xs text-grey-90 bg-tone-surface focus:outline-none focus:ring-1 focus:ring-tone-sage/30 resize-none"
                                placeholder="Consent statement..."
                              />
                              <input
                                type="text"
                                value={consentSignerName}
                                onChange={e => setConsentSignerName(e.target.value)}
                                placeholder="Signer name (client full name)"
                                className="w-full border border-grey-15 rounded-lg px-3 py-2 text-xs text-grey-90 bg-tone-surface focus:outline-none focus:ring-1 focus:ring-tone-sage/30"
                              />
                              <div>
                                <p className="text-[11px] font-medium text-grey-75 mb-1">Signature</p>
                                <SignaturePad onChange={setConsentSignatureDataUrl} />
                              </div>
                              <div className="flex gap-2">
                                <button
                                  type="button"
                                  onClick={() => handleSubmitConsent(record.id)}
                                  disabled={!consentSignatureDataUrl || !consentSignerName.trim() || submittingConsent}
                                  className="px-3 py-1 bg-tone-ink text-white text-xs font-medium rounded-lg hover:opacity-90 disabled:opacity-50 transition-colors"
                                >
                                  {submittingConsent ? 'Submitting...' : 'Submit & Lock Record'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setShowConsentForm(null)}
                                  className="px-3 py-1 bg-grey-15 text-grey-75 text-xs font-medium rounded-lg hover:bg-grey-15 transition-colors"
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Inline amend form */}
                      {isAmending && (
                        <div className="mt-2 space-y-2 rounded-lg bg-grey-5 border border-grey-15 p-3">
                          <p className="text-[11px] font-medium text-grey-75">Amend this record</p>
                          <input
                            type="text"
                            value={amendTitle}
                            onChange={e => setAmendTitle(e.target.value)}
                            placeholder="Title (optional)"
                            className="w-full border border-grey-15 rounded-lg px-3 py-2 text-sm text-grey-90 bg-tone-surface focus:outline-none focus:ring-1 focus:ring-tone-sage/30"
                          />
                          <textarea
                            value={amendBody}
                            onChange={e => setAmendBody(e.target.value)}
                            rows={4}
                            className="w-full border border-grey-15 rounded-lg px-3 py-2 text-sm text-grey-90 focus:outline-none focus:ring-1 focus:ring-tone-sage/30 resize-none"
                          />
                          <textarea
                            value={amendReason}
                            onChange={e => setAmendReason(e.target.value)}
                            rows={2}
                            placeholder="Reason for amendment (required)"
                            className="w-full border border-grey-15 rounded-lg px-3 py-2 text-sm text-grey-90 focus:outline-none focus:ring-1 focus:ring-tone-sage/30 resize-none"
                          />
                          <div className="flex gap-2">
                            <button
                              onClick={handleAmendRecord}
                              disabled={!amendBody.trim() || !amendReason.trim() || savingAmend}
                              className="px-4 py-1.5 bg-tone-ink text-white text-xs font-medium rounded-lg hover:opacity-90 disabled:opacity-50 transition-colors"
                            >
                              {savingAmend ? 'Saving...' : 'Save Amendment'}
                            </button>
                            <button
                              onClick={cancelAmend}
                              className="px-4 py-1.5 bg-grey-15 text-grey-75 text-xs font-medium rounded-lg hover:bg-grey-15 transition-colors"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Audit log disclosure */}
            <div className="mt-4 pt-3 border-t border-grey-5">
              <button
                onClick={loadAuditLog}
                className="text-[11px] text-grey-45 hover:text-grey-75 transition-colors"
              >
                {showAuditLog ? 'Hide audit log' : 'Show audit log'}
              </button>
              {showAuditLog && (
                <div className="mt-2">
                  {auditLoading ? (
                    <p className="text-[11px] text-grey-45">Loading...</p>
                  ) : auditEntries.length === 0 ? (
                    <p className="text-[11px] text-grey-45 italic">No audit entries yet.</p>
                  ) : (
                    <ul className="space-y-1 max-h-48 overflow-y-auto">
                      {auditEntries.slice(0, 50).map(entry => (
                        <li key={entry.id} className="text-[11px] text-grey-60 flex items-center gap-2">
                          <span className={`font-medium ${entry.action === 'amend' ? 'text-semantic-warn' : 'text-grey-75'}`}>{entry.action}</span>
                          <span>·</span>
                          <span>{entry.userEmail}</span>
                          <span>·</span>
                          <span>{new Date(entry.createdAt).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' })} {new Date(entry.createdAt).toLocaleTimeString('en-SG', { hour: '2-digit', minute: '2-digit' })}</span>
                          {entry.ipAddress && <span className="text-grey-30">· {entry.ipAddress}</span>}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* ── Dental Odontogram (MDC 2024) ──
          Self-hides for non-dental merchants via 403 from the API.
          parentRecordId is filtered to **today's** non-locked records
          only — yesterday's record carrying over would cause the next
          save to overwrite yesterday's chart in place, destroying the
          per-visit snapshot. Tomorrow's first save lands with no
          parentRecordId, so the API auto-creates a new treatment_log
          row and a new odontogram, preserving the historical chain.
          The callback refreshes our local clinical-records list so
          the auto-created visit appears in the timeline immediately. */}
      {!clinicalRecordsForbidden && (
        <Odontogram
          profileId={profileId}
          parentRecordId={clinicalRecords.find((r) => {
            if (r.lockedAt || r.type === 'amendment') return false;
            // Only consider records created today (local time). Tomorrow's
            // first save then auto-creates a fresh visit record.
            const recordDate = new Date(r.createdAt);
            const today = new Date();
            return (
              recordDate.getFullYear() === today.getFullYear() &&
              recordDate.getMonth() === today.getMonth() &&
              recordDate.getDate() === today.getDate()
            );
          })?.id}
          canEdit={true}
          onAutoCreatedParentRecord={() => { void refreshClinicalRecords(); }}
        />
      )}

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

      {/* ── Loyalty Points section ── */}
      <div className="bg-tone-surface rounded-xl border border-grey-15 p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-tone-ink">Loyalty Points</h2>
          <button
            type="button"
            onClick={() => void refetchLoyalty()}
            className="flex items-center gap-1 text-xs text-grey-60 hover:text-tone-ink underline-offset-2 hover:underline print:hidden"
            aria-label="Refresh loyalty"
            title="Refresh"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" />
            </svg>
            Refresh
          </button>
        </div>

        {loyaltyLoading && <p className="text-sm text-grey-50">Loading…</p>}
        {loyaltyError && <p className="text-sm state-danger">{loyaltyError}</p>}

        {!loyaltyLoading && !loyaltyError && loyaltyProgram && !loyaltyProgram.enabled && (
          <div className="text-sm text-grey-60">
            Loyalty program not enabled.{' '}
            <a href="/dashboard/marketing/loyalty" className="text-tone-sage underline hover:opacity-80">
              Configure it here
            </a>
          </div>
        )}

        {!loyaltyLoading && !loyaltyError && loyaltyProgram?.enabled && (
          <div className="space-y-4">
            {/* Balance card */}
            <div className="bg-grey-5 rounded-xl p-4 flex items-center justify-between">
              <div>
                <p className="text-3xl font-bold text-tone-ink leading-none">
                  {loyaltyBalance ?? 0}
                </p>
                <p className="text-xs text-grey-50 mt-1">points balance</p>
              </div>
              <div className="text-right text-xs text-grey-50 space-y-0.5">
                <p>{loyaltyProgram.pointsPerDollar} pt / SGD spent</p>
                {loyaltyProgram.pointsPerVisit > 0 && (
                  <p>+ {loyaltyProgram.pointsPerVisit} pt / visit</p>
                )}
                <p>{loyaltyProgram.pointsPerDollarRedeem} pts = SGD 1 off</p>
              </div>
            </div>

            {/* Action buttons */}
            <div className="flex gap-2 print:hidden">
              <button
                type="button"
                onClick={() => { setShowAdjust((v) => !v); setShowRedeem(false); }}
                className="px-3 py-1.5 border border-grey-20 bg-tone-surface text-grey-75 text-sm font-medium rounded-lg hover:bg-grey-5 transition-colors"
              >
                Adjust
              </button>
              <button
                type="button"
                onClick={() => { setShowRedeem((v) => !v); setShowAdjust(false); }}
                className="px-3 py-1.5 border border-grey-20 bg-tone-surface text-grey-75 text-sm font-medium rounded-lg hover:bg-grey-5 transition-colors"
              >
                Redeem
              </button>
            </div>

            {/* Adjust inline form */}
            {showAdjust && (
              <div className="rounded-lg border border-grey-15 bg-grey-5 p-4 space-y-3 print:hidden">
                <p className="text-xs font-semibold text-grey-75 uppercase tracking-wider">Manual adjust</p>
                <div className="flex items-center gap-3">
                  <label className="text-sm text-grey-70 w-24 flex-shrink-0">Amount</label>
                  <input
                    type="number"
                    value={adjustAmount}
                    onChange={(e) => setAdjustAmount(e.target.value)}
                    placeholder="e.g. 50 or -50"
                    className="w-32 px-3 py-1.5 border border-grey-20 rounded-lg text-sm bg-tone-surface focus:outline-none focus:border-tone-ink"
                  />
                  <span className="text-xs text-grey-45">positive = credit, negative = debit</span>
                </div>
                <div className="flex items-start gap-3">
                  <label className="text-sm text-grey-70 w-24 flex-shrink-0 pt-1">Reason</label>
                  <input
                    type="text"
                    value={adjustReason}
                    onChange={(e) => setAdjustReason(e.target.value)}
                    placeholder="Reason (required)"
                    className="flex-1 px-3 py-1.5 border border-grey-20 rounded-lg text-sm bg-tone-surface focus:outline-none focus:border-tone-ink"
                  />
                </div>
                {adjustError && <p className="text-xs state-danger">{adjustError}</p>}
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={adjusting}
                    onClick={async () => {
                      const amt = parseInt(adjustAmount, 10);
                      if (Number.isNaN(amt) || amt === 0) {
                        setAdjustError('Amount must be a non-zero integer');
                        return;
                      }
                      if (!adjustReason.trim()) {
                        setAdjustError('Reason is required');
                        return;
                      }
                      setAdjusting(true);
                      setAdjustError(null);
                      try {
                        await apiFetch(`/merchant/clients/${profileId}/loyalty/adjust`, {
                          method: 'POST',
                          body: JSON.stringify({ amount: amt, reason: adjustReason.trim() }),
                        });
                        setShowAdjust(false);
                        setAdjustAmount('');
                        setAdjustReason('');
                        await refetchLoyalty();
                      } catch (err) {
                        setAdjustError(err instanceof Error ? err.message : 'Adjust failed');
                      } finally {
                        setAdjusting(false);
                      }
                    }}
                    className="px-4 py-1.5 bg-tone-ink text-tone-surface text-sm font-medium rounded-lg hover:opacity-90 disabled:opacity-50"
                  >
                    {adjusting ? 'Saving…' : 'Apply'}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setShowAdjust(false); setAdjustError(null); }}
                    className="px-3 py-1.5 border border-grey-20 text-grey-60 text-sm rounded-lg hover:bg-grey-5"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* Redeem inline form */}
            {showRedeem && (
              <div className="rounded-lg border border-grey-15 bg-grey-5 p-4 space-y-3 print:hidden">
                <p className="text-xs font-semibold text-grey-75 uppercase tracking-wider">Redeem points</p>
                <div className="flex items-center gap-3">
                  <label className="text-sm text-grey-70 w-24 flex-shrink-0">Points</label>
                  <input
                    type="number"
                    min={loyaltyProgram.minRedeemPoints}
                    max={loyaltyBalance ?? 0}
                    value={redeemPoints}
                    onChange={(e) => setRedeemPoints(e.target.value)}
                    placeholder={`min ${loyaltyProgram.minRedeemPoints}`}
                    className="w-28 px-3 py-1.5 border border-grey-20 rounded-lg text-sm bg-tone-surface focus:outline-none focus:border-tone-ink"
                  />
                  {redeemPoints && !Number.isNaN(parseInt(redeemPoints, 10)) && (
                    <span className="text-xs text-grey-60">
                      = SGD {(parseInt(redeemPoints, 10) / loyaltyProgram.pointsPerDollarRedeem).toFixed(2)} off
                    </span>
                  )}
                </div>
                <p className="text-xs text-grey-45">
                  Balance: {loyaltyBalance ?? 0} pts · Min redeem: {loyaltyProgram.minRedeemPoints} pts
                </p>
                {redeemError && <p className="text-xs state-danger">{redeemError}</p>}
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={redeeming}
                    onClick={async () => {
                      const pts = parseInt(redeemPoints, 10);
                      if (Number.isNaN(pts) || pts <= 0) {
                        setRedeemError('Enter a valid number of points');
                        return;
                      }
                      setRedeeming(true);
                      setRedeemError(null);
                      try {
                        await apiFetch(`/merchant/clients/${profileId}/loyalty/redeem`, {
                          method: 'POST',
                          body: JSON.stringify({ points: pts }),
                        });
                        setShowRedeem(false);
                        setRedeemPoints('');
                        await refetchLoyalty();
                      } catch (err) {
                        setRedeemError(err instanceof Error ? err.message : 'Redeem failed');
                      } finally {
                        setRedeeming(false);
                      }
                    }}
                    className="px-4 py-1.5 bg-tone-ink text-tone-surface text-sm font-medium rounded-lg hover:opacity-90 disabled:opacity-50"
                  >
                    {redeeming ? 'Redeeming…' : 'Redeem'}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setShowRedeem(false); setRedeemError(null); }}
                    className="px-3 py-1.5 border border-grey-20 text-grey-60 text-sm rounded-lg hover:bg-grey-5"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* Recent transactions */}
            {loyaltyTransactionsData.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-grey-70 uppercase tracking-wider mb-2">Recent transactions</p>
                <div className="space-y-0">
                  {loyaltyTransactionsData.slice(0, 10).map((tx) => (
                    <div key={tx.id} className="flex items-start justify-between py-2 border-b border-grey-5 last:border-0">
                      <div className="min-w-0 flex-1">
                        <span className={`text-xs font-medium uppercase tracking-wide mr-2 ${
                          tx.kind === 'earn' ? 'text-tone-sage' :
                          tx.kind === 'redeem' ? 'text-grey-60' :
                          tx.kind === 'adjust' ? 'text-grey-75' :
                          'text-semantic-warn'
                        }`}>
                          {tx.kind}
                        </span>
                        <span className="text-xs text-grey-60 truncate">
                          {tx.reason ?? '—'}
                          {tx.actorName && <span className="text-grey-40"> · {tx.actorName}</span>}
                        </span>
                      </div>
                      <div className="text-right ml-3 flex-shrink-0">
                        <span className={`text-sm font-semibold ${tx.amount >= 0 ? 'text-tone-ink' : 'text-grey-60'}`}>
                          {tx.amount >= 0 ? '+' : ''}{tx.amount}
                        </span>
                        <p className="text-[10px] text-grey-40">
                          {new Date(tx.createdAt).toLocaleDateString('en-SG', { day: 'numeric', month: 'short' })}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {loyaltyTransactionsData.length === 0 && (
              <p className="text-xs text-grey-45 italic">No transactions yet.</p>
            )}
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

      {/* ── Private photo lightbox ── */}
      {lightbox && (
        <div
          className="fixed inset-0 z-50 bg-tone-ink/80 flex items-center justify-center p-4 print:hidden"
          onClick={() => setLightbox(null)}
        >
          <PrivatePhoto
            proxyPath={`/merchant/clients/${profileId}/clinical-records/${lightbox.recordId}/photos/${lightbox.attachmentId}`}
            alt={lightbox.alt}
            className="max-w-full max-h-full object-contain"
          />
        </div>
      )}

      {showNewBooking && data && (
        <BookingForm
          mode="create"
          intent="prebook"
          prefilledClient={{
            name: data.client.name ?? '',
            phone: data.client.phone,
          }}
          onClose={() => setShowNewBooking(false)}
          onSave={() => {
            // Booking is created in `pending` status. Loyalty redemption is
            // intentionally NOT applied here — it belongs at check-in, when
            // the client returns for treatment, so the staff can apply
            // against the freshest balance and discounts can't outlive a
            // cancelled appointment.
            setShowNewBooking(false);
            void apiFetch(`/merchant/clients/${profileId}`)
              .then((d: unknown) => setData(d as ClientDetailData))
              .catch(() => {});
          }}
        />
      )}

      {checkoutBookingId && (
        <CheckoutModal
          bookingId={checkoutBookingId}
          onClose={() => setCheckoutBookingId(null)}
          onComplete={() => {
            setCheckoutBookingId(null);
            void refetchClientData();
            void refetchLoyalty();
          }}
        />
      )}

      {cancelTarget && (
        <CancelBookingDialog
          bookingId={cancelTarget.bookingId}
          bookingLabel={cancelTarget.label}
          onClose={() => setCancelTarget(null)}
          onCancelled={(result) => {
            setCancelTarget(null);
            alert(`Booking cancelled. ${describeRefund(result)}`);
            void refetchClientData();
          }}
        />
      )}

    </div>
  );
}

// ─── Signature pad ─────────────────────────────────────────────────────────────

function SignaturePad({ onChange }: { onChange: (dataUrl: string | null) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);

  function start(e: React.PointerEvent) {
    drawing.current = true;
    const rect = canvasRef.current!.getBoundingClientRect();
    last.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }
  function move(e: React.PointerEvent) {
    if (!drawing.current || !last.current) return;
    const ctx = canvasRef.current!.getContext('2d')!;
    const rect = canvasRef.current!.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#1a2313';
    ctx.beginPath();
    ctx.moveTo(last.current.x, last.current.y);
    ctx.lineTo(x, y);
    ctx.stroke();
    last.current = { x, y };
  }
  function end() {
    drawing.current = false;
    last.current = null;
    onChange(canvasRef.current!.toDataURL('image/png'));
  }
  function clear() {
    const ctx = canvasRef.current!.getContext('2d')!;
    ctx.clearRect(0, 0, canvasRef.current!.width, canvasRef.current!.height);
    onChange(null);
  }

  return (
    <div>
      <canvas
        ref={canvasRef}
        width={400}
        height={150}
        className="border border-grey-15 rounded-md bg-tone-surface w-full touch-none"
        style={{ touchAction: 'none' }}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerLeave={end}
      />
      <div className="flex justify-between mt-2">
        <button type="button" onClick={clear} className="text-xs text-grey-60 hover:text-tone-ink underline">
          Clear
        </button>
      </div>
    </div>
  );
}

// ─── BirthdayField — inline edit for a client's birthday ────────────────────
// Captures Month + Day only (year is irrelevant for birthday automation and
// is more privacy-friendly to omit). The existing date column is reused: we
// store the value as `2000-MM-DD`, a sentinel year that the automation worker
// strips when matching today's MM-DD.
const MONTHS = [
  { value: '01', label: 'Jan' }, { value: '02', label: 'Feb' }, { value: '03', label: 'Mar' },
  { value: '04', label: 'Apr' }, { value: '05', label: 'May' }, { value: '06', label: 'Jun' },
  { value: '07', label: 'Jul' }, { value: '08', label: 'Aug' }, { value: '09', label: 'Sep' },
  { value: '10', label: 'Oct' }, { value: '11', label: 'Nov' }, { value: '12', label: 'Dec' },
];

function daysInMonth(monthMM: string): number {
  const m = Number(monthMM);
  if (m === 2) return 29; // allow Feb 29 — leap-year birthdays valid every 4 years
  return [4, 6, 9, 11].includes(m) ? 30 : 31;
}

function monthDayLabel(iso: string): string {
  // iso is YYYY-MM-DD; we only render Month + Day.
  const [, mm, dd] = iso.split('-');
  const month = MONTHS.find((x) => x.value === mm)?.label ?? mm;
  return `${month} ${Number(dd)}`;
}

function BirthdayField({ profileId, initialValue }: { profileId: string; initialValue: string | null }) {
  const [value, setValue] = useState<string | null>(initialValue);
  const [editing, setEditing] = useState(false);
  const initialMM = initialValue ? initialValue.slice(5, 7) : '';
  const initialDD = initialValue ? initialValue.slice(8, 10) : '';
  const [month, setMonth] = useState<string>(initialMM);
  const [day, setDay] = useState<string>(initialDD);
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!month || !day) return;
    const isoSentinel = `2000-${month}-${day.padStart(2, '0')}`;
    setSaving(true);
    try {
      await apiFetch(`/merchant/clients/${profileId}/notes`, {
        method: 'PUT',
        body: JSON.stringify({ birthday: isoSentinel }),
      });
      setValue(isoSentinel);
      setEditing(false);
    } catch {
      alert('Failed to save birthday');
    } finally {
      setSaving(false);
    }
  }

  const cakeIcon = (
    <svg className="w-4 h-4 text-grey-45" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M12 8.25v-1.5m0 1.5c-1.355 0-2.697.056-4.024.166C6.845 8.51 6 9.473 6 10.608v2.513m6-4.871c1.355 0 2.697.056 4.024.166C17.155 8.51 18 9.473 18 10.608v2.513M15 21H3v-1a6 6 0 0 1 12 0v1Zm0 0h6v-1a6 6 0 0 0-9-5.197M13.5 7a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Z"/></svg>
  );

  if (editing) {
    const maxDay = month ? daysInMonth(month) : 31;
    const validDay = day && Number(day) <= maxDay ? day : '';
    return (
      <div className="flex items-center gap-1.5 text-sm text-grey-75 print:hidden flex-wrap">
        {cakeIcon}
        <select
          value={month}
          onChange={(e) => { setMonth(e.target.value); if (Number(day) > daysInMonth(e.target.value)) setDay(''); }}
          className="border border-grey-15 rounded px-2 py-0.5 text-sm focus:outline-none focus:ring-1 focus:ring-tone-sage/50"
        >
          <option value="">Month</option>
          {MONTHS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
        </select>
        <select
          value={validDay}
          onChange={(e) => setDay(e.target.value)}
          disabled={!month}
          className="border border-grey-15 rounded px-2 py-0.5 text-sm focus:outline-none focus:ring-1 focus:ring-tone-sage/50 disabled:opacity-50"
        >
          <option value="">Day</option>
          {Array.from({ length: maxDay }, (_, i) => String(i + 1).padStart(2, '0')).map((d) => (
            <option key={d} value={d}>{Number(d)}</option>
          ))}
        </select>
        <button onClick={save} disabled={!month || !validDay || saving} className="text-xs text-tone-sage hover:text-tone-ink font-medium disabled:opacity-50">
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button onClick={() => { setEditing(false); setMonth(initialMM); setDay(initialDD); }} className="text-xs text-grey-60 hover:text-tone-ink">Cancel</button>
      </div>
    );
  }

  if (value) {
    return (
      <div className="flex items-center gap-1.5 text-sm text-grey-75">
        {cakeIcon}
        <span>{monthDayLabel(value)}</span>
        <button onClick={() => setEditing(true)} className="text-xs text-grey-60 hover:text-tone-ink underline print:hidden">Edit</button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className="flex items-center gap-1.5 text-sm text-tone-sage hover:text-tone-ink print:hidden"
    >
      {cakeIcon}
      + Add birthday
    </button>
  );
}
