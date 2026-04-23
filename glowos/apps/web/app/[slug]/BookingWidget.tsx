'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch } from '../lib/api';
import { loadStripe, type Stripe } from '@stripe/stripe-js';
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { OTPVerificationCard } from './components/OTPVerificationCard';
import { ReturningCustomerCard } from './components/ReturningCustomerCard';
import { JoinWaitlistCard } from './components/JoinWaitlistCard';

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: {
            client_id: string;
            callback: (response: { credential: string }) => void;
            auto_select?: boolean;
          }) => void;
          renderButton: (
            element: HTMLElement,
            config: {
              theme?: string;
              size?: string;
              width?: number;
              text?: string;
              shape?: string;
              logo_alignment?: string;
            }
          ) => void;
          prompt: () => void;
        };
      };
    };
  }
}

interface Service {
  id: string;
  name: string;
  description: string | null;
  durationMinutes: number;
  priceSgd: string;
  category: string;
  slotType: 'standard' | 'consult' | 'treatment';
  requiresConsultFirst: boolean;
  discountPct: number | null;
  discountShowOnline: boolean;
  firstTimerDiscountPct: number | null;
  firstTimerDiscountEnabled: boolean;
}

interface StaffMember {
  id: string;
  name: string;
  photoUrl: string | null;
  title: string | null;
  bio: string | null;
  specialtyTags: string[] | null;
  isAnyAvailable: boolean;
}

interface Merchant {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  logoUrl: string | null;
  coverPhotoUrl: string | null;
  phone: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  postalCode: string | null;
  timezone: string;
  paymentEnabled?: boolean;
  operatingHours?: Record<string, { open: string; close: string; closed: boolean }> | null;
}

interface TimeSlot {
  start_time: string;
  staff_id: string;
}

interface BookingWidgetProps {
  merchant: Merchant;
  services: Service[];
  staff: StaffMember[];
  slug: string;
  embedded?: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-SG', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

function formatDateFull(d: Date): string {
  return d.toLocaleDateString('en-SG', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

function next30Days(): Date[] {
  const days: Date[] = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  for (let i = 0; i < 30; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    days.push(d);
  }
  return days;
}

function toDateStr(d: Date): string {
  // Use local year/month/day to avoid timezone issues
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function padTwo(n: number): string {
  return String(n).padStart(2, '0');
}

// ── Step indicator ────────────────────────────────────────────────────────────

function StepBadge({ num, label, active, done }: { num: number; label: string; active: boolean; done: boolean }) {
  return (
    <div className={`flex items-center gap-2 text-sm ${active ? 'text-tone-sage font-semibold' : done ? 'text-tone-sage' : 'text-grey-45'}`}>
      <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold border-2 ${
        done ? 'bg-tone-sage border-tone-sage text-white' : active ? 'border-tone-ink text-tone-sage' : 'border-grey-30 text-grey-45'
      }`}>
        {done ? '✓' : num}
      </span>
      <span className="hidden sm:inline">{label}</span>
    </div>
  );
}

// ── Stripe Payment Form ──────────────────────────────────────────────────────

function StripePaymentForm({
  amount,
  returnUrl,
  onSuccess,
  onError,
  countdown,
}: {
  amount: string;
  returnUrl: string;
  onSuccess: (paymentIntentId: string) => void;
  onError: (msg: string) => void;
  countdown: number;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [processing, setProcessing] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!stripe || !elements) return;

    setProcessing(true);
    const result = await stripe.confirmPayment({
      elements,
      confirmParams: {
        // Used by redirect-based methods (GrabPay). Stripe appends
        // payment_intent, payment_intent_client_secret, and redirect_status.
        return_url: returnUrl,
      },
      redirect: 'if_required',
    });

    if (result.error) {
      onError(result.error.message ?? 'Payment failed');
      setProcessing(false);
    } else if (result.paymentIntent?.status === 'succeeded') {
      onSuccess(result.paymentIntent.id);
    } else if (result.paymentIntent?.status === 'processing') {
      // PayNow payments may remain in "processing" briefly after QR scan.
      // Redirect to the confirm page — the webhook finalises the booking.
      onSuccess(result.paymentIntent.id);
    } else {
      setProcessing(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <PaymentElement
        options={{
          layout: 'tabs',
        }}
      />
      <button
        type="submit"
        disabled={!stripe || processing || countdown === 0}
        className="w-full rounded-2xl bg-tone-ink py-4 text-base font-bold text-white hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed transition-all shadow-lg shadow-md active:scale-[0.98]"
      >
        {processing ? (
          <span className="flex items-center justify-center gap-2">
            <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
            Processing payment...
          </span>
        ) : countdown === 0 ? (
          'Slot expired — please select a new time'
        ) : (
          `Pay SGD ${parseFloat(amount).toFixed(2)}`
        )}
      </button>
    </form>
  );
}

// ── Main widget ───────────────────────────────────────────────────────────────

export default function BookingWidget({
  merchant,
  services,
  staff,
  slug,
  embedded = false,
}: BookingWidgetProps) {
  const router = useRouter();

  // Wizard state
  const [step, setStep] = useState<1 | 2 | 3 | 4 | 5>(1);

  // Selections
  const [selectedService, setSelectedService] = useState<Service | null>(null);
  const [selectedStaff, setSelectedStaff] = useState<StaffMember | null>(null);
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<TimeSlot | null>(null);

  // Availability
  const [slots, setSlots] = useState<TimeSlot[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [slotsError, setSlotsError] = useState('');

  // Next available date suggestion
  const [nextAvailable, setNextAvailable] = useState<{ date: string; firstSlot: string; slotsCount: number } | null>(null);
  const [nextAvailableLoading, setNextAvailableLoading] = useState(false);

  // Closures
  const [closedDates, setClosedDates] = useState<Set<string>>(new Set());

  // Lease
  const [leaseId, setLeaseId] = useState('');
  const [leaseExpiry, setLeaseExpiry] = useState<Date | null>(null);
  const [leaseLoading, setLeaseLoading] = useState(false);
  const [countdown, setCountdown] = useState(0);

  // Client details
  const [clientName, setClientName] = useState('');
  const [clientPhone, setClientPhone] = useState('');
  const [clientEmail, setClientEmail] = useState('');

  // Authenticated client (Google Sign-In)
  const [authClient, setAuthClient] = useState<{
    id: string;
    name: string | null;
    email: string | null;
    phone: string;
    avatarUrl: string | null;
    googleId: string | null;
  } | null>(null);
  const [authLoading, setAuthLoading] = useState(false);
  const [isGuest, setIsGuest] = useState(false);

  // First-timer check
  const [isFirstTimer, setIsFirstTimer] = useState<boolean | null>(null);

  // Phone lookup / returning-customer + login OTP flow
  const [lookupResult, setLookupResult] = useState<{ matched: boolean; masked_name?: string } | null>(null);
  const [verificationToken, setVerificationToken] = useState<string | null>(null);
  const [registerMode, setRegisterMode] = useState(false);
  const [showLoginOtp, setShowLoginOtp] = useState(false);
  const [skippedFirstTimerOtp, setSkippedFirstTimerOtp] = useState(false);

  // Package state
  const [availablePackages, setAvailablePackages] = useState<Array<{ id: string; name: string; description: string | null; totalSessions: number; priceSgd: string; includedServices: Array<{ serviceId: string; serviceName: string; quantity: number }>; validityDays: number }>>([]);
  const [clientActivePackages, setClientActivePackages] = useState<Array<{ id: string; packageName: string; sessionsTotal: number; sessionsUsed: number; remaining: number; expiresAt: string; pendingSessions: Array<{ id: string; sessionNumber: number; serviceId: string; status: string }> }>>([]);
  const [usePackageSession, setUsePackageSession] = useState<{ sessionId: string; packageName: string } | null>(null);

  // Confirm
  const [confirmLoading, setConfirmLoading] = useState(false);
  const [confirmError, setConfirmError] = useState('');

  // Stripe payment
  const [stripePromise] = useState(() => {
    const key = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
    return key ? loadStripe(key) : null;
  });
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  // Default to cash ("Pay at Venue") for every customer — new, phone-returning,
  // or Google-authed. Customers who want to pay online opt in by clicking
  // the Pay Online button. This keeps the experience consistent regardless
  // of how the customer identified themselves.
  const [paymentMethod, setPaymentMethod] = useState<'card' | 'cash'>('cash');

  const bookingSource = embedded ? 'embedded_widget' : 'direct_widget';

  const days = next30Days();

  // ── Derived: first-timer OTP gating ─────────────────────────────────────────
  const firstTimerIsBetter =
    !!selectedService?.firstTimerDiscountEnabled &&
    (selectedService?.firstTimerDiscountPct ?? 0) > (selectedService?.discountPct ?? 0);

  const shouldOfferFirstTimerOtp =
    registerMode &&
    !authClient &&
    firstTimerIsBetter &&
    !!clientName.trim() &&
    !!clientPhone.trim() &&
    !verificationToken &&
    !skippedFirstTimerOtp &&
    isFirstTimer !== false; // returning customer: skip OTP (regular price applies)

  // ── Google Sign-In ──────────────────────────────────────────────────────────

  const googleClientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;

  // Fetch closed dates on mount
  useEffect(() => {
    apiFetch(`/booking/${slug}/closures`)
      .then((data) => {
        const dates = new Set<string>();
        for (const cl of data.closures ?? []) {
          if (cl.isFullDay) dates.add(cl.date);
        }
        setClosedDates(dates);
      })
      .catch(() => { /* ignore — closures are optional */ });
  }, [slug]);

  // Fetch available packages on mount
  useEffect(() => {
    apiFetch(`/booking/${slug}/packages`)
      .then((data) => setAvailablePackages(data.packages ?? []))
      .catch(() => {});
  }, [slug]);

  // Check for returning Google user on mount
  useEffect(() => {
    const storedGoogleId = sessionStorage.getItem(`glowos_google_id_${slug}`);
    if (storedGoogleId) {
      apiFetch('/customer-auth/lookup', {
        method: 'POST',
        body: JSON.stringify({ google_id: storedGoogleId, slug }),
      })
        .then((data) => {
          const c = data.client;
          setAuthClient(c);
          setClientName(c.name ?? '');
          setClientEmail(c.email ?? '');
          setClientPhone(c.phone ?? '');
        })
        .catch(() => {
          sessionStorage.removeItem(`glowos_google_id_${slug}`);
        });
    }
  }, [slug]);

  // Clear verification token when phone changes (unless Google-authenticated)
  useEffect(() => {
    if (authClient) return; // Google users' token binds to google_id, not phone
    if (verificationToken === null && !skippedFirstTimerOtp) return; // nothing to reset
    setVerificationToken(null);
    setSkippedFirstTimerOtp(false);
    // Also reset UI-derived signal so the next verify prompt fires cleanly
    setIsFirstTimer(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientPhone]);

  // Debounced phone lookup for returning-customer detection
  useEffect(() => {
    if (authClient) { setLookupResult(null); return; } // Google user, skip lookup
    const phone = clientPhone.trim();
    if (phone.length < 6) {
      setLookupResult(null);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const res = (await apiFetch(`/booking/${slug}/lookup-client`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone }),
        })) as { matched: boolean; masked_name?: string };
        setLookupResult(res);
      } catch {
        setLookupResult(null);
      }
    }, 500);
    return () => clearTimeout(t);
  }, [clientPhone, slug, authClient]);

  // Proactively check if the user's phone/email matches an existing customer at
  // this merchant. If so, the backend will deny the first-timer discount, so we
  // hide the OTP card to avoid a bait-and-switch at checkout.
  useEffect(() => {
    if (authClient) return; // Google users: check runs via their own flow
    if (!registerMode) return;
    if (!firstTimerIsBetter) return; // No point offering OTP anyway

    const phone = clientPhone.trim();
    const email = clientEmail.trim();
    if (!phone && !email) return;

    const t = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ slug });
        if (phone) params.set('phone', phone);
        if (email) params.set('email', email);
        const res = (await apiFetch(
          `/merchant/services/check-first-timer?${params.toString()}`
        )) as { isFirstTimer: boolean };
        setIsFirstTimer(res.isFirstTimer);
      } catch {
        // Leave isFirstTimer as-is; the OTP card stays visible if it was.
      }
    }, 500);
    return () => clearTimeout(t);
  }, [clientPhone, clientEmail, registerMode, firstTimerIsBetter, slug, authClient]);

  // Load Google Identity Services script
  useEffect(() => {
    if (!googleClientId) return;
    if (document.getElementById('google-gsi-script')) return;
    const script = document.createElement('script');
    script.id = 'google-gsi-script';
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    document.head.appendChild(script);
  }, [googleClientId]);

  const handleGoogleSignIn = useCallback(async (response: { credential: string }) => {
    setAuthLoading(true);
    setConfirmError('');
    try {
      const data = await apiFetch('/customer-auth/google', {
        method: 'POST',
        body: JSON.stringify({ credential: response.credential, slug }),
      });
      const c = data.client;
      setAuthClient(c);
      setClientName(c.name ?? '');
      setClientEmail(c.email ?? '');
      setClientPhone(c.phone ?? '');
      if (data.verification_token) {
        setVerificationToken(data.verification_token);
      }
      // Remember for this session
      if (c.googleId) {
        sessionStorage.setItem(`glowos_google_id_${slug}`, c.googleId);
      }
    } catch (err) {
      setConfirmError(err instanceof Error ? err.message : 'Google sign-in failed');
    } finally {
      setAuthLoading(false);
    }
  }, [slug]);

  // Callback ref: re-renders the Google Sign-in button every time the div mounts.
  // This handles the case where the auth-picker unmounts (e.g., during the login-OTP
  // card) and remounts — a plain useRef would leave the new div empty.
  const mountGoogleButton = useCallback(
    (node: HTMLDivElement | null) => {
      if (!node || !googleClientId) return;
      if (!window.google) {
        // GIS script hasn't loaded yet; retry in a moment
        setTimeout(() => {
          if (window.google && node.isConnected) {
            window.google.accounts.id.initialize({
              client_id: googleClientId,
              callback: handleGoogleSignIn,
            });
            window.google.accounts.id.renderButton(node, {
              theme: 'outline',
              size: 'large',
              width: 320,
              text: 'signin_with',
              shape: 'pill',
              logo_alignment: 'center',
            });
          }
        }, 500);
        // Note: no cleanup for this setTimeout because the node could remount
        // within 500ms; best-effort is fine here.
        return;
      }
      window.google.accounts.id.initialize({
        client_id: googleClientId,
        callback: handleGoogleSignIn,
      });
      window.google.accounts.id.renderButton(node, {
        theme: 'outline',
        size: 'large',
        width: 320,
        text: 'signin_with',
        shape: 'pill',
        logo_alignment: 'center',
      });
    },
    [googleClientId, handleGoogleSignIn]
  );

  function handleSignOut() {
    setAuthClient(null);
    setClientName('');
    setClientEmail('');
    setClientPhone('');
    setIsGuest(false);
    sessionStorage.removeItem(`glowos_google_id_${slug}`);
  }

  const staffWithAny: StaffMember[] = [
    { id: 'any', name: 'Any Available', photoUrl: null, title: 'We\'ll assign the best available team member', bio: null, specialtyTags: null, isAnyAvailable: true },
    ...staff,
  ];

  // ── Fetch availability ───────────────────────────────────────────────────────

  const fetchSlots = useCallback(async () => {
    if (!selectedService || !selectedStaff || !selectedDate) return;
    setSlotsLoading(true);
    setSlotsError('');
    setSlots([]);
    setNextAvailable(null);
    try {
      const dateStr = toDateStr(selectedDate);
      const params = new URLSearchParams({ service_id: selectedService.id, date: dateStr });
      if (selectedStaff.id !== 'any') params.append('staff_id', selectedStaff.id);
      const res = await apiFetch(`/booking/${slug}/availability?${params.toString()}`);
      setSlots((res.slots as TimeSlot[]) || []);

      // If no slots found and a specific staff is selected, find next available
      if ((res.slots ?? []).length === 0 && selectedStaff && selectedStaff.id !== 'any' && selectedDate) {
        setNextAvailableLoading(true);
        setNextAvailable(null);
        try {
          const nextParams = new URLSearchParams({ service_id: selectedService.id, after: dateStr });
          nextParams.append('staff_id', selectedStaff.id);
          const nextData = await apiFetch(`/booking/${slug}/next-available?${nextParams.toString()}`);
          if (nextData.found) {
            setNextAvailable({ date: nextData.date, firstSlot: nextData.firstSlot, slotsCount: nextData.slotsCount });
          }
        } catch { /* silent */ }
        finally { setNextAvailableLoading(false); }
      } else {
        setNextAvailable(null);
      }
    } catch (err) {
      setSlotsError(err instanceof Error ? err.message : 'Failed to load availability');
    } finally {
      setSlotsLoading(false);
    }
  }, [selectedService, selectedStaff, selectedDate, slug]);

  useEffect(() => {
    void fetchSlots();
  }, [fetchSlots]);

  // ── Lease countdown ──────────────────────────────────────────────────────────

  useEffect(() => {
    if (!leaseExpiry) return;
    const interval = setInterval(() => {
      const remaining = Math.max(0, Math.floor((leaseExpiry.getTime() - Date.now()) / 1000));
      setCountdown(remaining);
      if (remaining === 0) {
        // Lease expired — go back to slot selection
        setLeaseId('');
        setLeaseExpiry(null);
        setSelectedSlot(null);
        setStep(3);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [leaseExpiry]);

  // ── Handlers ─────────────────────────────────────────────────────────────────

  function handleServiceSelect(svc: Service) {
    setSelectedService(svc);
    setSelectedStaff(null);
    setSelectedDate(null);
    setSelectedSlot(null);
    setLeaseId('');
    setLeaseExpiry(null);
    setStep(2);
  }

  function handleStaffSelect(s: StaffMember) {
    setSelectedStaff(s);
    setSelectedDate(null);
    setSelectedSlot(null);
    setLeaseId('');
    setLeaseExpiry(null);
    setStep(3);
  }

  function handleDateSelect(day: Date) {
    setSelectedDate(day);
    setSelectedSlot(null);
    setLeaseId('');
    setLeaseExpiry(null);
  }

  async function handleSlotSelect(slot: TimeSlot) {
    setSelectedSlot(slot);
    setLeaseLoading(true);
    setConfirmError('');
    try {
      const res = await apiFetch(`/booking/${slug}/lease`, {
        method: 'POST',
        body: JSON.stringify({
          service_id: selectedService!.id,
          staff_id: slot.staff_id,
          start_time: slot.start_time,
        }),
      });
      setLeaseId(res.lease_id as string);
      setLeaseExpiry(new Date(res.expires_at as string));
      setCountdown(300);
      setStep(4);
    } catch (err) {
      setConfirmError(err instanceof Error ? err.message : 'Could not hold this slot. Please try another.');
      setSelectedSlot(null);
    } finally {
      setLeaseLoading(false);
    }
  }

  async function handleConfirmBooking() {
    if (!leaseId || !selectedService) return;
    if (!clientName.trim()) {
      setConfirmError('Please enter your name');
      return;
    }
    if (!clientPhone.trim()) {
      setConfirmError('Please enter your mobile number');
      return;
    }

    setConfirmLoading(true);
    setConfirmError('');
    try {
      const res = await apiFetch(`/booking/${slug}/confirm`, {
        method: 'POST',
        body: JSON.stringify({
          lease_id: leaseId,
          client_name: clientName.trim(),
          client_phone: clientPhone.trim(),
          client_email: clientEmail.trim() || undefined,
          client_id: authClient?.id || undefined,
          payment_method: 'cash',
          verification_token: verificationToken ?? undefined,
          booking_source: bookingSource,
        }),
      });
      const bookingId = (res.booking as { id: string }).id;
      // Compute effective price for confirm page
      const bp = parseFloat(selectedService.priceSgd);
      let ep = bp;
      if (selectedService.discountPct) ep = bp * (1 - selectedService.discountPct / 100);
      if (isFirstTimer && selectedService.firstTimerDiscountEnabled && selectedService.firstTimerDiscountPct) {
        const ftp = bp * (1 - selectedService.firstTimerDiscountPct / 100);
        if (ftp < ep) ep = ftp;
      }
      router.push(
        `/${slug}/confirm?booking_id=${bookingId}` +
        `&service=${encodeURIComponent(selectedService.name)}` +
        `&staff=${encodeURIComponent(selectedStaff?.id === 'any' ? 'Any Available' : (selectedStaff?.name || ''))}` +
        `&time=${encodeURIComponent(selectedSlot?.start_time || '')}` +
        `&amount=${encodeURIComponent(String(ep))}`
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Booking failed. Please try again.';
      // If lease expired during form fill
      if (msg.toLowerCase().includes('expired') || msg.toLowerCase().includes('lease')) {
        setLeaseId('');
        setLeaseExpiry(null);
        setSelectedSlot(null);
        setStep(3);
        setConfirmError('Your slot hold expired. Please select a new time.');
      } else {
        setConfirmError(msg);
      }
    } finally {
      setConfirmLoading(false);
    }
  }

  // ── Computed ─────────────────────────────────────────────────────────────────

  // When customer picks "Any Available" AND has selected a concrete time
  // slot, the slot itself is bound to a specific staff — show that person's
  // name so the customer knows who they'll see before confirming payment.
  // Before they pick a slot, keep showing "Any Available" as the label.
  const assignedStaffFromSlot =
    selectedStaff?.id === 'any' && selectedSlot?.staff_id
      ? staff.find((s) => s.id === selectedSlot.staff_id) ?? null
      : null;

  const resolvedStaffName =
    selectedStaff?.id === 'any'
      ? (assignedStaffFromSlot?.name ?? 'Any Available')
      : (selectedStaff?.name ?? '');

  // Flag so review screens can render an "Assigned from Any Available" note.
  const anyAvailableResolved =
    selectedStaff?.id === 'any' && assignedStaffFromSlot !== null;

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">

      {/* Step progress */}
      <div className="flex items-center justify-between px-1 pb-2">
        <StepBadge num={1} label="Service" active={step === 1} done={step > 1} />
        <div className={`flex-1 h-px mx-2 ${step > 1 ? 'bg-tone-sage/60' : 'bg-grey-15'}`} />
        <StepBadge num={2} label="Staff" active={step === 2} done={step > 2} />
        <div className={`flex-1 h-px mx-2 ${step > 2 ? 'bg-tone-sage/60' : 'bg-grey-15'}`} />
        <StepBadge num={3} label="Date & Time" active={step === 3} done={step > 3} />
        <div className={`flex-1 h-px mx-2 ${step > 3 ? 'bg-tone-sage/60' : 'bg-grey-15'}`} />
        <StepBadge num={4} label="Details" active={step === 4} done={step > 4} />
        <div className={`flex-1 h-px mx-2 ${step > 4 ? 'bg-tone-sage/60' : 'bg-grey-15'}`} />
        <StepBadge num={5} label="Confirm" active={step === 5} done={false} />
      </div>

      {/* ── Step 1: Select Service ─────────────────────────────────────────────── */}
      <div className="bg-tone-surface rounded-2xl border border-grey-5 shadow-sm overflow-hidden">
        <button
          onClick={() => setStep(1)}
          className="w-full px-6 py-4 border-b border-grey-5 bg-grey-5 flex items-center justify-between"
        >
          <h2 className="text-sm font-semibold text-grey-75 uppercase tracking-wide">
            1 — Select a Service
          </h2>
          {selectedService && step !== 1 && (
            <span className="text-sm text-tone-sage font-medium truncate ml-4">{selectedService.name}</span>
          )}
        </button>

        {step === 1 && (
          <div className="divide-y divide-grey-5">
            {services.length === 0 && (
              <p className="px-6 py-8 text-center text-grey-45 text-sm">No services available right now.</p>
            )}
            {services.map((svc) => (
              <label
                key={svc.id}
                className={`flex items-start gap-3 px-6 py-4 cursor-pointer transition-colors ${
                  selectedService?.id === svc.id
                    ? 'bg-tone-sage/10 border-l-4 border-tone-sage'
                    : 'hover:bg-tone-sage/10 border-l-4 border-transparent'
                }`}
              >
                <input
                  type="radio"
                  name="service"
                  value={svc.id}
                  checked={selectedService?.id === svc.id}
                  onChange={() => handleServiceSelect(svc)}
                  className="mt-1 accent-indigo-600 shrink-0"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-tone-ink">{svc.name}</span>
                    {svc.discountPct && svc.discountShowOnline ? (
                      <div className="text-right shrink-0">
                        <span className="text-xs text-grey-45 line-through">SGD {parseFloat(svc.priceSgd).toFixed(2)}</span>
                        <span className="text-sm font-bold text-tone-sage ml-1">
                          SGD {(parseFloat(svc.priceSgd) * (1 - svc.discountPct / 100)).toFixed(2)}
                        </span>
                        <span className="text-[10px] text-tone-sage font-medium ml-1">-{svc.discountPct}%</span>
                      </div>
                    ) : (
                      <span className="text-sm font-bold text-tone-sage shrink-0">
                        SGD {parseFloat(svc.priceSgd).toFixed(2)}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-grey-60 mt-0.5">{svc.durationMinutes} min</p>
                  {svc.firstTimerDiscountEnabled && svc.discountShowOnline && (
                    <span className="text-[10px] bg-tone-sage/5 text-tone-sage px-2 py-0.5 rounded-full font-medium">
                      {svc.firstTimerDiscountPct}% off for first visit
                    </span>
                  )}
                  {svc.description && (
                    <p className="text-xs text-grey-45 mt-1 leading-relaxed line-clamp-2">
                      {svc.description}
                    </p>
                  )}
                  {svc.requiresConsultFirst && (
                    <div className="mt-1 flex items-center gap-1 text-xs text-semantic-warn">
                      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                      </svg>
                      Book a consultation first
                    </div>
                  )}
                </div>
              </label>
            ))}

            {/* Packages */}
            {availablePackages.length > 0 && (
              <div className="px-6 py-4 border-t border-grey-5">
                <h3 className="text-xs font-semibold text-grey-60 uppercase tracking-wide mb-3">Packages</h3>
                <div className="space-y-3">
                  {availablePackages.map(pkg => {
                    const totalIndividual = pkg.includedServices.reduce((sum, s) => {
                      const svc = services.find(sv => sv.id === s.serviceId);
                      return sum + (svc ? parseFloat(svc.priceSgd) * s.quantity : 0);
                    }, 0);
                    const savings = totalIndividual > 0 ? Math.round((1 - parseFloat(pkg.priceSgd) / totalIndividual) * 100) : 0;

                    return (
                      <div key={pkg.id} className="border border-tone-sage/30 bg-tone-sage/10/30 rounded-xl p-4">
                        <div className="flex items-start justify-between mb-2">
                          <div>
                            <span className="text-xs bg-tone-sage/15 text-tone-sage px-2 py-0.5 rounded-full font-medium">Package</span>
                            <h4 className="text-sm font-semibold text-tone-ink mt-1">{pkg.name}</h4>
                            {pkg.description && <p className="text-xs text-grey-60 mt-0.5">{pkg.description}</p>}
                          </div>
                          <div className="text-right">
                            {savings > 0 && <span className="text-[10px] text-tone-sage font-medium">Save {savings}%</span>}
                            <p className="text-sm font-bold text-tone-sage">SGD {parseFloat(pkg.priceSgd).toFixed(2)}</p>
                          </div>
                        </div>
                        <div className="text-xs text-grey-60 mb-2">
                          {pkg.totalSessions} sessions &middot; Valid {pkg.validityDays} days
                        </div>
                        <div className="text-xs text-grey-45">
                          Includes: {pkg.includedServices.map(s => `${s.serviceName}${s.quantity > 1 ? ` x${s.quantity}` : ''}`).join(', ')}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Step 2: Select Staff ───────────────────────────────────────────────── */}
      {selectedService && (
        <div className="bg-tone-surface rounded-2xl border border-grey-5 shadow-sm overflow-hidden">
          <button
            onClick={() => setStep(2)}
            className="w-full px-6 py-4 border-b border-grey-5 bg-grey-5 flex items-center justify-between"
          >
            <h2 className="text-sm font-semibold text-grey-75 uppercase tracking-wide">
              2 — Select Your Staff
            </h2>
            {selectedStaff && step !== 2 && (
              <span className="text-sm text-tone-sage font-medium truncate ml-4">{resolvedStaffName}</span>
            )}
          </button>

          {step === 2 && (
            <div className="divide-y divide-grey-5">
              {staffWithAny.map((s) => (
                <label
                  key={s.id}
                  className={`flex items-start gap-3 px-6 py-4 cursor-pointer transition-colors ${
                    selectedStaff?.id === s.id
                      ? 'bg-tone-sage/10 border-l-4 border-tone-sage'
                      : 'hover:bg-tone-sage/10 border-l-4 border-transparent'
                  }`}
                >
                  <input
                    type="radio"
                    name="staff"
                    value={s.id}
                    checked={selectedStaff?.id === s.id}
                    onChange={() => handleStaffSelect(s)}
                    className="accent-indigo-600 shrink-0 mt-1"
                  />
                  {s.id === 'any' ? (
                    <div className="w-10 h-10 rounded-full bg-tone-sage/10 border-2 border-dashed border-tone-sage/50 flex items-center justify-center text-grey-60 text-lg shrink-0">
                      ✦
                    </div>
                  ) : s.photoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={s.photoUrl}
                      alt={s.name}
                      className="w-10 h-10 rounded-full object-cover border border-grey-5 shrink-0"
                    />
                  ) : (
                    <div className="w-10 h-10 rounded-full bg-tone-ink flex items-center justify-center text-white text-sm font-bold shrink-0">
                      {s.name.charAt(0)}
                    </div>
                  )}
                  <div>
                    <div className="text-sm font-semibold text-tone-ink">{s.name}</div>
                    {s.title && <div className="text-xs text-grey-45 mt-0.5">{s.title}</div>}
                    {s.bio && (
                      <p className="text-xs text-grey-45 mt-1 line-clamp-2">{s.bio}</p>
                    )}
                    {s.specialtyTags && s.specialtyTags.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {s.specialtyTags.map((tag) => (
                          <span
                            key={tag}
                            className="text-xs bg-grey-75 text-grey-30 rounded-full px-2 py-0.5"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </label>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Step 3: Select Date & Time ─────────────────────────────────────────── */}
      {selectedService && selectedStaff && (
        <div className="bg-tone-surface rounded-2xl border border-grey-5 shadow-sm overflow-hidden">
          <button
            onClick={() => setStep(3)}
            className="w-full px-6 py-4 border-b border-grey-5 bg-grey-5 flex items-center justify-between"
          >
            <h2 className="text-sm font-semibold text-grey-75 uppercase tracking-wide">
              3 — Select Date &amp; Time
            </h2>
            {selectedSlot && selectedDate && step !== 3 && (
              <span className="text-sm text-tone-sage font-medium truncate ml-4">
                {formatDateFull(selectedDate).split(',')[0]}, {formatTime(selectedSlot.start_time)}
              </span>
            )}
          </button>

          {step === 3 && (
            <div className="px-6 py-4">
              {/* Date row */}
              <div className="flex gap-2 overflow-x-auto pb-3 -mx-1 px-1 scrollbar-hide">
                {days.map((day) => {
                  const dayStr = toDateStr(day);
                  const isSelected = selectedDate ? toDateStr(selectedDate) === dayStr : false;
                  const isToday = toDateStr(new Date()) === dayStr;
                  const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
                  const isClosedDay = merchant?.operatingHours?.[dayNames[day.getDay()]]?.closed === true;
                  const isClosed = closedDates.has(dayStr) || isClosedDay;
                  return (
                    <button
                      key={dayStr}
                      onClick={() => !isClosed && handleDateSelect(day)}
                      disabled={isClosed}
                      className={`shrink-0 rounded-xl px-3 py-2.5 text-center border-2 transition-all ${
                        isClosed
                          ? 'border-grey-5 bg-grey-5 text-grey-30 cursor-not-allowed line-through'
                          : isSelected
                            ? 'bg-tone-ink text-white border-tone-ink shadow-md'
                            : 'border-grey-15 text-grey-75 hover:border-tone-sage/50 hover:bg-tone-sage/10'
                      }`}
                      title={isClosed ? 'Closed' : undefined}
                    >
                      <div className="text-xs font-medium">
                        {isToday ? 'Today' : day.toLocaleDateString('en-SG', { weekday: 'short' })}
                      </div>
                      <div className="text-base font-bold mt-0.5">{day.getDate()}</div>
                      <div className="text-xs opacity-75">
                        {isClosed ? 'Closed' : day.toLocaleDateString('en-SG', { month: 'short' })}
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* Time slots */}
              {selectedDate && (
                <div className="mt-2">
                  {slotsLoading && (
                    <div className="flex items-center justify-center py-8 gap-2 text-grey-45">
                      <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                      </svg>
                      <span className="text-sm">Loading available times…</span>
                    </div>
                  )}
                  {slotsError && (
                    <div className="rounded-xl bg-semantic-danger/5 border border-semantic-danger/20 px-4 py-3 text-sm text-semantic-danger text-center">
                      {slotsError}
                    </div>
                  )}
                  {!slotsLoading && !slotsError && slots.length === 0 && (
                    <div className="rounded-xl bg-grey-5 border border-grey-5 px-4 py-6 text-sm text-grey-60 text-center">
                      <div className="text-2xl mb-2">😔</div>
                      No availability on {formatDateFull(selectedDate)}.<br />
                      <span className="text-grey-45">Please try another day.</span>

                      {/* Next available suggestion */}
                      {nextAvailableLoading && (
                        <div className="mt-4 text-xs text-grey-45 animate-pulse">
                          Searching for next available slot...
                        </div>
                      )}
                      {nextAvailable && !nextAvailableLoading && (
                        <div className="mt-4 bg-tone-surface border border-tone-sage/30 rounded-xl px-4 py-3">
                          <p className="text-xs text-tone-sage font-semibold mb-1">Next available with {selectedStaff?.name}</p>
                          <p className="text-sm font-semibold text-tone-ink">
                            {new Date(nextAvailable.date + 'T00:00:00').toLocaleDateString('en-SG', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
                          </p>
                          <p className="text-xs text-grey-60 mt-0.5">
                            {nextAvailable.slotsCount} slot{nextAvailable.slotsCount > 1 ? 's' : ''} available · First at {nextAvailable.firstSlot}
                          </p>
                          <button
                            type="button"
                            onClick={() => {
                              const jumpDate = new Date(nextAvailable.date + 'T00:00:00');
                              setSelectedDate(jumpDate);
                            }}
                            className="mt-2 px-4 py-2 bg-tone-ink text-white text-xs font-semibold rounded-lg hover:opacity-90 transition-colors"
                          >
                            Jump to {new Date(nextAvailable.date + 'T00:00:00').toLocaleDateString('en-SG', { weekday: 'short', day: 'numeric', month: 'short' })}
                          </button>
                        </div>
                      )}
                      {!nextAvailable && !nextAvailableLoading && selectedStaff && selectedStaff.id !== 'any' && (
                        <div className="mt-3 text-xs text-grey-45">
                          No availability with {selectedStaff.name} in the next 30 days.
                        </div>
                      )}
                      {selectedStaff && selectedStaff.id !== 'any' && selectedService && selectedDate && (
                        <JoinWaitlistCard
                          slug={slug}
                          serviceId={selectedService.id}
                          staffId={selectedStaff.id}
                          staffName={selectedStaff.name}
                          targetDate={`${selectedDate.getFullYear()}-${String(selectedDate.getMonth() + 1).padStart(2, '0')}-${String(selectedDate.getDate()).padStart(2, '0')}`}
                          defaultWindowStart="09:00"
                          defaultWindowEnd="18:00"
                        />
                      )}
                    </div>
                  )}
                  {!slotsLoading && slots.length > 0 && (
                    <>
                      <p className="text-xs text-grey-60 mb-3 font-medium uppercase tracking-wide">
                        {slots.length} time{slots.length !== 1 ? 's' : ''} available
                      </p>
                      {confirmError && !leaseId && (
                        <div className="mb-3 rounded-lg bg-semantic-danger/5 border border-semantic-danger/20 px-3 py-2 text-sm text-semantic-danger">
                          {confirmError}
                        </div>
                      )}
                      <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                        {slots.map((slot) => {
                          const isSelected =
                            selectedSlot?.start_time === slot.start_time &&
                            selectedSlot?.staff_id === slot.staff_id;
                          return (
                            <button
                              key={`${slot.start_time}-${slot.staff_id}`}
                              onClick={() => handleSlotSelect(slot)}
                              disabled={leaseLoading}
                              className={`rounded-xl py-2.5 px-2 text-sm font-semibold border-2 transition-all ${
                                isSelected
                                  ? 'bg-tone-ink text-white border-tone-ink shadow-md'
                                  : 'border-grey-15 text-grey-75 hover:border-tone-sage hover:bg-tone-sage/10'
                              } disabled:opacity-50 disabled:cursor-not-allowed`}
                            >
                              {leaseLoading && isSelected ? (
                                <svg className="animate-spin h-4 w-4 mx-auto" viewBox="0 0 24 24" fill="none">
                                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                                </svg>
                              ) : (
                                formatTime(slot.start_time)
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </>
                  )}
                </div>
              )}

              {!selectedDate && (
                <p className="text-sm text-grey-45 text-center py-4">
                  Pick a date above to see available times
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Step 4: Your Details ───────────────────────────────────────────────── */}
      {selectedSlot && leaseId && (
        <div className="bg-tone-surface rounded-2xl border border-grey-5 shadow-sm overflow-hidden">
          <button
            onClick={() => setStep(4)}
            className="w-full px-6 py-4 border-b border-grey-5 bg-grey-5 flex items-center justify-between"
          >
            <h2 className="text-sm font-semibold text-grey-75 uppercase tracking-wide">
              4 — Your Details
            </h2>
            <div className="flex items-center gap-3">
              {clientName && step !== 4 && (
                <div className="flex items-center gap-2">
                  {authClient?.avatarUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={authClient.avatarUrl} alt="" className="w-5 h-5 rounded-full" />
                  )}
                  <span className="text-sm text-tone-sage font-medium truncate">{clientName}</span>
                </div>
              )}
              {countdown > 0 && (
                <span className={`text-xs font-semibold px-2 py-1 rounded-full ${
                  countdown < 60
                    ? 'bg-semantic-danger/10 text-semantic-danger'
                    : 'bg-semantic-warn/5 text-semantic-warn'
                }`}>
                  {padTwo(Math.floor(countdown / 60))}:{padTwo(countdown % 60)}
                </span>
              )}
            </div>
          </button>

          {step === 4 && (
            <div className="px-6 py-5 space-y-4">
              {countdown > 0 && countdown < 120 && (
                <div className="bg-semantic-warn/5 border border-semantic-warn/30 rounded-xl px-4 py-3 text-sm text-semantic-warn flex items-center gap-2">
                  <span className="text-lg">⏰</span>
                  <span>Slot held for <strong>{padTwo(Math.floor(countdown / 60))}:{padTwo(countdown % 60)}</strong> — complete your booking before it expires</span>
                </div>
              )}

              {/* ── Returning-customer recognition ────────────────────────── */}
              {lookupResult?.matched && !registerMode && !verificationToken && !showLoginOtp && (
                <ReturningCustomerCard
                  maskedName={lookupResult.masked_name ?? 'there'}
                  phone={clientPhone}
                  onConfirm={() => setShowLoginOtp(true)}
                  onNotMe={() => { setLookupResult(null); setRegisterMode(true); }}
                />
              )}

              {/* ── Login OTP card ────────────────────────────────────────── */}
              {showLoginOtp && (
                <OTPVerificationCard
                  slug={slug}
                  phone={clientPhone}
                  purpose="login"
                  title="Verify your number"
                  subtitle="We'll send a one-time code to continue"
                  onVerified={(token, client) => {
                    setVerificationToken(token);
                    if (client) {
                      setClientName(client.name ?? '');
                      setClientEmail(client.email ?? '');
                    }
                    setShowLoginOtp(false);
                    setStep(5); // advance to Review & Confirm
                  }}
                  onSwitchToGoogle={() => {
                    // Only close the OTP card. Keep lookupResult so the
                    // Welcome-back card re-appears and the user can retry
                    // the phone path OR tap Google — their choice.
                    setShowLoginOtp(false);
                  }}
                />
              )}

              {/* ── Auth choice: Google Sign-In primary + Register fallback ─ */}
              {!authClient && !isGuest && !showLoginOtp && (
                <div className="space-y-4">
                  {/* Phone input up top so the returning-customer lookup can fire */}
                  {!lookupResult?.matched && (
                    <div>
                      <label className="block text-sm font-semibold text-grey-75 mb-1.5">
                        Mobile number <span className="text-semantic-danger">*</span>
                      </label>
                      <input
                        type="tel"
                        value={clientPhone}
                        onChange={(e) => setClientPhone(e.target.value)}
                        autoComplete="tel"
                        className="w-full rounded-xl border-2 border-grey-15 px-4 py-3 text-sm outline-none focus:border-tone-sage focus:ring-2 focus:ring-indigo-100 transition-colors"
                        placeholder="+65 9123 4567"
                      />
                      <p className="mt-1.5 text-xs text-grey-45">We&apos;ll check if you&apos;ve booked with us before</p>
                    </div>
                  )}

                  {/* ── or sign in faster ── */}
                  <div className="flex items-center gap-3">
                    <div className="flex-1 h-px bg-grey-15" />
                    <span className="text-xs text-grey-45 font-medium uppercase tracking-wide">or sign in faster</span>
                    <div className="flex-1 h-px bg-grey-15" />
                  </div>

                  {/* Primary: Continue with Google */}
                  {googleClientId && (
                    <div className="flex justify-center">
                      {authLoading ? (
                        <div className="flex items-center gap-2 px-6 py-3 rounded-full border-2 border-grey-15 text-sm text-grey-60">
                          <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                          </svg>
                          Signing in...
                        </div>
                      ) : (
                        <div ref={mountGoogleButton} />
                      )}
                    </div>
                  )}

                  {/* Secondary: Register now */}
                  <button
                    onClick={() => { setIsGuest(true); setRegisterMode(true); }}
                    className="w-full rounded-xl border border-grey-15 py-2.5 text-xs font-medium text-grey-60 hover:border-grey-30 hover:bg-grey-5 transition-colors"
                  >
                    Register now
                  </button>
                </div>
              )}

              {/* ── Signed-in user info ──────────────────────────────── */}
              {authClient && (
                <div className="bg-tone-sage/5 rounded-xl border border-tone-sage/30 px-4 py-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      {authClient.avatarUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={authClient.avatarUrl}
                          alt=""
                          className="w-10 h-10 rounded-full border-2 border-white shadow-sm"
                        />
                      ) : (
                        <div className="w-10 h-10 rounded-full bg-tone-ink flex items-center justify-center text-white text-sm font-bold">
                          {(authClient.name ?? 'U').charAt(0).toUpperCase()}
                        </div>
                      )}
                      <div>
                        <p className="text-sm font-semibold text-tone-ink">{authClient.name ?? 'User'}</p>
                        {authClient.email && (
                          <p className="text-xs text-grey-60">{authClient.email}</p>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={handleSignOut}
                      className="text-xs text-grey-45 hover:text-grey-75 transition-colors"
                    >
                      Switch
                    </button>
                  </div>
                </div>
              )}

              {/* ── Form fields (shown when auth'd or guest) ──────── */}
              {(authClient || isGuest) && (
                <>
                  {/* Escape hatch: collapse back to the auth-picker view so the
                      user can switch to Google Sign-in without refreshing.
                      Hidden once signed in via Google (authClient set). */}
                  {!authClient && (
                    <button
                      type="button"
                      onClick={() => {
                        setIsGuest(false);
                        setRegisterMode(false);
                        setSkippedFirstTimerOtp(false);
                        // Preserve clientPhone so the returning-customer lookup
                        // can re-fire without the user retyping it.
                      }}
                      className="text-xs text-grey-60 underline hover:text-grey-75 transition-colors"
                    >
                      ← Use Google instead
                    </button>
                  )}

                  {/* Name */}
                  <div>
                    <label className="block text-sm font-semibold text-grey-75 mb-1.5">
                      Full name <span className="text-semantic-danger">*</span>
                    </label>
                    <input
                      type="text"
                      value={clientName}
                      onChange={(e) => setClientName(e.target.value)}
                      autoComplete="name"
                      className="w-full rounded-xl border-2 border-grey-15 px-4 py-3 text-sm outline-none focus:border-tone-sage focus:ring-2 focus:ring-indigo-100 transition-colors"
                      placeholder="Jane Tan"
                    />
                  </div>

                  {/* Phone */}
                  <div>
                    <label className="block text-sm font-semibold text-grey-75 mb-1.5">
                      Mobile number <span className="text-semantic-danger">*</span>
                    </label>
                    <input
                      type="tel"
                      value={clientPhone}
                      onChange={(e) => setClientPhone(e.target.value)}
                      autoComplete="tel"
                      className="w-full rounded-xl border-2 border-grey-15 px-4 py-3 text-sm outline-none focus:border-tone-sage focus:ring-2 focus:ring-indigo-100 transition-colors"
                      placeholder="+65 9123 4567"
                    />
                  </div>

                  {/* Email */}
                  <div>
                    <label className="block text-sm font-semibold text-grey-75 mb-1.5">
                      Email <span className="text-grey-45 font-normal">(optional)</span>
                    </label>
                    <input
                      type="email"
                      value={clientEmail}
                      onChange={(e) => setClientEmail(e.target.value)}
                      autoComplete="email"
                      className="w-full rounded-xl border-2 border-grey-15 px-4 py-3 text-sm outline-none focus:border-tone-sage focus:ring-2 focus:ring-indigo-100 transition-colors"
                      placeholder="jane@example.com"
                    />
                  </div>

                  {/* Payment method toggle (only if merchant has Stripe) */}
                  {merchant.paymentEnabled && (
                    <div>
                      <label className="block text-sm font-semibold text-grey-75 mb-2">Payment method</label>
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => setPaymentMethod('card')}
                          className={`rounded-xl border-2 py-2.5 text-sm font-medium transition-colors ${
                            paymentMethod === 'card'
                              ? 'border-tone-sage bg-tone-sage/10 text-tone-sage'
                              : 'border-grey-15 text-grey-75 hover:border-grey-30'
                          }`}
                        >
                          Pay Online
                        </button>
                        <button
                          type="button"
                          onClick={() => setPaymentMethod('cash')}
                          className={`rounded-xl border-2 py-2.5 text-sm font-medium transition-colors ${
                            paymentMethod === 'cash'
                              ? 'border-tone-sage bg-tone-sage/10 text-tone-sage'
                              : 'border-grey-15 text-grey-75 hover:border-grey-30'
                          }`}
                        >
                          Pay at Venue
                        </button>
                      </div>
                    </div>
                  )}

                  {shouldOfferFirstTimerOtp && (
                    <OTPVerificationCard
                      slug={slug}
                      phone={clientPhone}
                      email={clientEmail || undefined}
                      purpose="first_timer_verify"
                      title={`🎁 Claim ${selectedService?.firstTimerDiscountPct}% first-visit discount`}
                      subtitle="Verify your phone to unlock"
                      onVerified={(token) => {
                        setVerificationToken(token);
                        setIsFirstTimer(true);
                      }}
                      onSkip={() => {
                        setSkippedFirstTimerOtp(true);
                        setVerificationToken(null);
                        setIsFirstTimer(false);
                      }}
                      onSwitchToGoogle={() => {
                        setIsGuest(false);
                        setRegisterMode(false);
                        setSkippedFirstTimerOtp(false);
                      }}
                    />
                  )}

                  {!authClient && registerMode && firstTimerIsBetter && isFirstTimer === false && (
                    <div className="rounded-lg border border-grey-15 bg-grey-5 p-4 text-sm text-grey-75">
                      <div className="font-medium">👋 Welcome back!</div>
                      <div className="mt-1 text-xs text-grey-75">
                        We recognize this phone/email from a previous booking. Regular pricing applies — the first-visit discount is for new customers only.
                      </div>
                    </div>
                  )}

                  <button
                    onClick={async () => {
                      if (!clientName.trim() || !clientPhone.trim()) {
                        setConfirmError('Please fill in your name and mobile number');
                        return;
                      }
                      setConfirmError('');

                      // Check first-timer status
                      if (selectedService?.firstTimerDiscountEnabled) {
                        try {
                          const params = new URLSearchParams({ slug });
                          if (clientPhone.trim()) params.set('phone', clientPhone.trim());
                          if (clientEmail.trim()) params.set('email', clientEmail.trim());
                          if (authClient?.googleId) params.set('google_id', authClient.googleId);
                          const ftRes = await apiFetch(`/merchant/services/check-first-timer?${params.toString()}`);
                          setIsFirstTimer((ftRes as { isFirstTimer: boolean }).isFirstTimer);
                        } catch (err) {
                          console.error("[BookingWidget] first-timer check failed", err);
                          // Default to false — safer than null when deciding whether to offer verification
                          setIsFirstTimer(false);
                        }
                      }

                      // Check for active packages
                      try {
                        const pkgParams = new URLSearchParams({ slug });
                        if (clientPhone.trim()) pkgParams.set('phone', clientPhone.trim());
                        if (clientEmail.trim()) pkgParams.set('email', clientEmail.trim());
                        const pkgRes = await apiFetch(`/booking/${slug}/client-packages?${pkgParams.toString()}`);
                        setClientActivePackages(pkgRes.packages ?? []);
                      } catch { /* ignore */ }

                      // If paying by card, create PaymentIntent first
                      if (paymentMethod === 'card' && merchant.paymentEnabled && selectedService) {
                        setConfirmLoading(true);
                        try {
                          const res = await apiFetch(`/booking/${slug}/create-payment-intent`, {
                            method: 'POST',
                            body: JSON.stringify({
                              lease_id: leaseId,
                              service_id: selectedService.id,
                              client_id: authClient?.id || undefined,
                              client_name: clientName.trim(),
                              client_email: clientEmail.trim() || undefined,
                              client_phone: clientPhone.trim(),
                              verification_token: verificationToken ?? undefined,
                              booking_source: bookingSource,
                            }),
                          });
                          setClientSecret(res.client_secret as string);
                          // Store booking details for the confirm page — ensures
                          // details survive redirects (PayNow, GrabPay).
                          try {
                            // Compute effective price for session storage
                            const bp = parseFloat(selectedService.priceSgd);
                            let ep = bp;
                            if (selectedService.discountPct) ep = bp * (1 - selectedService.discountPct / 100);
                            if (isFirstTimer && selectedService.firstTimerDiscountEnabled && selectedService.firstTimerDiscountPct) {
                              const ftp = bp * (1 - selectedService.firstTimerDiscountPct / 100);
                              if (ftp < ep) ep = ftp;
                            }
                            sessionStorage.setItem(`glowos_booking_${slug}`, JSON.stringify({
                              service: selectedService.name,
                              staff: resolvedStaffName,
                              time: selectedSlot?.start_time,
                              amount: String(ep),
                              paid: true,
                            }));
                          } catch { /* ignore */ }
                          setStep(5);
                        } catch (err) {
                          setConfirmError(err instanceof Error ? err.message : 'Failed to set up payment');
                        } finally {
                          setConfirmLoading(false);
                        }
                      } else {
                        setStep(5);
                      }
                    }}
                    disabled={shouldOfferFirstTimerOtp || !clientName.trim() || !clientPhone.trim() || confirmLoading}
                    className="w-full rounded-xl bg-tone-ink py-3.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {confirmLoading
                      ? 'Setting up payment...'
                      : paymentMethod === 'card'
                      ? 'Continue to Payment'
                      : 'Continue to Review'}
                  </button>
                </>
              )}

              {confirmError && (
                <div className="rounded-xl bg-semantic-danger/5 border border-semantic-danger/20 px-4 py-3 text-sm text-semantic-danger">
                  {confirmError}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Step 5: Confirm & Pay ──────────────────────────────────────────────── */}
      {selectedSlot && leaseId && clientName && clientPhone && step === 5 && (
        <div className="bg-tone-surface rounded-2xl border border-grey-5 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-grey-5 bg-grey-5 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-grey-75 uppercase tracking-wide">
              5 — Review &amp; Confirm
            </h2>
            {countdown > 0 && (
              <span className={`text-xs font-semibold px-2 py-1 rounded-full ${
                countdown < 60 ? 'bg-semantic-danger/10 text-semantic-danger' : 'bg-semantic-warn/5 text-semantic-warn'
              }`}>
                ⏱ {padTwo(Math.floor(countdown / 60))}:{padTwo(countdown % 60)}
              </span>
            )}
          </div>

          <div className="px-6 py-5 space-y-4">
            {/* Booking summary card */}
            {(() => {
              const basePrice = parseFloat(selectedService?.priceSgd || '0');
              let effectivePrice = basePrice;
              let discountLabel = '';

              if (selectedService?.discountPct) {
                effectivePrice = basePrice * (1 - selectedService.discountPct / 100);
                discountLabel = `${selectedService.discountPct}% discount applied`;
              }

              // First-timer discount overrides regular discount if higher
              if (isFirstTimer && selectedService?.firstTimerDiscountEnabled && selectedService?.firstTimerDiscountPct) {
                const firstTimerPrice = basePrice * (1 - selectedService.firstTimerDiscountPct / 100);
                if (firstTimerPrice < effectivePrice) {
                  effectivePrice = firstTimerPrice;
                  discountLabel = `${selectedService.firstTimerDiscountPct}% first-visit discount`;
                }
              }

              return (
                <>
            <div className="bg-tone-sage/5 rounded-2xl p-5 border border-tone-sage/30 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs text-tone-sage font-semibold uppercase tracking-wide mb-0.5">Service</p>
                  <p className="text-base font-bold text-tone-ink">{selectedService?.name}</p>
                  <p className="text-xs text-grey-60 mt-0.5">{selectedService?.durationMinutes} min</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-xs text-tone-sage font-semibold uppercase tracking-wide mb-0.5">Price</p>
                  {discountLabel ? (
                    <div>
                      <span className="text-sm text-grey-45 line-through">SGD {basePrice.toFixed(2)}</span>
                      <p className="text-xl font-bold text-tone-sage">SGD {effectivePrice.toFixed(2)}</p>
                      <p className="text-xs text-tone-sage mt-0.5">{discountLabel}</p>
                    </div>
                  ) : (
                    <p className="text-xl font-bold text-tone-sage">SGD {basePrice.toFixed(2)}</p>
                  )}
                </div>
              </div>

              <div className="border-t border-tone-sage/30 pt-3 grid grid-cols-2 gap-3">
                <div>
                  <p className="text-xs text-grey-60 mb-0.5">Staff</p>
                  <p className="text-sm font-semibold text-grey-90">{resolvedStaffName}</p>
                  {anyAvailableResolved && (
                    <p className="text-[11px] text-tone-sage mt-0.5">
                      Assigned from Any Available
                    </p>
                  )}
                </div>
                <div>
                  <p className="text-xs text-grey-60 mb-0.5">Date</p>
                  <p className="text-sm font-semibold text-grey-90">
                    {selectedDate ? formatDateFull(selectedDate).split(',').slice(0, 2).join(',') : ''}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-grey-60 mb-0.5">Time</p>
                  <p className="text-sm font-semibold text-grey-90">{formatTime(selectedSlot.start_time)}</p>
                </div>
                <div>
                  <p className="text-xs text-grey-60 mb-0.5">Payment</p>
                  <p className="text-sm font-semibold text-grey-90">
                    {usePackageSession ? 'Package session (free)' : paymentMethod === 'card' ? 'Pay now (online)' : 'Pay at appointment'}
                  </p>
                </div>
              </div>

              <div className="border-t border-tone-sage/30 pt-3">
                <p className="text-xs text-grey-60 mb-0.5">Name</p>
                <p className="text-sm font-semibold text-grey-90">{clientName}</p>
                <p className="text-xs text-grey-60 mt-2 mb-0.5">Mobile</p>
                <p className="text-sm font-semibold text-grey-90">{clientPhone}</p>
                {clientEmail && (
                  <>
                    <p className="text-xs text-grey-60 mt-2 mb-0.5">Email</p>
                    <p className="text-sm font-semibold text-grey-90">{clientEmail}</p>
                  </>
                )}
              </div>
            </div>

            {/* Cancellation policy */}
            <div className="bg-semantic-warn/5 border border-semantic-warn/20 rounded-xl px-4 py-3.5">
              <h3 className="text-xs font-bold text-semantic-warn uppercase tracking-wide mb-1">
                Cancellation Policy
              </h3>
              <p className="text-xs text-semantic-warn leading-relaxed">
                Cancellations made more than 24 hours before your appointment are eligible for a
                full refund. Late cancellations may receive a partial refund as per the business&apos;s
                policy. A cancellation link will be sent to you via WhatsApp.
              </p>
            </div>

            {/* Package redemption option */}
            {clientActivePackages.length > 0 && selectedService && (() => {
              const matchingPkg = clientActivePackages.find(pkg =>
                pkg.pendingSessions.some(s => s.serviceId === selectedService.id)
              );
              if (!matchingPkg) return null;
              const matchingSession = matchingPkg.pendingSessions.find(s => s.serviceId === selectedService.id);
              if (!matchingSession) return null;

              return (
                <div className="bg-tone-sage/10 border border-tone-sage/30 rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-lg">🎁</span>
                    <h3 className="text-sm font-semibold text-tone-ink">You have an active package!</h3>
                  </div>
                  <p className="text-xs text-tone-sage mb-1">{matchingPkg.packageName}</p>
                  <div className="flex items-center gap-2 mb-3">
                    <div className="flex-1 h-1.5 bg-tone-sage/20 rounded-full overflow-hidden">
                      <div className="h-full bg-tone-ink rounded-full" style={{ width: `${(matchingPkg.sessionsUsed / matchingPkg.sessionsTotal) * 100}%` }} />
                    </div>
                    <span className="text-[10px] text-tone-sage font-medium">{matchingPkg.sessionsUsed}/{matchingPkg.sessionsTotal} used</span>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setUsePackageSession({ sessionId: matchingSession.id, packageName: matchingPkg.packageName })}
                      className={`flex-1 py-2.5 text-xs font-semibold rounded-lg transition-colors ${
                        usePackageSession ? 'bg-tone-ink text-white' : 'bg-tone-surface border border-tone-sage/50 text-tone-sage hover:bg-tone-sage/15'
                      }`}
                    >
                      Use Package Session (free)
                    </button>
                    <button
                      type="button"
                      onClick={() => setUsePackageSession(null)}
                      className={`flex-1 py-2.5 text-xs font-semibold rounded-lg transition-colors ${
                        !usePackageSession ? 'bg-grey-90 text-white' : 'bg-tone-surface border border-grey-30 text-grey-75 hover:bg-grey-15'
                      }`}
                    >
                      Pay Normally
                    </button>
                  </div>
                </div>
              );
            })()}

            {confirmError && (
              <div className="rounded-xl bg-semantic-danger/5 border border-semantic-danger/30 px-4 py-3 text-sm text-semantic-danger">
                {confirmError}
              </div>
            )}

            {/* Package session confirm button */}
            {usePackageSession ? (
              <>
                <button
                  onClick={async () => {
                    if (!usePackageSession || !selectedSlot || !selectedStaff) return;
                    setConfirmLoading(true);
                    setConfirmError('');
                    try {
                      const res = await apiFetch(`/booking/${slug}/use-package-session`, {
                        method: 'POST',
                        body: JSON.stringify({
                          sessionId: usePackageSession.sessionId,
                          staffId: selectedStaff.id === 'any' ? selectedSlot.staff_id : selectedStaff.id,
                          startTime: selectedSlot.start_time,
                          clientName: clientName.trim(),
                          clientPhone: clientPhone.trim(),
                          clientEmail: clientEmail.trim() || undefined,
                        }),
                      });
                      const bookingId = (res.booking as { id: string }).id;
                      router.push(
                        `/${slug}/confirm?booking_id=${bookingId}` +
                        `&service=${encodeURIComponent(selectedService?.name ?? '')}` +
                        `&staff=${encodeURIComponent(resolvedStaffName)}` +
                        `&time=${encodeURIComponent(selectedSlot.start_time)}` +
                        `&amount=0` +
                        `&package=${encodeURIComponent(usePackageSession.packageName)}`
                      );
                    } catch (err) {
                      const msg = err instanceof Error ? err.message : 'Booking failed. Please try again.';
                      if (msg.toLowerCase().includes('expired') || msg.toLowerCase().includes('lease')) {
                        setLeaseId('');
                        setLeaseExpiry(null);
                        setSelectedSlot(null);
                        setStep(3);
                        setConfirmError('Your slot hold expired. Please select a new time.');
                      } else {
                        setConfirmError(msg);
                      }
                    } finally {
                      setConfirmLoading(false);
                    }
                  }}
                  disabled={confirmLoading || countdown === 0}
                  className="w-full rounded-2xl bg-tone-ink py-4 text-base font-bold text-white hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed transition-all shadow-lg shadow-md active:scale-[0.98]"
                >
                  {confirmLoading ? (
                    <span className="flex items-center justify-center gap-2">
                      <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                      </svg>
                      Confirming your booking…
                    </span>
                  ) : countdown === 0 ? (
                    'Slot expired — please select a new time'
                  ) : (
                    'Confirm Booking (Package Session)'
                  )}
                </button>
                <p className="text-xs text-grey-45 text-center">
                  This session will be deducted from your {usePackageSession.packageName} package.
                </p>
              </>
            ) : (
              <>
            {/* Payment form (card) or confirm button (cash) */}
            {paymentMethod === 'card' && clientSecret && stripePromise ? (
              <Elements stripe={stripePromise} options={{ clientSecret, appearance: { theme: 'stripe', variables: { colorPrimary: '#4f46e5', borderRadius: '12px' } } }}>
                {(() => {
                  // Build the confirm URL once — used both as the redirect return_url
                  // (GrabPay) and for the client-side push (card, PayNow).
                  const confirmBase =
                    `${window.location.origin}/${slug}/confirm?` +
                    `service=${encodeURIComponent(selectedService?.name ?? '')}` +
                    `&staff=${encodeURIComponent(resolvedStaffName)}` +
                    `&time=${encodeURIComponent(selectedSlot.start_time)}` +
                    `&amount=${encodeURIComponent(String(effectivePrice))}` +
                    `&paid=true`;

                  return (
                    <StripePaymentForm
                      amount={String(effectivePrice)}
                      returnUrl={confirmBase}
                      countdown={countdown}
                      onSuccess={(paymentIntentId) => {
                        router.push(
                          `/${slug}/confirm?ref=${encodeURIComponent(paymentIntentId)}` +
                          `&service=${encodeURIComponent(selectedService?.name ?? '')}` +
                          `&staff=${encodeURIComponent(resolvedStaffName)}` +
                          `&time=${encodeURIComponent(selectedSlot.start_time)}` +
                          `&amount=${encodeURIComponent(String(effectivePrice))}` +
                          `&paid=true`
                        );
                      }}
                      onError={(msg) => setConfirmError(msg)}
                    />
                  );
                })()}
                <p className="text-xs text-grey-45 text-center">
                  Payments are processed securely by Stripe.
                </p>
              </Elements>
            ) : (
              <>
                <button
                  onClick={handleConfirmBooking}
                  disabled={confirmLoading || countdown === 0}
                  className="w-full rounded-2xl bg-tone-ink py-4 text-base font-bold text-white hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed transition-all shadow-lg shadow-md active:scale-[0.98]"
                >
                  {confirmLoading ? (
                    <span className="flex items-center justify-center gap-2">
                      <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                      </svg>
                      Confirming your booking…
                    </span>
                  ) : countdown === 0 ? (
                    'Slot expired — please select a new time'
                  ) : (
                    `Confirm Booking — SGD ${effectivePrice.toFixed(2)}`
                  )}
                </button>
                <p className="text-xs text-grey-45 text-center">
                  By confirming you agree to the cancellation policy above.
                  Payment is collected at your appointment.
                </p>
              </>
            )}
              </>
            )}
                </>
              );
            })()}
          </div>
        </div>
      )}
    </div>
  );
}
