'use client';

import { useState, useEffect, useCallback } from 'react';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, CardElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { useRouter } from 'next/navigation';
import { apiFetch } from '../lib/api';

const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || '');

interface Service {
  id: string;
  name: string;
  description: string | null;
  durationMinutes: number;
  priceSgd: string;
  category: string;
}

interface StaffMember {
  id: string;
  name: string;
  photoUrl: string | null;
  title: string | null;
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

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-SG', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

function formatDate(d: Date): string {
  return d.toLocaleDateString('en-SG', { weekday: 'short', day: 'numeric', month: 'short' });
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
  return d.toISOString().slice(0, 10);
}

// ── Inner payment form ────────────────────────────────────────────────────────

interface PaymentFormProps {
  clientSecret: string;
  amount: string;
  slug: string;
  leaseId: string;
  serviceId: string;
  clientName: string;
  clientPhone: string;
  clientEmail: string;
  onSuccess: (bookingId: string) => void;
  onError: (msg: string) => void;
}

function PaymentForm({
  clientSecret,
  amount,
  slug,
  leaseId,
  serviceId,
  clientName,
  clientPhone,
  clientEmail,
  onSuccess,
  onError,
}: PaymentFormProps) {
  const stripe = useStripe();
  const elements = useElements();
  const [paying, setPaying] = useState(false);

  async function handleConfirm() {
    if (!stripe || !elements) return;
    setPaying(true);
    try {
      const card = elements.getElement(CardElement);
      if (!card) throw new Error('Card element not found');

      const result = await stripe.confirmCardPayment(clientSecret, {
        payment_method: {
          card,
          billing_details: { name: clientName, email: clientEmail || undefined },
        },
      });

      if (result.error) {
        onError(result.error.message || 'Payment failed');
        return;
      }

      if (result.paymentIntent?.status === 'succeeded') {
        // Confirm booking on our backend
        const res = await apiFetch(`/booking/${slug}/confirm`, {
          method: 'POST',
          body: JSON.stringify({
            lease_id: leaseId,
            client_name: clientName,
            client_phone: clientPhone,
            client_email: clientEmail || undefined,
            payment_method: result.paymentIntent.id,
          }),
        });
        onSuccess(res.booking.id as string);
      }
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Payment failed');
    } finally {
      setPaying(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="border border-gray-200 rounded-lg p-4 bg-white">
        <CardElement
          options={{
            style: {
              base: {
                fontSize: '16px',
                color: '#111827',
                '::placeholder': { color: '#9ca3af' },
              },
            },
          }}
        />
      </div>
      <button
        onClick={handleConfirm}
        disabled={paying || !stripe}
        className="w-full rounded-xl bg-indigo-600 py-4 text-base font-semibold text-white hover:bg-indigo-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
      >
        {paying ? 'Processing…' : `Confirm & Pay — SGD ${amount}`}
      </button>
    </div>
  );
}

// ── Main widget ───────────────────────────────────────────────────────────────

export default function BookingWidget({ merchant, services, staff, slug }: BookingWidgetProps) {
  const router = useRouter();

  const [selectedService, setSelectedService] = useState<Service | null>(null);
  const [selectedStaff, setSelectedStaff] = useState<StaffMember | null>(null);
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<TimeSlot | null>(null);
  const [slots, setSlots] = useState<TimeSlot[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [slotsError, setSlotsError] = useState('');
  const [leaseId, setLeaseId] = useState('');
  const [leaseExpiry, setLeaseExpiry] = useState<Date | null>(null);
  const [leaseLoading, setLeaseLoading] = useState(false);
  const [clientName, setClientName] = useState('');
  const [clientPhone, setClientPhone] = useState('');
  const [clientEmail, setClientEmail] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [piLoading, setPiLoading] = useState(false);
  const [piError, setPiError] = useState('');
  const [countdown, setCountdown] = useState(0);
  const days = next30Days();

  // Fetch availability when service + staff + date are selected
  const fetchSlots = useCallback(async () => {
    if (!selectedService || !selectedStaff || !selectedDate) return;
    setSlotsLoading(true);
    setSlotsError('');
    setSlots([]);
    try {
      const dateStr = toDateStr(selectedDate);
      const params = new URLSearchParams({
        service_id: selectedService.id,
        date: dateStr,
      });
      if (selectedStaff.id !== 'any') params.append('staff_id', selectedStaff.id);
      const res = await apiFetch(`/booking/${slug}/availability?${params.toString()}`);
      setSlots((res.slots as TimeSlot[]) || []);
    } catch (err) {
      setSlotsError(err instanceof Error ? err.message : 'Failed to load slots');
    } finally {
      setSlotsLoading(false);
    }
  }, [selectedService, selectedStaff, selectedDate, slug]);

  useEffect(() => {
    void fetchSlots();
  }, [fetchSlots]);

  // Lease countdown timer
  useEffect(() => {
    if (!leaseExpiry) return;
    const interval = setInterval(() => {
      const remaining = Math.max(0, Math.floor((leaseExpiry.getTime() - Date.now()) / 1000));
      setCountdown(remaining);
      if (remaining === 0) {
        setLeaseId('');
        setLeaseExpiry(null);
        setSelectedSlot(null);
        setClientSecret('');
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [leaseExpiry]);

  async function handleSlotSelect(slot: TimeSlot) {
    setSelectedSlot(slot);
    setLeaseLoading(true);
    setPiError('');
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
    } catch (err) {
      setPiError(err instanceof Error ? err.message : 'Could not hold slot');
      setSelectedSlot(null);
    } finally {
      setLeaseLoading(false);
    }
  }

  async function handleGetPaymentIntent() {
    if (!selectedService || !leaseId) return;
    if (!clientName.trim() || !clientPhone.trim()) {
      setPiError('Please fill in your name and phone number');
      return;
    }
    setPiLoading(true);
    setPiError('');
    try {
      const res = await apiFetch(`/booking/${slug}/create-payment-intent`, {
        method: 'POST',
        body: JSON.stringify({
          lease_id: leaseId,
          service_id: selectedService.id,
          booking_source: 'direct_widget',
        }),
      });
      setClientSecret(res.client_secret as string);
    } catch (err) {
      setPiError(err instanceof Error ? err.message : 'Payment setup failed');
    } finally {
      setPiLoading(false);
    }
  }

  function handleSuccess(bookingId: string) {
    router.push(`/${slug}/confirm?booking=${bookingId}&service=${selectedService?.name || ''}&staff=${selectedStaff?.name || ''}&time=${selectedSlot?.start_time || ''}&amount=${selectedService?.priceSgd || ''}`);
  }

  const staffWithAny: StaffMember[] = [
    { id: 'any', name: 'Any Available', photoUrl: null, title: null },
    ...staff,
  ];

  return (
    <div className="space-y-4">
      {/* Step 1: Select Service */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-50 bg-gray-50">
          <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">
            Select a Service
          </h2>
        </div>
        <div className="divide-y divide-gray-50">
          {services.map((svc) => (
            <label
              key={svc.id}
              className={`flex items-start gap-3 px-6 py-4 cursor-pointer hover:bg-indigo-50 transition-colors ${
                selectedService?.id === svc.id ? 'bg-indigo-50' : ''
              }`}
            >
              <input
                type="radio"
                name="service"
                value={svc.id}
                checked={selectedService?.id === svc.id}
                onChange={() => {
                  setSelectedService(svc);
                  setSelectedStaff(null);
                  setSelectedDate(null);
                  setSelectedSlot(null);
                  setLeaseId('');
                  setClientSecret('');
                }}
                className="mt-1 accent-indigo-600"
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-gray-900">{svc.name}</span>
                  <span className="text-sm font-semibold text-indigo-600 shrink-0">
                    SGD {parseFloat(svc.priceSgd).toFixed(2)}
                  </span>
                </div>
                <p className="text-xs text-gray-500 mt-0.5">{svc.durationMinutes} min</p>
                {svc.description && (
                  <p className="text-xs text-gray-400 mt-1 line-clamp-2">{svc.description}</p>
                )}
              </div>
            </label>
          ))}
        </div>
      </div>

      {/* Step 2: Select Staff */}
      {selectedService && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-50 bg-gray-50">
            <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">
              Select Your Stylist
            </h2>
          </div>
          <div className="divide-y divide-gray-50">
            {staffWithAny.map((s) => (
              <label
                key={s.id}
                className={`flex items-center gap-3 px-6 py-4 cursor-pointer hover:bg-indigo-50 transition-colors ${
                  selectedStaff?.id === s.id ? 'bg-indigo-50' : ''
                }`}
              >
                <input
                  type="radio"
                  name="staff"
                  value={s.id}
                  checked={selectedStaff?.id === s.id}
                  onChange={() => {
                    setSelectedStaff(s);
                    setSelectedDate(null);
                    setSelectedSlot(null);
                    setLeaseId('');
                    setClientSecret('');
                  }}
                  className="accent-indigo-600"
                />
                {s.photoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={s.photoUrl}
                    alt={s.name}
                    className="w-10 h-10 rounded-full object-cover border border-gray-100"
                  />
                ) : (
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-indigo-300 to-purple-400 flex items-center justify-center text-white text-sm font-semibold">
                    {s.name.charAt(0)}
                  </div>
                )}
                <div>
                  <div className="text-sm font-medium text-gray-900">{s.name}</div>
                  {s.title && <div className="text-xs text-gray-400">{s.title}</div>}
                </div>
              </label>
            ))}
          </div>
        </div>
      )}

      {/* Step 3: Select Date & Time */}
      {selectedService && selectedStaff && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-50 bg-gray-50">
            <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">
              Select Date &amp; Time
            </h2>
          </div>
          <div className="px-6 py-4">
            {/* Date Picker */}
            <div className="flex gap-2 overflow-x-auto pb-2 mb-4">
              {days.map((day) => {
                const isSelected = selectedDate && toDateStr(day) === toDateStr(selectedDate);
                return (
                  <button
                    key={toDateStr(day)}
                    onClick={() => {
                      setSelectedDate(day);
                      setSelectedSlot(null);
                      setLeaseId('');
                      setClientSecret('');
                    }}
                    className={`shrink-0 rounded-xl px-3 py-2 text-center border transition-colors ${
                      isSelected
                        ? 'bg-indigo-600 text-white border-indigo-600'
                        : 'border-gray-200 text-gray-700 hover:border-indigo-300'
                    }`}
                  >
                    <div className="text-xs font-medium">
                      {day.toLocaleDateString('en-SG', { weekday: 'short' })}
                    </div>
                    <div className="text-base font-bold">{day.getDate()}</div>
                    <div className="text-xs">
                      {day.toLocaleDateString('en-SG', { month: 'short' })}
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Time Slots */}
            {selectedDate && (
              <>
                {slotsLoading && (
                  <div className="text-center py-6 text-gray-400 text-sm">Loading slots…</div>
                )}
                {slotsError && (
                  <div className="text-center py-6 text-red-500 text-sm">{slotsError}</div>
                )}
                {!slotsLoading && !slotsError && slots.length === 0 && (
                  <div className="text-center py-6 text-gray-400 text-sm">
                    No availability on this date. Try another day.
                  </div>
                )}
                {!slotsLoading && slots.length > 0 && (
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
                          className={`rounded-lg py-2 px-3 text-sm font-medium border transition-colors ${
                            isSelected
                              ? 'bg-indigo-600 text-white border-indigo-600'
                              : 'border-gray-200 text-gray-700 hover:border-indigo-300 hover:bg-indigo-50'
                          } disabled:opacity-50`}
                        >
                          {formatTime(slot.start_time)}
                        </button>
                      );
                    })}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* Step 4: Client Details */}
      {selectedSlot && leaseId && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-50 bg-gray-50 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">
              Your Details
            </h2>
            {countdown > 0 && (
              <span className="text-xs text-amber-600 font-medium bg-amber-50 px-2 py-1 rounded-full">
                ⏱ {Math.floor(countdown / 60)}:{String(countdown % 60).padStart(2, '0')} held
              </span>
            )}
          </div>
          <div className="px-6 py-4 space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Full name *</label>
              <input
                type="text"
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                placeholder="Jane Tan"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Mobile number *
              </label>
              <input
                type="tel"
                value={clientPhone}
                onChange={(e) => setClientPhone(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                placeholder="+65 9123 4567"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Email (optional)
              </label>
              <input
                type="email"
                value={clientEmail}
                onChange={(e) => setClientEmail(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                placeholder="jane@example.com"
              />
            </div>
          </div>
        </div>
      )}

      {/* Cancellation Policy */}
      {selectedSlot && leaseId && (
        <div className="bg-amber-50 border border-amber-100 rounded-2xl px-6 py-4">
          <h3 className="text-sm font-semibold text-amber-800 mb-1">Cancellation Policy</h3>
          <p className="text-xs text-amber-700 leading-relaxed">
            Cancellations made more than 24 hours before your appointment are eligible for a full
            refund. Late cancellations may receive a partial refund as per the salon&apos;s policy.
          </p>
        </div>
      )}

      {/* Payment */}
      {selectedSlot && leaseId && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-50 bg-gray-50">
            <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">
              Payment
            </h2>
          </div>
          <div className="px-6 py-4">
            {/* Booking summary */}
            <div className="bg-gray-50 rounded-xl p-4 mb-4 text-sm space-y-1">
              <div className="flex justify-between">
                <span className="text-gray-600">{selectedService?.name}</span>
                <span className="font-medium text-gray-900">
                  SGD {parseFloat(selectedService?.priceSgd || '0').toFixed(2)}
                </span>
              </div>
              {selectedDate && selectedSlot && (
                <div className="flex justify-between text-gray-500">
                  <span>
                    {formatDate(selectedDate)} at {formatTime(selectedSlot.start_time)}
                  </span>
                  <span>{selectedStaff?.name}</span>
                </div>
              )}
            </div>

            {piError && (
              <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-600">
                {piError}
              </div>
            )}

            {!clientSecret && (
              <button
                onClick={handleGetPaymentIntent}
                disabled={piLoading || !clientName.trim() || !clientPhone.trim()}
                className="w-full rounded-xl bg-indigo-600 py-4 text-base font-semibold text-white hover:bg-indigo-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
              >
                {piLoading
                  ? 'Setting up payment…'
                  : `Confirm & Pay — SGD ${parseFloat(selectedService?.priceSgd || '0').toFixed(2)}`}
              </button>
            )}

            {clientSecret && (
              <Elements stripe={stripePromise} options={{ clientSecret }}>
                <PaymentForm
                  clientSecret={clientSecret}
                  amount={parseFloat(selectedService?.priceSgd || '0').toFixed(2)}
                  slug={slug}
                  leaseId={leaseId}
                  serviceId={selectedService!.id}
                  clientName={clientName}
                  clientPhone={clientPhone}
                  clientEmail={clientEmail}
                  onSuccess={handleSuccess}
                  onError={(msg) => setPiError(msg)}
                />
              </Elements>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
