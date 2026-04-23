'use client';

import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import Link from 'next/link';

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString('en-SG', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
  } catch {
    return iso;
  }
}

export default function ConfirmPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const slug = params.slug as string;

  // Read from URL params
  const bookingId = searchParams.get('booking_id') ?? searchParams.get('booking');
  const paymentRef = searchParams.get('ref') ?? searchParams.get('payment_intent');
  const paidParam = searchParams.get('paid') === 'true' || searchParams.get('redirect_status') === 'succeeded';

  const [service, setService] = useState(searchParams.get('service') ?? '');
  const [staff, setStaff] = useState(searchParams.get('staff') ?? '');
  const [time, setTime] = useState(searchParams.get('time') ?? '');
  const [amount, setAmount] = useState(searchParams.get('amount') ?? '');
  const [isPaid, setIsPaid] = useState(paidParam);
  const [method, setMethod] = useState(searchParams.get('method') ?? '');

  // Fallback: read from sessionStorage if URL params are missing
  // (PayNow/GrabPay redirects can sometimes lose custom params)
  useEffect(() => {
    if (service && time && amount) return; // URL params are fine
    try {
      const stored = sessionStorage.getItem(`glowos_booking_${slug}`);
      if (!stored) return;
      const data = JSON.parse(stored) as {
        service?: string;
        staff?: string;
        time?: string;
        amount?: string;
        paid?: boolean;
        method?: string;
      };
      if (!service && data.service) setService(data.service);
      if (!staff && data.staff) setStaff(data.staff);
      if (!time && data.time) setTime(data.time);
      if (!amount && data.amount) setAmount(data.amount);
      if (!isPaid && data.paid) setIsPaid(true);
      if (!method && data.method) setMethod(data.method);
      // Clean up after reading
      sessionStorage.removeItem(`glowos_booking_${slug}`);
    } catch { /* ignore */ }
  }, [slug, service, time, amount, staff, isPaid, method]);

  const displayRef = bookingId ?? paymentRef;

  return (
    <div className="min-h-screen bg-tone-surface-warm flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <div className="bg-tone-surface rounded-2xl shadow-xl shadow-gray-100 border border-grey-5 overflow-hidden">
          {/* Header */}
          <div className="bg-tone-sage px-8 py-10 text-white text-center">
            <div className="w-16 h-16 rounded-full bg-tone-surface/20 flex items-center justify-center mx-auto mb-4 text-3xl">
              ✅
            </div>
            <h1 className="text-2xl font-bold mb-1">Booking Confirmed!</h1>
            <p className="text-white/80 text-sm">
              We&apos;re looking forward to seeing you
            </p>
          </div>

          {/* Details */}
          <div className="px-8 py-6 space-y-3">
            {displayRef && (
              <div className="flex justify-between items-center text-sm pb-3 border-b border-grey-5">
                <span className="text-grey-60">{isPaid ? 'Payment ref' : 'Booking ref'}</span>
                <span className="font-mono text-xs bg-grey-15 text-grey-75 px-2 py-1 rounded">
                  {displayRef.slice(-8).toUpperCase()}
                </span>
              </div>
            )}
            {service && (
              <div className="flex justify-between text-sm">
                <span className="text-grey-60">Service</span>
                <span className="font-semibold text-tone-ink">{service}</span>
              </div>
            )}
            {staff && (
              <div className="flex justify-between text-sm">
                <span className="text-grey-60">Staff</span>
                <span className="font-medium text-tone-ink">{staff}</span>
              </div>
            )}
            {time && (
              <div className="flex justify-between text-sm">
                <span className="text-grey-60">Date &amp; time</span>
                <span className="font-medium text-tone-ink text-right">{formatTime(time)}</span>
              </div>
            )}
            {amount && (
              <div className="flex justify-between text-sm border-t border-grey-5 pt-3 mt-3">
                <span className="text-grey-60">{isPaid ? 'Amount paid' : 'Amount due'}</span>
                <span className="font-bold text-tone-ink text-base">
                  SGD {parseFloat(amount).toFixed(2)}
                </span>
              </div>
            )}
          </div>

          {/* Payment notice — adapts to the customer's chosen method */}
          {(() => {
            if (method === 'package') {
              return (
                <div className="mx-8 mb-4 bg-tone-sage/5 border border-tone-sage/20 rounded-xl px-4 py-3 text-sm text-tone-sage">
                  <div className="font-semibold mb-0.5">✅ Package session applied</div>
                  This booking uses a session from your package. No payment is needed today.
                </div>
              );
            }
            if (isPaid && amount) {
              const label =
                method === 'card' ? 'Card / PayNow payment received' :
                method === 'ipay88' ? 'Payment received via iPay88' :
                'Payment received';
              return (
                <div className="mx-8 mb-4 bg-tone-sage/5 border border-tone-sage/20 rounded-xl px-4 py-3 text-sm text-tone-sage">
                  <div className="font-semibold mb-0.5">✅ {label}</div>
                  SGD {parseFloat(amount).toFixed(2)} has been charged. No further payment is needed.
                </div>
              );
            }
            if (amount) {
              return (
                <div className="mx-8 mb-4 bg-tone-sage/10 border border-tone-sage/30 rounded-xl px-4 py-3 text-sm text-tone-sage">
                  <div className="font-semibold mb-0.5">🏪 Pay at the venue</div>
                  Your slot is reserved. Please bring SGD {parseFloat(amount).toFixed(2)} on the day of your appointment — cash, card or PayNow accepted at the counter.
                </div>
              );
            }
            return null;
          })()}

          {/* WhatsApp notice */}
          <div className="mx-8 mb-5 bg-tone-sage/5 border border-tone-sage/20 rounded-xl px-4 py-3 text-sm text-tone-sage">
            <div className="font-semibold mb-0.5">💬 Confirmation on the way</div>
            You&apos;ll receive a WhatsApp confirmation shortly with your booking details
            and a cancellation link.
          </div>

          {/* Back link */}
          <div className="px-8 pb-8">
            <Link
              href={`/${slug}`}
              className="block w-full rounded-xl border-2 border-grey-15 py-3 text-center text-sm font-semibold text-grey-75 hover:border-tone-sage/50 hover:text-tone-sage transition-colors"
            >
              ← Back to {slug.replace(/-/g, ' ')}
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
