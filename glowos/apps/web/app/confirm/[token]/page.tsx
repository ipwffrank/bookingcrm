'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { apiFetch } from '../../lib/api';

interface ConfirmData {
  booking: {
    id: string;
    status: 'pending' | 'confirmed' | 'in_progress' | 'completed' | 'cancelled' | 'no_show';
    startTime: string;
    endTime: string;
    priceSgd: string;
    confirmedAt: string | null;
  };
  merchant: { name: string; slug: string; logoUrl: string | null };
  service: { name: string; durationMinutes: number };
  staff: { name: string };
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-SG', {
    weekday: 'long',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function ConfirmPage() {
  const params = useParams();
  const token = params.token as string;
  const [data, setData] = useState<ConfirmData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    apiFetch(`/booking/confirm/${token}`)
      .then((d) => setData(d as ConfirmData))
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load booking'))
      .finally(() => setLoading(false));
  }, [token]);

  async function handleConfirm() {
    setConfirming(true);
    setError('');
    try {
      const res = (await apiFetch(`/booking/confirm/${token}`, { method: 'POST' })) as {
        booking: { id: string; status: string; confirmedAt: string };
      };
      setData((prev) =>
        prev
          ? {
              ...prev,
              booking: {
                ...prev.booking,
                status: res.booking.status as ConfirmData['booking']['status'],
                confirmedAt: res.booking.confirmedAt,
              },
            }
          : prev,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Confirmation failed');
    } finally {
      setConfirming(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-tone-surface-warm flex items-center justify-center">
        <div className="text-sm text-grey-60">Loading booking…</div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-screen bg-tone-surface-warm flex items-center justify-center px-4">
        <div className="text-center max-w-sm">
          <div className="text-5xl mb-3">🔍</div>
          <h1 className="text-xl font-bold text-tone-ink mb-2">Confirmation link invalid</h1>
          <p className="text-sm text-grey-60">
            {error || 'This link may have expired. Please contact the clinic directly.'}
          </p>
        </div>
      </div>
    );
  }

  const { booking, merchant, service, staff } = data;
  const isConfirmed = booking.status === 'confirmed' || !!booking.confirmedAt;
  const isTerminal = booking.status === 'cancelled' || booking.status === 'no_show';
  const isPast = new Date(booking.startTime).getTime() < Date.now();

  return (
    <div className="min-h-screen bg-tone-surface-warm">
      <div className="max-w-md mx-auto px-4 py-10">
        <div className="bg-tone-surface rounded-2xl shadow-xl shadow-gray-100 border border-grey-5 overflow-hidden">
          <div className="bg-tone-ink px-6 py-6 text-tone-surface text-center">
            <p className="text-[11px] uppercase tracking-[0.2em] text-white/70 mb-2">
              Confirm your appointment
            </p>
            {merchant.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={merchant.logoUrl}
                alt={merchant.name}
                className="w-14 h-14 rounded-xl object-cover mx-auto mb-2 border border-white/10"
              />
            ) : null}
            <h1 className="font-serif text-xl font-semibold">{merchant.name}</h1>
          </div>

          <div className="p-6 space-y-4">
            <div>
              <p className="text-[11px] uppercase tracking-wider text-grey-60 mb-1">Treatment</p>
              <p className="text-lg font-bold text-tone-ink">{service.name}</p>
              <p className="text-xs text-grey-60 mt-0.5">
                {service.durationMinutes} min &middot; with {staff.name}
              </p>
            </div>

            <div className="border-t border-grey-5 pt-4">
              <p className="text-[11px] uppercase tracking-wider text-grey-60 mb-1">When</p>
              <p className="text-sm font-semibold text-tone-ink">{formatDateTime(booking.startTime)}</p>
            </div>

            {isTerminal && (
              <div className="rounded-lg bg-grey-5 border border-grey-15 px-4 py-3 text-sm text-grey-75">
                This booking is {booking.status}. If this is unexpected, please contact the clinic.
              </div>
            )}

            {!isTerminal && isPast && !isConfirmed && (
              <div className="rounded-lg bg-semantic-warn/5 border border-semantic-warn/30 px-4 py-3 text-sm text-grey-75">
                This appointment time has passed. Please contact the clinic.
              </div>
            )}

            {isConfirmed && (
              <div className="rounded-lg bg-tone-sage/10 border border-tone-sage/30 px-4 py-4 text-sm text-tone-sage text-center">
                <div className="w-12 h-12 bg-tone-sage/10 text-tone-sage rounded-full mx-auto flex items-center justify-center text-2xl mb-2">
                  ✓
                </div>
                <p className="font-semibold">Appointment confirmed</p>
                <p className="text-xs text-grey-75 mt-1">
                  See you at {merchant.name}. The clinic has been notified.
                </p>
              </div>
            )}

            {!isConfirmed && !isTerminal && !isPast && (
              <>
                {error && (
                  <div className="rounded-lg bg-semantic-danger/5 border border-semantic-danger/30 px-3 py-2 text-xs text-semantic-danger">
                    {error}
                  </div>
                )}
                <button
                  type="button"
                  onClick={handleConfirm}
                  disabled={confirming}
                  className="w-full rounded-xl bg-tone-ink text-tone-surface py-3 text-sm font-semibold hover:opacity-90 disabled:opacity-50 transition-opacity"
                >
                  {confirming ? 'Confirming…' : 'Yes, I will be there'}
                </button>
                <p className="text-[11px] text-grey-60 text-center">
                  Need to reschedule or cancel? Use the link in your booking confirmation message.
                </p>
              </>
            )}
          </div>

          <div className="px-6 pb-6">
            <Link
              href={`/${merchant.slug}`}
              className="block w-full text-center rounded-xl border border-grey-15 py-2.5 text-xs font-medium text-grey-75 hover:border-tone-sage/50 transition-colors"
            >
              ← {merchant.name}
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
