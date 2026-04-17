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
      };
      if (!service && data.service) setService(data.service);
      if (!staff && data.staff) setStaff(data.staff);
      if (!time && data.time) setTime(data.time);
      if (!amount && data.amount) setAmount(data.amount);
      if (!isPaid && data.paid) setIsPaid(true);
      // Clean up after reading
      sessionStorage.removeItem(`glowos_booking_${slug}`);
    } catch { /* ignore */ }
  }, [slug, service, time, amount, staff, isPaid]);

  const displayRef = bookingId ?? paymentRef;

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 via-white to-indigo-50 flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-2xl shadow-xl shadow-gray-100 border border-gray-100 overflow-hidden">
          {/* Header */}
          <div className="bg-gradient-to-r from-green-400 to-emerald-500 px-8 py-10 text-white text-center">
            <div className="w-16 h-16 rounded-full bg-white/20 flex items-center justify-center mx-auto mb-4 text-3xl">
              ✅
            </div>
            <h1 className="text-2xl font-bold mb-1">Booking Confirmed!</h1>
            <p className="text-green-100 text-sm">
              We&apos;re looking forward to seeing you
            </p>
          </div>

          {/* Details */}
          <div className="px-8 py-6 space-y-3">
            {displayRef && (
              <div className="flex justify-between items-center text-sm pb-3 border-b border-gray-100">
                <span className="text-gray-500">{isPaid ? 'Payment ref' : 'Booking ref'}</span>
                <span className="font-mono text-xs bg-gray-100 text-gray-700 px-2 py-1 rounded">
                  {displayRef.slice(-8).toUpperCase()}
                </span>
              </div>
            )}
            {service && (
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Service</span>
                <span className="font-semibold text-gray-900">{service}</span>
              </div>
            )}
            {staff && (
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Staff</span>
                <span className="font-medium text-gray-900">{staff}</span>
              </div>
            )}
            {time && (
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Date &amp; time</span>
                <span className="font-medium text-gray-900 text-right">{formatTime(time)}</span>
              </div>
            )}
            {amount && (
              <div className="flex justify-between text-sm border-t border-gray-100 pt-3 mt-3">
                <span className="text-gray-500">{isPaid ? 'Amount paid' : 'Amount due'}</span>
                <span className="font-bold text-gray-900 text-base">
                  SGD {parseFloat(amount).toFixed(2)}
                </span>
              </div>
            )}
          </div>

          {/* Payment notice */}
          {isPaid && amount ? (
            <div className="mx-8 mb-4 bg-green-50 border border-green-100 rounded-xl px-4 py-3 text-sm text-green-700">
              <div className="font-semibold mb-0.5">✅ Payment received</div>
              SGD {parseFloat(amount).toFixed(2)} has been charged. No further payment is needed.
            </div>
          ) : amount ? (
            <div className="mx-8 mb-4 bg-indigo-50 border border-indigo-100 rounded-xl px-4 py-3 text-sm text-indigo-700">
              <div className="font-semibold mb-0.5">💳 Pay at your appointment</div>
              Please bring SGD {parseFloat(amount).toFixed(2)} on the day of your appointment.
            </div>
          ) : null}

          {/* WhatsApp notice */}
          <div className="mx-8 mb-5 bg-green-50 border border-green-100 rounded-xl px-4 py-3 text-sm text-green-700">
            <div className="font-semibold mb-0.5">💬 Confirmation on the way</div>
            You&apos;ll receive a WhatsApp confirmation shortly with your booking details
            and a cancellation link.
          </div>

          {/* Back link */}
          <div className="px-8 pb-8">
            <Link
              href={`/${slug}`}
              className="block w-full rounded-xl border-2 border-gray-200 py-3 text-center text-sm font-semibold text-gray-700 hover:border-indigo-300 hover:text-indigo-600 transition-colors"
            >
              ← Back to {slug.replace(/-/g, ' ')}
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
