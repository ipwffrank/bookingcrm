'use client';

import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../../lib/api';

interface CancelData {
  booking: {
    id: string;
    staffId: string;
    serviceId: string;
    startTime: string;
    priceSgd: string;
    status: string;
  };
  service?: {
    name: string;
    durationMinutes: number;
  };
  merchant_slug: string;
  eligible: boolean;
  reason?: string;
  refund_type: 'full' | 'partial' | 'none';
  refund_amount: number;
  refund_percentage: number;
}

interface TimeSlot {
  start_time: string;
  staff_id: string;
}

function formatDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString('en-SG', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
  } catch {
    return iso;
  }
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-SG', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

function toDateStr(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
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

function padTwo(n: number): string {
  return String(n).padStart(2, '0');
}

export default function CancelClient({ token, data }: { token: string; data: CancelData }) {
  const [mode, setMode] = useState<'choose' | 'cancel' | 'reschedule'>('choose');
  const [loading, setLoading] = useState(false);
  const [cancelled, setCancelled] = useState(false);
  const [rescheduled, setRescheduled] = useState(false);
  const [error, setError] = useState('');

  // Reschedule state
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [slots, setSlots] = useState<TimeSlot[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState<TimeSlot | null>(null);
  const [leaseId, setLeaseId] = useState('');
  const [leaseExpiry, setLeaseExpiry] = useState<Date | null>(null);
  const [leaseLoading, setLeaseLoading] = useState(false);
  const [countdown, setCountdown] = useState(0);

  const { booking, service, merchant_slug, eligible, reason, refund_type, refund_amount, refund_percentage } = data;
  const days = next30Days();

  // Fetch availability when date changes
  const fetchSlots = useCallback(async () => {
    if (!selectedDate || !merchant_slug) return;
    setSlotsLoading(true);
    setSlots([]);
    setSelectedSlot(null);
    try {
      const dateStr = toDateStr(selectedDate);
      const params = new URLSearchParams({
        service_id: booking.serviceId,
        staff_id: booking.staffId,
        date: dateStr,
      });
      const res = await apiFetch(`/booking/${merchant_slug}/availability?${params.toString()}`);
      setSlots((res.slots as TimeSlot[]) || []);
    } catch {
      setError('Failed to load availability');
    } finally {
      setSlotsLoading(false);
    }
  }, [selectedDate, merchant_slug, booking.serviceId, booking.staffId]);

  useEffect(() => {
    void fetchSlots();
  }, [fetchSlots]);

  // Lease countdown
  useEffect(() => {
    if (!leaseExpiry) return;
    const interval = setInterval(() => {
      const remaining = Math.max(0, Math.floor((leaseExpiry.getTime() - Date.now()) / 1000));
      setCountdown(remaining);
      if (remaining === 0) {
        setLeaseId('');
        setLeaseExpiry(null);
        setSelectedSlot(null);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [leaseExpiry]);

  async function handleSlotSelect(slot: TimeSlot) {
    setSelectedSlot(slot);
    setLeaseLoading(true);
    setError('');
    try {
      const res = await apiFetch(`/booking/${merchant_slug}/lease`, {
        method: 'POST',
        body: JSON.stringify({
          service_id: booking.serviceId,
          staff_id: slot.staff_id,
          start_time: slot.start_time,
        }),
      });
      setLeaseId(res.lease_id as string);
      setLeaseExpiry(new Date(res.expires_at as string));
      setCountdown(300);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not hold this slot');
      setSelectedSlot(null);
    } finally {
      setLeaseLoading(false);
    }
  }

  async function handleCancel() {
    setLoading(true);
    setError('');
    try {
      await apiFetch(`/booking/cancel/${token}`, { method: 'POST' });
      setCancelled(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Cancellation failed');
    } finally {
      setLoading(false);
    }
  }

  async function handleReschedule() {
    if (!leaseId) return;
    setLoading(true);
    setError('');
    try {
      await apiFetch(`/booking/reschedule/${token}`, {
        method: 'POST',
        body: JSON.stringify({ lease_id: leaseId }),
      });
      setRescheduled(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reschedule failed');
    } finally {
      setLoading(false);
    }
  }

  // ── Success: Cancelled ──────────────────────────────────────────────────────
  if (cancelled) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <div className="w-full max-w-md bg-white rounded-2xl shadow-xl border border-gray-100 p-8 text-center">
          <div className="text-5xl mb-4">✅</div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Booking Cancelled</h1>
          {refund_type !== 'none' && (
            <p className="text-gray-500 text-sm">
              Your refund of{' '}
              <span className="font-semibold text-gray-900">SGD {refund_amount.toFixed(2)}</span>{' '}
              has been processed and will appear within 3-5 business days.
            </p>
          )}
          {refund_type === 'none' && (
            <p className="text-gray-500 text-sm">
              Your booking has been cancelled. No refund is applicable per the business&apos;s
              cancellation policy.
            </p>
          )}
        </div>
      </div>
    );
  }

  // ── Success: Rescheduled ────────────────────────────────────────────────────
  if (rescheduled) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <div className="w-full max-w-md bg-white rounded-2xl shadow-xl border border-gray-100 p-8 text-center">
          <div className="text-5xl mb-4">📅</div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Booking Rescheduled</h1>
          <p className="text-gray-500 text-sm">
            Your appointment has been moved to{' '}
            <span className="font-semibold text-gray-900">
              {selectedSlot ? formatDateTime(selectedSlot.start_time) : 'the new time'}
            </span>.
            No additional payment is needed.
          </p>
          <p className="text-gray-400 text-xs mt-3">
            You&apos;ll receive an updated confirmation via WhatsApp shortly.
          </p>
        </div>
      </div>
    );
  }

  // ── Main UI ─────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-2xl shadow-xl border border-gray-100 overflow-hidden">
          <div className="bg-gray-900 px-8 py-8 text-white">
            <h1 className="text-xl font-bold mb-1">
              {mode === 'reschedule' ? 'Reschedule Booking' : 'Cancel Booking'}
            </h1>
            <p className="text-gray-400 text-sm">
              {mode === 'reschedule'
                ? 'Pick a new date and time — your payment stays intact'
                : 'Review your cancellation details below'}
            </p>
          </div>

          {/* Booking details */}
          <div className="px-8 py-6 space-y-3">
            {service && (
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Service</span>
                <span className="font-medium text-gray-900">{service.name}</span>
              </div>
            )}
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Current date &amp; time</span>
              <span className="font-medium text-gray-900 text-right max-w-[60%]">
                {formatDateTime(booking.startTime)}
              </span>
            </div>
            <div className="flex justify-between text-sm border-t border-gray-100 pt-3">
              <span className="text-gray-500">Amount paid</span>
              <span className="font-semibold text-gray-900">
                SGD {parseFloat(booking.priceSgd).toFixed(2)}
              </span>
            </div>
          </div>

          {!eligible ? (
            <div className="mx-8 mb-8 bg-gray-50 border border-gray-200 rounded-xl px-4 py-4 text-sm text-gray-600 text-center">
              {reason}
            </div>
          ) : mode === 'choose' ? (
            // ── Choose: Cancel or Reschedule ────────────────────────────
            <div className="px-8 pb-8 space-y-3">
              {/* Refund info */}
              <div
                className={`rounded-xl px-4 py-4 text-sm ${
                  refund_type === 'full'
                    ? 'bg-green-50 border border-green-100 text-green-700'
                    : refund_type === 'partial'
                    ? 'bg-amber-50 border border-amber-100 text-amber-700'
                    : 'bg-red-50 border border-red-100 text-red-700'
                }`}
              >
                {refund_type === 'full' && (
                  <>
                    <div className="font-semibold mb-1">Full refund available</div>
                    Cancel now and receive a full refund of{' '}
                    <span className="font-bold">SGD {refund_amount.toFixed(2)}</span>
                  </>
                )}
                {refund_type === 'partial' && (
                  <>
                    <div className="font-semibold mb-1">Partial refund ({refund_percentage}%)</div>
                    Cancel now and receive{' '}
                    <span className="font-bold">SGD {refund_amount.toFixed(2)}</span> back.
                    Alternatively, reschedule to keep your full payment.
                  </>
                )}
                {refund_type === 'none' && (
                  <>
                    <div className="font-semibold mb-1">No refund per cancellation policy</div>
                    You can reschedule to a different time instead and keep your full payment.
                  </>
                )}
              </div>

              <button
                onClick={() => setMode('reschedule')}
                className="w-full rounded-xl bg-indigo-600 py-3 text-sm font-semibold text-white hover:bg-indigo-700 transition-colors"
              >
                Reschedule Instead (Keep Payment)
              </button>

              <button
                onClick={() => setMode('cancel')}
                className="w-full rounded-xl border-2 border-gray-200 py-3 text-sm font-semibold text-gray-700 hover:border-gray-300 hover:bg-gray-50 transition-colors"
              >
                {refund_type === 'none'
                  ? 'Cancel Anyway (No Refund)'
                  : `Cancel & Get ${refund_type === 'full' ? 'Full' : `${refund_percentage}%`} Refund`}
              </button>
            </div>
          ) : mode === 'cancel' ? (
            // ── Cancel confirmation ─────────────────────────────────────
            <div className="px-8 pb-8 space-y-3">
              <div
                className={`rounded-xl px-4 py-4 text-sm ${
                  refund_type === 'full'
                    ? 'bg-green-50 border border-green-100 text-green-700'
                    : refund_type === 'partial'
                    ? 'bg-amber-50 border border-amber-100 text-amber-700'
                    : 'bg-red-50 border border-red-100 text-red-700'
                }`}
              >
                {refund_type === 'full' && (
                  <>
                    <div className="font-semibold mb-1">Full refund</div>
                    You&apos;ll receive{' '}
                    <span className="font-bold">SGD {refund_amount.toFixed(2)}</span> back
                    within 3-5 business days.
                  </>
                )}
                {refund_type === 'partial' && (
                  <>
                    <div className="font-semibold mb-1">{refund_percentage}% refund</div>
                    You&apos;ll receive{' '}
                    <span className="font-bold">SGD {refund_amount.toFixed(2)}</span> back.
                  </>
                )}
                {refund_type === 'none' && (
                  <>
                    <div className="font-semibold mb-1">No refund</div>
                    This cancellation is within the no-refund window.
                  </>
                )}
              </div>

              {error && (
                <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-600">
                  {error}
                </div>
              )}

              <button
                onClick={handleCancel}
                disabled={loading}
                className="w-full rounded-xl bg-red-600 py-3 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
              >
                {loading ? 'Cancelling...' : 'Confirm Cancellation'}
              </button>
              <button
                onClick={() => { setMode('choose'); setError(''); }}
                className="w-full rounded-xl border-2 border-gray-200 py-3 text-sm font-semibold text-gray-600 hover:bg-gray-50 transition-colors"
              >
                Go Back
              </button>
            </div>
          ) : (
            // ── Reschedule: date & time picker ──────────────────────────
            <div className="px-8 pb-8 space-y-4">
              {/* Date row */}
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                  Select a new date
                </p>
                <div className="flex gap-2 overflow-x-auto pb-2 -mx-1 px-1 scrollbar-hide">
                  {days.map((day) => {
                    const dayStr = toDateStr(day);
                    const isSelected = selectedDate ? toDateStr(selectedDate) === dayStr : false;
                    const isToday = toDateStr(new Date()) === dayStr;
                    return (
                      <button
                        key={dayStr}
                        onClick={() => {
                          setSelectedDate(day);
                          setLeaseId('');
                          setLeaseExpiry(null);
                          setError('');
                        }}
                        className={`shrink-0 rounded-xl px-3 py-2.5 text-center border-2 transition-all ${
                          isSelected
                            ? 'bg-indigo-600 text-white border-indigo-600 shadow-md shadow-indigo-200'
                            : 'border-gray-200 text-gray-700 hover:border-indigo-300 hover:bg-indigo-50'
                        }`}
                      >
                        <div className="text-xs font-medium">
                          {isToday ? 'Today' : day.toLocaleDateString('en-SG', { weekday: 'short' })}
                        </div>
                        <div className="text-base font-bold mt-0.5">{day.getDate()}</div>
                        <div className="text-xs opacity-75">
                          {day.toLocaleDateString('en-SG', { month: 'short' })}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Time slots */}
              {selectedDate && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                    Select a time
                  </p>

                  {slotsLoading && (
                    <div className="flex items-center justify-center py-6 gap-2 text-gray-400">
                      <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                      </svg>
                      <span className="text-sm">Loading...</span>
                    </div>
                  )}

                  {!slotsLoading && slots.length === 0 && (
                    <div className="rounded-xl bg-gray-50 border border-gray-100 px-4 py-6 text-sm text-gray-500 text-center">
                      No availability on this date. Try another day.
                    </div>
                  )}

                  {!slotsLoading && slots.length > 0 && (
                    <div className="grid grid-cols-3 gap-2">
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
                  )}
                </div>
              )}

              {/* Lease timer + confirm */}
              {leaseId && countdown > 0 && (
                <div className="space-y-3">
                  <div className="bg-indigo-50 border border-indigo-100 rounded-xl px-4 py-3 text-sm text-indigo-700 flex items-center justify-between">
                    <span>Slot held for you</span>
                    <span className={`font-mono font-bold ${countdown < 60 ? 'text-red-600' : ''}`}>
                      {padTwo(Math.floor(countdown / 60))}:{padTwo(countdown % 60)}
                    </span>
                  </div>

                  {error && (
                    <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-600">
                      {error}
                    </div>
                  )}

                  <button
                    onClick={handleReschedule}
                    disabled={loading}
                    className="w-full rounded-xl bg-indigo-600 py-3 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
                  >
                    {loading ? 'Rescheduling...' : 'Confirm Reschedule'}
                  </button>
                </div>
              )}

              {error && !leaseId && (
                <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-600">
                  {error}
                </div>
              )}

              <button
                onClick={() => { setMode('choose'); setSelectedDate(null); setSelectedSlot(null); setLeaseId(''); setError(''); }}
                className="w-full rounded-xl border-2 border-gray-200 py-3 text-sm font-semibold text-gray-600 hover:bg-gray-50 transition-colors"
              >
                Go Back
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
