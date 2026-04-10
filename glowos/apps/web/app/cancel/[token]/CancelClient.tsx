'use client';

import { useState } from 'react';
import { apiFetch } from '../../lib/api';

interface CancelData {
  booking: {
    id: string;
    startTime: string;
    priceSgd: string;
    status: string;
  };
  service?: {
    name: string;
    durationMinutes: number;
  };
  eligible: boolean;
  reason?: string;
  refund_type: 'full' | 'partial' | 'none';
  refund_amount: number;
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

export default function CancelClient({ token, data }: { token: string; data: CancelData }) {
  const [loading, setLoading] = useState(false);
  const [cancelled, setCancelled] = useState(false);
  const [error, setError] = useState('');

  const { booking, service, eligible, reason, refund_type, refund_amount } = data;

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
              has been processed and will appear within 3–5 business days.
            </p>
          )}
          {refund_type === 'none' && (
            <p className="text-gray-500 text-sm">
              Your booking has been cancelled. No refund is applicable per the salon&apos;s
              cancellation policy.
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-2xl shadow-xl border border-gray-100 overflow-hidden">
          <div className="bg-gray-900 px-8 py-8 text-white">
            <h1 className="text-xl font-bold mb-1">Cancel Booking</h1>
            <p className="text-gray-400 text-sm">Review your cancellation details below</p>
          </div>

          <div className="px-8 py-6 space-y-3">
            {service && (
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Service</span>
                <span className="font-medium text-gray-900">{service.name}</span>
              </div>
            )}
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Date &amp; time</span>
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
          ) : (
            <>
              {/* Refund info */}
              <div
                className={`mx-8 mb-6 rounded-xl px-4 py-4 text-sm ${
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
                    You&apos;ll receive a full refund of{' '}
                    <span className="font-bold">SGD {refund_amount.toFixed(2)}</span>
                  </>
                )}
                {refund_type === 'partial' && (
                  <>
                    <div className="font-semibold mb-1">Partial refund available</div>
                    You&apos;ll receive a 50% refund of{' '}
                    <span className="font-bold">SGD {refund_amount.toFixed(2)}</span>
                  </>
                )}
                {refund_type === 'none' && (
                  <>
                    <div className="font-semibold mb-1">No refund per salon policy</div>
                    This cancellation is within the no-refund window.
                  </>
                )}
              </div>

              {error && (
                <div className="mx-8 mb-4 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-600">
                  {error}
                </div>
              )}

              <div className="px-8 pb-8">
                <button
                  onClick={handleCancel}
                  disabled={loading}
                  className={`w-full rounded-xl py-3 text-sm font-semibold transition-colors disabled:opacity-60 disabled:cursor-not-allowed ${
                    refund_type === 'none'
                      ? 'bg-gray-800 text-white hover:bg-gray-900'
                      : 'bg-red-600 text-white hover:bg-red-700'
                  }`}
                >
                  {loading
                    ? 'Cancelling…'
                    : refund_type === 'none'
                    ? 'Cancel Anyway (No Refund)'
                    : `Confirm Cancel — ${refund_type === 'full' ? 'Full' : 'Partial'} Refund SGD ${refund_amount.toFixed(2)}`}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
