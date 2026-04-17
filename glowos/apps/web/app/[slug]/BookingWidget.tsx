'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch } from '../lib/api';

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
    <div className={`flex items-center gap-2 text-sm ${active ? 'text-indigo-600 font-semibold' : done ? 'text-green-600' : 'text-gray-400'}`}>
      <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold border-2 ${
        done ? 'bg-green-500 border-green-500 text-white' : active ? 'border-indigo-600 text-indigo-600' : 'border-gray-300 text-gray-400'
      }`}>
        {done ? '✓' : num}
      </span>
      <span className="hidden sm:inline">{label}</span>
    </div>
  );
}

// ── Main widget ───────────────────────────────────────────────────────────────

export default function BookingWidget({ merchant, services, staff, slug }: BookingWidgetProps) {
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
  const googleBtnRef = useRef<HTMLDivElement>(null);

  // Confirm
  const [confirmLoading, setConfirmLoading] = useState(false);
  const [confirmError, setConfirmError] = useState('');

  const days = next30Days();

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

  // Render Google button when step 4 is active and user hasn't signed in or chosen guest
  useEffect(() => {
    if (step !== 4 || authClient || isGuest || !googleClientId) return;
    if (!window.google || !googleBtnRef.current) {
      // Script may not be loaded yet — retry
      const timer = setTimeout(() => {
        if (window.google && googleBtnRef.current) {
          window.google.accounts.id.initialize({
            client_id: googleClientId,
            callback: handleGoogleSignIn,
          });
          window.google.accounts.id.renderButton(googleBtnRef.current, {
            theme: 'outline',
            size: 'large',
            width: 320,
            text: 'signin_with',
            shape: 'pill',
            logo_alignment: 'center',
          });
        }
      }, 500);
      return () => clearTimeout(timer);
    }
    window.google.accounts.id.initialize({
      client_id: googleClientId,
      callback: handleGoogleSignIn,
    });
    window.google.accounts.id.renderButton(googleBtnRef.current, {
      theme: 'outline',
      size: 'large',
      width: 320,
      text: 'signin_with',
      shape: 'pill',
      logo_alignment: 'center',
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, authClient, isGuest, googleClientId]);

  async function handleGoogleSignIn(response: { credential: string }) {
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
      // Remember for this session
      if (c.googleId) {
        sessionStorage.setItem(`glowos_google_id_${slug}`, c.googleId);
      }
    } catch (err) {
      setConfirmError(err instanceof Error ? err.message : 'Google sign-in failed');
    } finally {
      setAuthLoading(false);
    }
  }

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
    try {
      const dateStr = toDateStr(selectedDate);
      const params = new URLSearchParams({ service_id: selectedService.id, date: dateStr });
      if (selectedStaff.id !== 'any') params.append('staff_id', selectedStaff.id);
      const res = await apiFetch(`/booking/${slug}/availability?${params.toString()}`);
      setSlots((res.slots as TimeSlot[]) || []);
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
        }),
      });
      const bookingId = (res.booking as { id: string }).id;
      router.push(
        `/${slug}/confirm?booking_id=${bookingId}` +
        `&service=${encodeURIComponent(selectedService.name)}` +
        `&staff=${encodeURIComponent(selectedStaff?.id === 'any' ? 'Any Available' : (selectedStaff?.name || ''))}` +
        `&time=${encodeURIComponent(selectedSlot?.start_time || '')}` +
        `&amount=${encodeURIComponent(selectedService.priceSgd)}`
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

  const resolvedStaffName =
    selectedStaff?.id === 'any' ? 'Any Available' : (selectedStaff?.name ?? '');

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">

      {/* Step progress */}
      <div className="flex items-center justify-between px-1 pb-2">
        <StepBadge num={1} label="Service" active={step === 1} done={step > 1} />
        <div className={`flex-1 h-px mx-2 ${step > 1 ? 'bg-green-300' : 'bg-gray-200'}`} />
        <StepBadge num={2} label="Staff" active={step === 2} done={step > 2} />
        <div className={`flex-1 h-px mx-2 ${step > 2 ? 'bg-green-300' : 'bg-gray-200'}`} />
        <StepBadge num={3} label="Date & Time" active={step === 3} done={step > 3} />
        <div className={`flex-1 h-px mx-2 ${step > 3 ? 'bg-green-300' : 'bg-gray-200'}`} />
        <StepBadge num={4} label="Details" active={step === 4} done={step > 4} />
        <div className={`flex-1 h-px mx-2 ${step > 4 ? 'bg-green-300' : 'bg-gray-200'}`} />
        <StepBadge num={5} label="Confirm" active={step === 5} done={false} />
      </div>

      {/* ── Step 1: Select Service ─────────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <button
          onClick={() => setStep(1)}
          className="w-full px-6 py-4 border-b border-gray-100 bg-gray-50 flex items-center justify-between"
        >
          <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">
            1 — Select a Service
          </h2>
          {selectedService && step !== 1 && (
            <span className="text-sm text-indigo-600 font-medium truncate ml-4">{selectedService.name}</span>
          )}
        </button>

        {step === 1 && (
          <div className="divide-y divide-gray-50">
            {services.length === 0 && (
              <p className="px-6 py-8 text-center text-gray-400 text-sm">No services available right now.</p>
            )}
            {services.map((svc) => (
              <label
                key={svc.id}
                className={`flex items-start gap-3 px-6 py-4 cursor-pointer transition-colors ${
                  selectedService?.id === svc.id
                    ? 'bg-indigo-50 border-l-4 border-indigo-500'
                    : 'hover:bg-indigo-50 border-l-4 border-transparent'
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
                    <span className="text-sm font-semibold text-gray-900">{svc.name}</span>
                    <span className="text-sm font-bold text-indigo-600 shrink-0">
                      SGD {parseFloat(svc.priceSgd).toFixed(2)}
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5">{svc.durationMinutes} min</p>
                  {svc.description && (
                    <p className="text-xs text-gray-400 mt-1 leading-relaxed line-clamp-2">
                      {svc.description}
                    </p>
                  )}
                  {svc.requiresConsultFirst && (
                    <div className="mt-1 flex items-center gap-1 text-xs text-amber-400">
                      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                      </svg>
                      Book a consultation first
                    </div>
                  )}
                </div>
              </label>
            ))}
          </div>
        )}
      </div>

      {/* ── Step 2: Select Staff ───────────────────────────────────────────────── */}
      {selectedService && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <button
            onClick={() => setStep(2)}
            className="w-full px-6 py-4 border-b border-gray-100 bg-gray-50 flex items-center justify-between"
          >
            <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">
              2 — Select Your Staff
            </h2>
            {selectedStaff && step !== 2 && (
              <span className="text-sm text-indigo-600 font-medium truncate ml-4">{resolvedStaffName}</span>
            )}
          </button>

          {step === 2 && (
            <div className="divide-y divide-gray-50">
              {staffWithAny.map((s) => (
                <label
                  key={s.id}
                  className={`flex items-start gap-3 px-6 py-4 cursor-pointer transition-colors ${
                    selectedStaff?.id === s.id
                      ? 'bg-indigo-50 border-l-4 border-indigo-500'
                      : 'hover:bg-indigo-50 border-l-4 border-transparent'
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
                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-indigo-100 to-purple-100 border-2 border-dashed border-indigo-300 flex items-center justify-center text-indigo-400 text-lg shrink-0">
                      ✦
                    </div>
                  ) : s.photoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={s.photoUrl}
                      alt={s.name}
                      className="w-10 h-10 rounded-full object-cover border border-gray-100 shrink-0"
                    />
                  ) : (
                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-indigo-400 to-purple-500 flex items-center justify-center text-white text-sm font-bold shrink-0">
                      {s.name.charAt(0)}
                    </div>
                  )}
                  <div>
                    <div className="text-sm font-semibold text-gray-900">{s.name}</div>
                    {s.title && <div className="text-xs text-gray-400 mt-0.5">{s.title}</div>}
                    {s.bio && (
                      <p className="text-xs text-gray-400 mt-1 line-clamp-2">{s.bio}</p>
                    )}
                    {s.specialtyTags && s.specialtyTags.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {s.specialtyTags.map((tag) => (
                          <span
                            key={tag}
                            className="text-xs bg-gray-700 text-gray-300 rounded-full px-2 py-0.5"
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
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <button
            onClick={() => setStep(3)}
            className="w-full px-6 py-4 border-b border-gray-100 bg-gray-50 flex items-center justify-between"
          >
            <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">
              3 — Select Date &amp; Time
            </h2>
            {selectedSlot && selectedDate && step !== 3 && (
              <span className="text-sm text-indigo-600 font-medium truncate ml-4">
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
                  const isClosed = closedDates.has(dayStr);
                  return (
                    <button
                      key={dayStr}
                      onClick={() => !isClosed && handleDateSelect(day)}
                      disabled={isClosed}
                      className={`shrink-0 rounded-xl px-3 py-2.5 text-center border-2 transition-all ${
                        isClosed
                          ? 'border-gray-100 bg-gray-50 text-gray-300 cursor-not-allowed line-through'
                          : isSelected
                            ? 'bg-indigo-600 text-white border-indigo-600 shadow-md shadow-indigo-200'
                            : 'border-gray-200 text-gray-700 hover:border-indigo-300 hover:bg-indigo-50'
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
                    <div className="flex items-center justify-center py-8 gap-2 text-gray-400">
                      <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                      </svg>
                      <span className="text-sm">Loading available times…</span>
                    </div>
                  )}
                  {slotsError && (
                    <div className="rounded-xl bg-red-50 border border-red-100 px-4 py-3 text-sm text-red-600 text-center">
                      {slotsError}
                    </div>
                  )}
                  {!slotsLoading && !slotsError && slots.length === 0 && (
                    <div className="rounded-xl bg-gray-50 border border-gray-100 px-4 py-6 text-sm text-gray-500 text-center">
                      <div className="text-2xl mb-2">😔</div>
                      No availability on {formatDateFull(selectedDate)}.<br />
                      <span className="text-gray-400">Please try another day.</span>
                    </div>
                  )}
                  {!slotsLoading && slots.length > 0 && (
                    <>
                      <p className="text-xs text-gray-500 mb-3 font-medium uppercase tracking-wide">
                        {slots.length} time{slots.length !== 1 ? 's' : ''} available
                      </p>
                      {confirmError && !leaseId && (
                        <div className="mb-3 rounded-lg bg-red-50 border border-red-100 px-3 py-2 text-sm text-red-600">
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
                                  ? 'bg-indigo-600 text-white border-indigo-600 shadow-md shadow-indigo-200'
                                  : 'border-gray-200 text-gray-700 hover:border-indigo-400 hover:bg-indigo-50'
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
                <p className="text-sm text-gray-400 text-center py-4">
                  Pick a date above to see available times
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Step 4: Your Details ───────────────────────────────────────────────── */}
      {selectedSlot && leaseId && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <button
            onClick={() => setStep(4)}
            className="w-full px-6 py-4 border-b border-gray-100 bg-gray-50 flex items-center justify-between"
          >
            <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">
              4 — Your Details
            </h2>
            <div className="flex items-center gap-3">
              {clientName && step !== 4 && (
                <div className="flex items-center gap-2">
                  {authClient?.avatarUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={authClient.avatarUrl} alt="" className="w-5 h-5 rounded-full" />
                  )}
                  <span className="text-sm text-indigo-600 font-medium truncate">{clientName}</span>
                </div>
              )}
              {countdown > 0 && (
                <span className={`text-xs font-semibold px-2 py-1 rounded-full ${
                  countdown < 60
                    ? 'bg-red-100 text-red-600'
                    : 'bg-amber-50 text-amber-600'
                }`}>
                  {padTwo(Math.floor(countdown / 60))}:{padTwo(countdown % 60)}
                </span>
              )}
            </div>
          </button>

          {step === 4 && (
            <div className="px-6 py-5 space-y-4">
              {countdown > 0 && countdown < 120 && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-700 flex items-center gap-2">
                  <span className="text-lg">⏰</span>
                  <span>Slot held for <strong>{padTwo(Math.floor(countdown / 60))}:{padTwo(countdown % 60)}</strong> — complete your booking before it expires</span>
                </div>
              )}

              {/* ── Auth choice: Google Sign-In or Guest ─────────────────── */}
              {!authClient && !isGuest && (
                <div className="space-y-4">
                  <div className="text-center">
                    <p className="text-sm text-gray-600 mb-1">Sign in to save your details for faster booking next time</p>
                    <p className="text-xs text-gray-400">We&apos;ll remember you on your next visit</p>
                  </div>

                  {/* Google Sign-In button container */}
                  {googleClientId && (
                    <div className="flex justify-center">
                      {authLoading ? (
                        <div className="flex items-center gap-2 px-6 py-3 rounded-full border-2 border-gray-200 text-sm text-gray-500">
                          <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                          </svg>
                          Signing in...
                        </div>
                      ) : (
                        <div ref={googleBtnRef} />
                      )}
                    </div>
                  )}

                  {/* Divider */}
                  <div className="flex items-center gap-3">
                    <div className="flex-1 h-px bg-gray-200" />
                    <span className="text-xs text-gray-400 font-medium">or</span>
                    <div className="flex-1 h-px bg-gray-200" />
                  </div>

                  {/* Continue as Guest */}
                  <button
                    onClick={() => setIsGuest(true)}
                    className="w-full rounded-xl border-2 border-gray-200 py-3 text-sm font-semibold text-gray-600 hover:border-gray-300 hover:bg-gray-50 transition-colors"
                  >
                    Continue as Guest
                  </button>
                </div>
              )}

              {/* ── Signed-in user info ──────────────────────────────── */}
              {authClient && (
                <div className="bg-gradient-to-r from-indigo-50 to-purple-50 rounded-xl border border-indigo-100 px-4 py-3">
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
                        <div className="w-10 h-10 rounded-full bg-indigo-500 flex items-center justify-center text-white text-sm font-bold">
                          {(authClient.name ?? 'U').charAt(0).toUpperCase()}
                        </div>
                      )}
                      <div>
                        <p className="text-sm font-semibold text-gray-900">{authClient.name ?? 'User'}</p>
                        {authClient.email && (
                          <p className="text-xs text-gray-500">{authClient.email}</p>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={handleSignOut}
                      className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
                    >
                      Switch
                    </button>
                  </div>
                </div>
              )}

              {/* ── Form fields (shown when auth'd or guest) ──────── */}
              {(authClient || isGuest) && (
                <>
                  {/* Name */}
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                      Full name <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={clientName}
                      onChange={(e) => setClientName(e.target.value)}
                      autoComplete="name"
                      className="w-full rounded-xl border-2 border-gray-200 px-4 py-3 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 transition-colors"
                      placeholder="Jane Tan"
                    />
                  </div>

                  {/* Phone */}
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                      Mobile number <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="tel"
                      value={clientPhone}
                      onChange={(e) => setClientPhone(e.target.value)}
                      autoComplete="tel"
                      className="w-full rounded-xl border-2 border-gray-200 px-4 py-3 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 transition-colors"
                      placeholder="+65 9123 4567"
                    />
                  </div>

                  {/* Email */}
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                      Email <span className="text-gray-400 font-normal">(optional)</span>
                    </label>
                    <input
                      type="email"
                      value={clientEmail}
                      onChange={(e) => setClientEmail(e.target.value)}
                      autoComplete="email"
                      className="w-full rounded-xl border-2 border-gray-200 px-4 py-3 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 transition-colors"
                      placeholder="jane@example.com"
                    />
                  </div>

                  <button
                    onClick={() => {
                      if (!clientName.trim() || !clientPhone.trim()) {
                        setConfirmError('Please fill in your name and mobile number');
                        return;
                      }
                      setConfirmError('');
                      setStep(5);
                    }}
                    disabled={!clientName.trim() || !clientPhone.trim()}
                    className="w-full rounded-xl bg-indigo-600 py-3.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    Continue to Review
                  </button>
                </>
              )}

              {confirmError && (
                <div className="rounded-xl bg-red-50 border border-red-100 px-4 py-3 text-sm text-red-600">
                  {confirmError}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Step 5: Confirm & Pay ──────────────────────────────────────────────── */}
      {selectedSlot && leaseId && clientName && clientPhone && step === 5 && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100 bg-gray-50 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">
              5 — Review &amp; Confirm
            </h2>
            {countdown > 0 && (
              <span className={`text-xs font-semibold px-2 py-1 rounded-full ${
                countdown < 60 ? 'bg-red-100 text-red-600' : 'bg-amber-50 text-amber-600'
              }`}>
                ⏱ {padTwo(Math.floor(countdown / 60))}:{padTwo(countdown % 60)}
              </span>
            )}
          </div>

          <div className="px-6 py-5 space-y-4">
            {/* Booking summary card */}
            <div className="bg-gradient-to-br from-indigo-50 to-purple-50 rounded-2xl p-5 border border-indigo-100 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs text-indigo-500 font-semibold uppercase tracking-wide mb-0.5">Service</p>
                  <p className="text-base font-bold text-gray-900">{selectedService?.name}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{selectedService?.durationMinutes} min</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-xs text-indigo-500 font-semibold uppercase tracking-wide mb-0.5">Price</p>
                  <p className="text-xl font-bold text-indigo-700">
                    SGD {parseFloat(selectedService?.priceSgd || '0').toFixed(2)}
                  </p>
                </div>
              </div>

              <div className="border-t border-indigo-100 pt-3 grid grid-cols-2 gap-3">
                <div>
                  <p className="text-xs text-gray-500 mb-0.5">Staff</p>
                  <p className="text-sm font-semibold text-gray-800">{resolvedStaffName}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500 mb-0.5">Date</p>
                  <p className="text-sm font-semibold text-gray-800">
                    {selectedDate ? formatDateFull(selectedDate).split(',').slice(0, 2).join(',') : ''}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-gray-500 mb-0.5">Time</p>
                  <p className="text-sm font-semibold text-gray-800">{formatTime(selectedSlot.start_time)}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500 mb-0.5">Payment</p>
                  <p className="text-sm font-semibold text-gray-800">Pay at appointment</p>
                </div>
              </div>

              <div className="border-t border-indigo-100 pt-3">
                <p className="text-xs text-gray-500 mb-0.5">Name</p>
                <p className="text-sm font-semibold text-gray-800">{clientName}</p>
                <p className="text-xs text-gray-500 mt-2 mb-0.5">Mobile</p>
                <p className="text-sm font-semibold text-gray-800">{clientPhone}</p>
                {clientEmail && (
                  <>
                    <p className="text-xs text-gray-500 mt-2 mb-0.5">Email</p>
                    <p className="text-sm font-semibold text-gray-800">{clientEmail}</p>
                  </>
                )}
              </div>
            </div>

            {/* Cancellation policy */}
            <div className="bg-amber-50 border border-amber-100 rounded-xl px-4 py-3.5">
              <h3 className="text-xs font-bold text-amber-800 uppercase tracking-wide mb-1">
                Cancellation Policy
              </h3>
              <p className="text-xs text-amber-700 leading-relaxed">
                Cancellations made more than 24 hours before your appointment are eligible for a
                full refund. Late cancellations may receive a partial refund as per the business&apos;s
                policy. A cancellation link will be sent to you via WhatsApp.
              </p>
            </div>

            {confirmError && (
              <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-600">
                {confirmError}
              </div>
            )}

            {/* Confirm button */}
            <button
              onClick={handleConfirmBooking}
              disabled={confirmLoading || countdown === 0}
              className="w-full rounded-2xl bg-indigo-600 py-4 text-base font-bold text-white hover:bg-indigo-700 disabled:opacity-60 disabled:cursor-not-allowed transition-all shadow-lg shadow-indigo-200 active:scale-[0.98]"
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
                `Confirm Booking — SGD ${parseFloat(selectedService?.priceSgd || '0').toFixed(2)}`
              )}
            </button>

            <p className="text-xs text-gray-400 text-center">
              By confirming you agree to the cancellation policy above.
              Payment is collected at your appointment.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
