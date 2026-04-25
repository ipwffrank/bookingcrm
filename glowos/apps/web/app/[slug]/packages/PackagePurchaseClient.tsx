'use client';

import { useEffect, useMemo, useState } from 'react';
import { loadStripe, type Stripe } from '@stripe/stripe-js';
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';
import { apiFetch } from '../../lib/api';
import { PhoneInput } from '../components/PhoneInput';

// ─── Types ─────────────────────────────────────────────────────────────────────

interface PackageTemplate {
  id: string;
  name: string;
  description: string | null;
  priceSgd: string;
  totalSessions: number;
  validityDays: number;
  isActive: boolean;
  requiresConsultFirst: boolean;
  includedServices: Array<{ serviceId: string; serviceName: string; quantity: number }>;
}

interface SalonStaff {
  id: string;
  name: string;
  title: string | null;
  serviceIds?: string[];
}

interface SalonService {
  id: string;
  name: string;
  durationMinutes: number;
}

interface TimeSlot {
  start_time: string;
  end_time: string;
  staff_id: string;
}

interface PurchaseResponse {
  clientPackage: {
    id: string;
    packageName: string;
    sessionsTotal: number;
    expiresAt: string;
    paymentMethod: 'online' | 'counter';
    pricePaidSgd: string;
    priceDueSgd: string;
  };
  firstBooking: {
    id: string;
    startTime: string;
    serviceId: string;
    staffId: string;
  } | null;
  payment: { clientSecret: string; stripeAccountId: string } | null;
}

interface Props {
  slug: string;
  packages: PackageTemplate[];
  defaultCountry: 'SG' | 'MY';
  paymentEnabled: boolean;
  consultServiceId: string | null;
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(d: Date): string {
  return d.toLocaleDateString('en-SG', { weekday: 'short', day: 'numeric', month: 'short' });
}
function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function next14Days(): Date[] {
  const days: Date[] = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  for (let i = 0; i < 14; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    days.push(d);
  }
  return days;
}
function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-SG', { hour: 'numeric', minute: '2-digit' });
}

// ─── Stripe payment form (rendered inside <Elements>) ─────────────────────────

function PackageStripeForm({
  amount,
  onSuccess,
}: {
  amount: number;
  onSuccess: (paymentIntentId: string) => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!stripe || !elements) return;
    setProcessing(true);
    setError('');
    const result = await stripe.confirmPayment({
      elements,
      redirect: 'if_required',
      // No return_url needed for card; redirect-based methods (GrabPay, PayNow)
      // would bounce through the current page and hit the same finalisation.
      confirmParams: { return_url: typeof window !== 'undefined' ? window.location.href : '' },
    });
    if (result.error) {
      setError(result.error.message ?? 'Payment failed');
      setProcessing(false);
      return;
    }
    const intentId = result.paymentIntent?.id;
    if (intentId && (result.paymentIntent?.status === 'succeeded' || result.paymentIntent?.status === 'processing')) {
      onSuccess(intentId);
    } else {
      setProcessing(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <PaymentElement options={{ layout: 'tabs' }} />
      {error && (
        <div className="rounded-lg bg-semantic-danger/5 border border-semantic-danger/30 px-3 py-2 text-xs text-semantic-danger">
          {error}
        </div>
      )}
      <button
        type="submit"
        disabled={!stripe || processing}
        className="w-full rounded-xl bg-tone-ink text-tone-surface py-3 text-sm font-semibold hover:opacity-90 disabled:opacity-50 transition-opacity"
      >
        {processing ? 'Processing payment…' : `Pay SGD ${amount.toFixed(2)}`}
      </button>
      <p className="text-[11px] text-grey-60 text-center">
        Payments are processed securely by Stripe.
      </p>
    </form>
  );
}

// ─── Wizard (one instance per expanded package) ───────────────────────────────

type WizardStep = 'contact' | 'session' | 'review' | 'paying' | 'confirming' | 'done';

function PurchaseWizard({
  pkg,
  slug,
  defaultCountry,
  paymentEnabled,
  staff,
  servicesById,
  onClose,
}: {
  pkg: PackageTemplate;
  slug: string;
  defaultCountry: 'SG' | 'MY';
  paymentEnabled: boolean;
  staff: SalonStaff[];
  servicesById: Map<string, SalonService>;
  onClose: () => void;
}) {
  const distinctServices = pkg.includedServices.map((s) => s.serviceId);
  const onlyOneService = new Set(distinctServices).size === 1;

  // Step state
  const [step, setStep] = useState<WizardStep>('contact');

  // Contact
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');

  // Returning-customer lookup — debounced, mirrors the booking widget so the
  // package flow recognises existing clients and reassures them their profile
  // will be reused (instead of creating a duplicate or overwriting their
  // saved name/email at the merchant).
  const [lookupResult, setLookupResult] = useState<{ matched: boolean; masked_name?: string } | null>(null);
  useEffect(() => {
    const p = phone.trim();
    const e = email.trim();
    const hasPhone = p.length >= 6;
    const hasEmail = e.includes('@');
    if (!hasPhone && !hasEmail) {
      setLookupResult(null);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const res = (await apiFetch(`/booking/${slug}/lookup-client`, {
          method: 'POST',
          body: JSON.stringify({
            ...(hasPhone ? { phone: p } : {}),
            ...(hasEmail ? { email: e } : {}),
          }),
        })) as { matched: boolean; masked_name?: string };
        setLookupResult(res);
      } catch {
        setLookupResult(null);
      }
    }, 500);
    return () => clearTimeout(t);
  }, [phone, email, slug]);

  // First-session selection
  const [serviceId, setServiceId] = useState<string>(onlyOneService ? distinctServices[0]! : '');
  const [staffId, setStaffId] = useState<string>('');
  const [date, setDate] = useState<Date | null>(null);
  const [slot, setSlot] = useState<TimeSlot | null>(null);
  const [slots, setSlots] = useState<TimeSlot[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);

  // Payment
  const [paymentMethod, setPaymentMethod] = useState<'online' | 'counter'>(
    paymentEnabled ? 'online' : 'counter',
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [purchase, setPurchase] = useState<PurchaseResponse | null>(null);

  // Stripe
  const [stripePromise, setStripePromise] = useState<Promise<Stripe | null> | null>(null);
  useEffect(() => {
    const key = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
    const accountId = purchase?.payment?.stripeAccountId;
    if (!key || !accountId) {
      setStripePromise(null);
      return;
    }
    setStripePromise(loadStripe(key, { stripeAccount: accountId }));
  }, [purchase?.payment?.stripeAccountId]);

  // Eligible staff for the chosen service
  const eligibleStaff = useMemo(() => {
    if (!serviceId) return staff;
    return staff.filter((s) => (s.serviceIds ?? []).includes(serviceId));
  }, [serviceId, staff]);

  // Fetch slots whenever service/staff/date changes
  useEffect(() => {
    if (!serviceId || !staffId || !date) {
      setSlots([]);
      return;
    }
    setSlotsLoading(true);
    setSlots([]);
    const params = new URLSearchParams({ service_id: serviceId, date: dateKey(date) });
    if (staffId !== 'any') params.append('staff_id', staffId);
    apiFetch(`/booking/${slug}/availability?${params.toString()}`)
      .then((res) => setSlots((res.slots as TimeSlot[]) ?? []))
      .catch(() => setSlots([]))
      .finally(() => setSlotsLoading(false));
  }, [slug, serviceId, staffId, date]);

  const days = useMemo(() => next14Days(), []);

  // ── Submitters ──────────────────────────────────────────────────────────────
  async function submitPurchase() {
    setError('');
    if (!name.trim() || !phone.trim()) {
      setError('Name and mobile number are required.');
      setStep('contact');
      return;
    }
    if (!serviceId || !staffId || !slot) {
      setError('Please pick a service, staff, and time for your first session.');
      setStep('session');
      return;
    }
    setSubmitting(true);
    try {
      const resolvedStaffId =
        staffId === 'any' ? slot.staff_id : staffId;
      const res = (await apiFetch(`/booking/${slug}/packages/purchase`, {
        method: 'POST',
        body: JSON.stringify({
          package_id: pkg.id,
          client_name: name.trim(),
          client_phone: phone.trim(),
          client_email: email.trim() || undefined,
          payment_method: paymentMethod,
          first_session: {
            service_id: serviceId,
            staff_id: resolvedStaffId,
            start_time: slot.start_time,
          },
        }),
      })) as PurchaseResponse;
      setPurchase(res);
      if (paymentMethod === 'online' && res.payment) {
        setStep('paying');
      } else {
        setStep('done');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Purchase failed.');
      setSubmitting(false);
    }
  }

  async function handlePaid(paymentIntentId: string) {
    if (!purchase) return;
    // Flip out of the Stripe form immediately so the user sees a "payment
    // received" state while we ping mark-paid in the background. Without this
    // they stare at the Stripe button stuck on "Processing payment…" for the
    // 1-3s the API call takes.
    setStep('confirming');
    try {
      await apiFetch(`/booking/${slug}/packages/mark-paid`, {
        method: 'POST',
        body: JSON.stringify({
          client_package_id: purchase.clientPackage.id,
          payment_intent_id: paymentIntentId,
        }),
      });
      setStep('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Payment confirmation failed — please contact the clinic.');
      // Stay on 'confirming' to surface the error message; charge has already
      // succeeded with Stripe, so we don't want to send them back to pay again.
    }
  }

  // ── Render per step ─────────────────────────────────────────────────────────

  if (step === 'confirming') {
    return (
      <div className="text-center py-3">
        <div className="w-10 h-10 mx-auto mb-2 border-3 border-tone-sage/30 border-t-tone-sage rounded-full animate-spin" />
        <p className="text-sm font-semibold text-tone-ink">Payment received — confirming your booking…</p>
        <p className="text-xs text-grey-60 mt-1">Don&apos;t close this window.</p>
        {error && (
          <div className="mt-3 rounded-lg bg-semantic-danger/5 border border-semantic-danger/30 px-3 py-2 text-xs text-semantic-danger text-left">
            {error}
          </div>
        )}
      </div>
    );
  }

  if (step === 'done' && purchase) {
    const startISO = purchase.firstBooking?.startTime;
    const start = startISO ? new Date(startISO) : null;
    const staffName = staff.find((s) => s.id === purchase.firstBooking?.staffId)?.name ?? '';
    const serviceName = servicesById.get(purchase.firstBooking?.serviceId ?? '')?.name ?? '';
    return (
      <div className="text-center py-2">
        <div className="w-12 h-12 bg-tone-sage/10 text-tone-sage rounded-full mx-auto flex items-center justify-center text-2xl mb-2">✓</div>
        <p className="text-sm font-semibold text-tone-ink">Package purchased!</p>
        {start && (
          <p className="text-xs text-grey-75 mt-1">
            First session booked: <strong>{serviceName}</strong> with <strong>{staffName}</strong>
            <br />
            {start.toLocaleString('en-SG', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}
          </p>
        )}
        <p className="text-[11px] text-grey-60 mt-2">
          {purchase.clientPackage.paymentMethod === 'online'
            ? 'Payment received. See you soon!'
            : `Pay SGD ${parseFloat(purchase.clientPackage.priceDueSgd).toFixed(2)} at the clinic on your first visit.`}
        </p>
        <p className="text-[11px] text-grey-60 mt-1">
          {purchase.clientPackage.sessionsTotal} sessions valid until{' '}
          {new Date(purchase.clientPackage.expiresAt).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' })}
        </p>
        <div className="flex gap-2 mt-4">
          <button
            onClick={onClose}
            className="flex-1 rounded-xl bg-tone-ink text-tone-surface py-2.5 text-sm font-medium hover:opacity-90 transition-opacity"
          >
            Done
          </button>
        </div>
      </div>
    );
  }

  if (step === 'paying' && purchase?.payment && stripePromise) {
    const amount = parseFloat(pkg.priceSgd);
    return (
      <Elements
        stripe={stripePromise}
        options={{
          clientSecret: purchase.payment.clientSecret,
          appearance: { theme: 'stripe', variables: { colorPrimary: '#456466', borderRadius: '12px' } },
        }}
      >
        <div className="space-y-3">
          <div className="rounded-lg bg-tone-sage/5 border border-tone-sage/30 px-3 py-2 text-xs text-tone-sage">
            Slot reserved. Complete payment to confirm your booking.
          </div>
          <PackageStripeForm amount={amount} onSuccess={handlePaid} />
          <button
            onClick={onClose}
            type="button"
            className="block w-full text-center text-xs text-grey-60 hover:underline"
          >
            Cancel
          </button>
        </div>
      </Elements>
    );
  }

  // Combined contact + session + review form (single column, scrollable)
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (step === 'contact') {
          if (!name.trim() || !phone.trim()) {
            setError('Name and mobile number are required.');
            return;
          }
          setError('');
          setStep('session');
        } else if (step === 'session') {
          if (!serviceId || !staffId || !slot) {
            setError('Please pick a service, staff, and time.');
            return;
          }
          setError('');
          setStep('review');
        } else if (step === 'review') {
          submitPurchase();
        }
      }}
      className="space-y-3"
    >
      {/* Step indicator */}
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-grey-60">
        <span className={step === 'contact' ? 'text-tone-ink' : ''}>1. Your details</span>
        <span>›</span>
        <span className={step === 'session' ? 'text-tone-ink' : ''}>2. First session</span>
        <span>›</span>
        <span className={step === 'review' ? 'text-tone-ink' : ''}>3. Pay</span>
      </div>

      {/* ── Step 1: contact ─── */}
      {step === 'contact' && (
        <>
          {lookupResult?.matched && (
            <div className="rounded-lg bg-tone-sage/10 border border-tone-sage/30 px-3 py-2 text-xs text-tone-sage">
              <p className="font-semibold mb-0.5">Welcome back, {lookupResult.masked_name ?? 'there'}!</p>
              We&apos;ll link this purchase to your existing profile.
            </div>
          )}
          <div>
            <label className="block text-xs font-medium text-grey-75 mb-1">Your name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Jane Tan"
              className="w-full rounded-lg border border-grey-15 bg-tone-surface px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-tone-sage"
              autoComplete="name"
              autoFocus
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-grey-75 mb-1">Mobile number</label>
            <PhoneInput
              value={phone}
              onChange={setPhone}
              defaultCountry={defaultCountry}
              placeholder="9123 4567"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-grey-75 mb-1">Email (optional)</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="jane@example.com"
              className="w-full rounded-lg border border-grey-15 bg-tone-surface px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-tone-sage"
              autoComplete="email"
            />
          </div>
        </>
      )}

      {/* ── Step 2: first session ─── */}
      {step === 'session' && (
        <>
          {!onlyOneService && (
            <div>
              <label className="block text-xs font-medium text-grey-75 mb-1">First treatment</label>
              <select
                value={serviceId}
                onChange={(e) => {
                  setServiceId(e.target.value);
                  setStaffId('');
                  setSlot(null);
                }}
                className="w-full rounded-lg border border-grey-15 bg-tone-surface px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-tone-sage"
              >
                <option value="">Choose a treatment in this package…</option>
                {pkg.includedServices.map((s) => (
                  <option key={s.serviceId} value={s.serviceId}>
                    {s.serviceName} (×{s.quantity})
                  </option>
                ))}
              </select>
            </div>
          )}

          {serviceId && (
            <div>
              <label className="block text-xs font-medium text-grey-75 mb-1">Staff</label>
              <div className="grid grid-cols-1 gap-1.5">
                {eligibleStaff.length === 0 && (
                  <p className="text-xs text-grey-60 italic">No staff are configured for this treatment yet.</p>
                )}
                {eligibleStaff.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => {
                      setStaffId(s.id);
                      setSlot(null);
                    }}
                    className={`text-left rounded-lg border px-3 py-2 text-sm transition-colors ${
                      staffId === s.id
                        ? 'border-tone-sage bg-tone-sage/10 text-tone-ink'
                        : 'border-grey-15 bg-tone-surface text-grey-75 hover:border-tone-sage/50'
                    }`}
                  >
                    <div className="font-medium">{s.name}</div>
                    {s.title && <div className="text-[11px] text-grey-60">{s.title}</div>}
                  </button>
                ))}
              </div>
            </div>
          )}

          {staffId && (
            <div>
              <label className="block text-xs font-medium text-grey-75 mb-1">Date</label>
              <div className="flex gap-1.5 overflow-x-auto pb-1">
                {days.map((d) => (
                  <button
                    key={d.toISOString()}
                    type="button"
                    onClick={() => setDate(d)}
                    className={`flex-shrink-0 rounded-lg border px-3 py-1.5 text-xs whitespace-nowrap ${
                      date && dateKey(date) === dateKey(d)
                        ? 'border-tone-sage bg-tone-sage/10 text-tone-ink font-semibold'
                        : 'border-grey-15 bg-tone-surface text-grey-75 hover:border-tone-sage/50'
                    }`}
                  >
                    {formatDate(d)}
                  </button>
                ))}
              </div>
            </div>
          )}

          {date && (
            <div>
              <label className="block text-xs font-medium text-grey-75 mb-1">Time</label>
              {slotsLoading ? (
                <p className="text-xs text-grey-60 italic">Loading slots…</p>
              ) : slots.length === 0 ? (
                <p className="text-xs text-grey-60 italic">No slots available on this day. Try another date.</p>
              ) : (
                <div className="grid grid-cols-3 gap-1.5">
                  {slots.map((s) => (
                    <button
                      key={s.start_time}
                      type="button"
                      onClick={() => setSlot(s)}
                      className={`rounded-lg border px-2 py-1.5 text-xs ${
                        slot?.start_time === s.start_time
                          ? 'border-tone-sage bg-tone-sage/10 text-tone-ink font-semibold'
                          : 'border-grey-15 bg-tone-surface text-grey-75 hover:border-tone-sage/50'
                      }`}
                    >
                      {timeLabel(s.start_time)}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* ── Step 3: review + payment method ─── */}
      {step === 'review' && (
        <>
          <div className="rounded-lg bg-grey-5 border border-grey-15 px-3 py-3 space-y-1 text-xs text-grey-75">
            <div className="flex justify-between">
              <span className="text-grey-60">Package</span>
              <span className="font-semibold text-tone-ink">{pkg.name}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-grey-60">First session</span>
              <span className="text-tone-ink">
                {servicesById.get(serviceId)?.name} · {staff.find((s) => s.id === staffId)?.name}
              </span>
            </div>
            {slot && (
              <div className="flex justify-between">
                <span className="text-grey-60">When</span>
                <span className="text-tone-ink">
                  {new Date(slot.start_time).toLocaleString('en-SG', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}
                </span>
              </div>
            )}
            <div className="flex justify-between border-t border-grey-15 pt-2 mt-2">
              <span className="text-grey-60">Total</span>
              <span className="font-bold text-tone-sage">SGD {parseFloat(pkg.priceSgd).toFixed(2)}</span>
            </div>
          </div>

          <div>
            <p className="text-xs font-medium text-grey-75 mb-1.5">Payment</p>
            <div className="space-y-1.5">
              {paymentEnabled && (
                <label
                  className={`flex items-start gap-2 rounded-lg border px-3 py-2 cursor-pointer ${
                    paymentMethod === 'online'
                      ? 'border-tone-sage bg-tone-sage/10'
                      : 'border-grey-15 bg-tone-surface hover:border-tone-sage/50'
                  }`}
                >
                  <input
                    type="radio"
                    name="payment_method"
                    value="online"
                    checked={paymentMethod === 'online'}
                    onChange={() => setPaymentMethod('online')}
                    className="mt-0.5"
                  />
                  <div className="flex-1">
                    <div className="text-sm font-medium text-tone-ink">Pay online now</div>
                    <div className="text-[11px] text-grey-60">Card, PayNow, or GrabPay via Stripe.</div>
                  </div>
                </label>
              )}
              <label
                className={`flex items-start gap-2 rounded-lg border px-3 py-2 cursor-pointer ${
                  paymentMethod === 'counter'
                    ? 'border-tone-sage bg-tone-sage/10'
                    : 'border-grey-15 bg-tone-surface hover:border-tone-sage/50'
                }`}
              >
                <input
                  type="radio"
                  name="payment_method"
                  value="counter"
                  checked={paymentMethod === 'counter'}
                  onChange={() => setPaymentMethod('counter')}
                  className="mt-0.5"
                />
                <div className="flex-1">
                  <div className="text-sm font-medium text-tone-ink">Pay at counter on first visit</div>
                  <div className="text-[11px] text-grey-60">Cash, card, or PayNow accepted at the clinic.</div>
                </div>
              </label>
            </div>
          </div>
        </>
      )}

      {error && (
        <div className="rounded-lg bg-semantic-danger/5 border border-semantic-danger/30 px-3 py-2 text-xs text-semantic-danger">
          {error}
        </div>
      )}

      <div className="flex gap-2 pt-1">
        <button
          type="button"
          onClick={() => {
            if (step === 'session') setStep('contact');
            else if (step === 'review') setStep('session');
            else onClose();
          }}
          className="flex-1 rounded-xl border border-grey-15 bg-tone-surface py-2.5 text-sm font-medium text-grey-75 hover:bg-grey-5 transition-colors"
        >
          {step === 'contact' ? 'Cancel' : 'Back'}
        </button>
        <button
          type="submit"
          disabled={submitting}
          className="flex-1 rounded-xl bg-tone-ink text-tone-surface py-2.5 text-sm font-semibold hover:opacity-90 disabled:opacity-50 transition-opacity"
        >
          {step === 'contact' && 'Next'}
          {step === 'session' && 'Next'}
          {step === 'review' && (submitting ? 'Reserving…' : paymentMethod === 'online' ? 'Continue to payment' : 'Reserve package')}
        </button>
      </div>
    </form>
  );
}

// ─── Container ────────────────────────────────────────────────────────────────

export default function PackagePurchaseClient({ slug, packages, defaultCountry, paymentEnabled, consultServiceId }: Props) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [staff, setStaff] = useState<SalonStaff[]>([]);
  const [services, setServices] = useState<SalonService[]>([]);

  // Lazy-load staff + services for the wizard. Same shape as BookingWidget uses.
  useEffect(() => {
    apiFetch(`/booking/${slug}`)
      .then((d) => {
        const data = d as { staff?: SalonStaff[]; services?: SalonService[] };
        setStaff(data.staff ?? []);
        setServices(data.services ?? []);
      })
      .catch(() => {});
  }, [slug]);

  const servicesById = useMemo(() => {
    const m = new Map<string, SalonService>();
    for (const s of services) m.set(s.id, s);
    return m;
  }, [services]);

  return (
    <div className="space-y-3">
      {packages.map((pkg) => {
        const isOpen = openId === pkg.id;
        const totalItems = pkg.includedServices.reduce((s, x) => s + x.quantity, 0);
        return (
          <div key={pkg.id} className="bg-tone-surface rounded-xl border border-grey-15 overflow-hidden">
            <div className="p-5">
              <div className="flex items-start justify-between gap-3 mb-1">
                <div className="min-w-0 flex-1">
                  <h2 className="text-lg font-bold text-tone-ink">{pkg.name}</h2>
                  <p className="text-xs text-grey-60 mt-0.5">
                    {pkg.totalSessions} session{pkg.totalSessions === 1 ? '' : 's'} · Valid {pkg.validityDays} days
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-xs text-grey-60 uppercase tracking-wider">Price</p>
                  <p className="text-2xl font-bold text-tone-sage">SGD {parseFloat(pkg.priceSgd).toFixed(2)}</p>
                </div>
              </div>

              {pkg.description && (
                <p className="text-sm text-grey-75 mt-2 leading-relaxed">{pkg.description}</p>
              )}

              {pkg.includedServices.length > 0 && (
                <div className="mt-3 pt-3 border-t border-grey-5">
                  <p className="text-[11px] uppercase tracking-wider text-grey-60 font-semibold mb-1.5">
                    Includes ({totalItems} {totalItems === 1 ? 'item' : 'items'})
                  </p>
                  <ul className="text-sm text-grey-90 space-y-0.5">
                    {pkg.includedServices.map((svc) => (
                      <li key={svc.serviceId} className="flex items-center gap-2">
                        <span className="text-tone-sage text-xs">✓</span>
                        <span className="truncate">
                          {svc.serviceName}
                          {svc.quantity > 1 && <span className="text-grey-60"> × {svc.quantity}</span>}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {pkg.requiresConsultFirst ? (
                <div className="mt-4 space-y-2">
                  <div className="rounded-lg bg-semantic-warn/10 border border-semantic-warn/30 px-3 py-3 text-xs text-grey-75">
                    <p className="font-semibold text-tone-ink mb-0.5">Consultation required</p>
                    This package can only be purchased after an in-person consultation. After
                    your consult, the clinic will send a personalised quote with a secure
                    payment link.
                  </div>
                  {consultServiceId ? (
                    <a
                      href={`/${slug}?service=${consultServiceId}`}
                      className="block w-full text-center rounded-xl bg-tone-ink text-tone-surface py-3 text-sm font-semibold hover:opacity-90 transition-opacity"
                    >
                      Book consultation
                    </a>
                  ) : (
                    <a
                      href={`/${slug}`}
                      className="block w-full text-center rounded-xl border border-grey-15 bg-tone-surface py-3 text-sm font-semibold text-tone-ink hover:border-tone-sage/50 transition-colors"
                    >
                      Visit booking page
                    </a>
                  )}
                </div>
              ) : !isOpen ? (
                <button
                  onClick={() => setOpenId(pkg.id)}
                  className="mt-4 w-full rounded-xl bg-tone-ink text-tone-surface py-3 text-sm font-semibold hover:opacity-90 transition-opacity"
                >
                  Buy Package
                </button>
              ) : null}
            </div>

            {isOpen && (
              <div className="border-t border-grey-15 bg-grey-5 p-5">
                <PurchaseWizard
                  pkg={pkg}
                  slug={slug}
                  defaultCountry={defaultCountry}
                  paymentEnabled={paymentEnabled}
                  staff={staff}
                  servicesById={servicesById}
                  onClose={() => setOpenId(null)}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
