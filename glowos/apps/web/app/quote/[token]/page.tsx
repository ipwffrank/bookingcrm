'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { apiFetch } from '../../lib/api';

interface QuoteData {
  quote: {
    id: string;
    serviceId: string;
    serviceName: string;
    priceSgd: string;
    notes: string | null;
    status: 'pending' | 'accepted' | 'paid' | 'expired' | 'cancelled';
    validUntil: string;
    issuedAt: string;
  };
  merchant: {
    slug: string;
    name: string;
    logoUrl: string | null;
    country: 'SG' | 'MY' | null;
  };
  client: { name: string | null };
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-SG', {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
  });
}

export default function QuotePage() {
  const params = useParams();
  const router = useRouter();
  const token = params.token as string;
  const [data, setData] = useState<QuoteData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [startTime, setStartTime] = useState('');
  const [accepting, setAccepting] = useState(false);
  const [accepted, setAccepted] = useState(false);

  useEffect(() => {
    apiFetch(`/quote/${token}`)
      .then((d) => setData(d as QuoteData))
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load quote'))
      .finally(() => setLoading(false));
  }, [token]);

  async function handleAccept(e: React.FormEvent) {
    e.preventDefault();
    if (!startTime) {
      setError('Please pick a date and time for your treatment.');
      return;
    }
    setAccepting(true);
    setError('');
    try {
      const iso = new Date(startTime).toISOString();
      await apiFetch(`/quote/${token}/accept`, {
        method: 'POST',
        body: JSON.stringify({ start_time: iso }),
      });
      setAccepted(true);
      // Redirect to the merchant's booking page so the client can manage
      // the resulting booking (cancel/reschedule) if needed.
      setTimeout(() => router.push(`/${data?.merchant.slug}`), 3500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Accept failed');
    } finally {
      setAccepting(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-tone-surface-warm flex items-center justify-center">
        <div className="text-sm text-grey-60">Loading quote…</div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-screen bg-tone-surface-warm flex items-center justify-center px-4">
        <div className="text-center max-w-sm">
          <div className="text-5xl mb-3">🔍</div>
          <h1 className="text-xl font-bold text-tone-ink mb-2">Quote not found</h1>
          <p className="text-sm text-grey-60">
            This link may have expired or been revoked. Please check with the clinic.
          </p>
        </div>
      </div>
    );
  }

  const { quote, merchant } = data;
  const isTerminal = quote.status !== 'pending';
  const expired = quote.status === 'expired';
  const cancelled = quote.status === 'cancelled';

  return (
    <div className="min-h-screen bg-tone-surface-warm">
      <div className="max-w-md mx-auto px-4 py-10">
        <div className="bg-tone-surface rounded-2xl shadow-xl shadow-gray-100 border border-grey-5 overflow-hidden">
          {/* Header */}
          <div className="bg-tone-ink px-6 py-6 text-tone-surface text-center">
            <p className="text-[11px] uppercase tracking-[0.2em] text-white/70 mb-2">Treatment quote</p>
            {merchant.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={merchant.logoUrl} alt={merchant.name} className="w-14 h-14 rounded-xl object-cover mx-auto mb-2 border border-white/10" />
            ) : null}
            <h1 className="font-serif text-xl font-semibold">{merchant.name}</h1>
          </div>

          <div className="p-6 space-y-4">
            {/* Quote details */}
            <div>
              <p className="text-[11px] uppercase tracking-wider text-grey-60 mb-1">Service</p>
              <p className="text-lg font-bold text-tone-ink">{quote.serviceName}</p>
              {quote.notes && (
                <p className="text-sm text-grey-75 mt-2 italic leading-relaxed">
                  {quote.notes}
                </p>
              )}
            </div>

            <div className="border-t border-grey-5 pt-4 flex items-end justify-between">
              <div>
                <p className="text-[11px] uppercase tracking-wider text-grey-60">Total</p>
                <p className="text-3xl font-bold text-tone-sage">
                  SGD {parseFloat(quote.priceSgd).toFixed(2)}
                </p>
              </div>
              <div className="text-right">
                <p className="text-[11px] text-grey-60 uppercase tracking-wider">Valid until</p>
                <p className="text-sm font-semibold text-tone-ink">{formatDate(quote.validUntil)}</p>
              </div>
            </div>

            {/* Status-specific callouts */}
            {expired && (
              <div className="rounded-lg bg-semantic-danger/5 border border-semantic-danger/30 px-4 py-3 text-sm text-semantic-danger">
                <p className="font-semibold mb-0.5">This quote has expired</p>
                Please contact the clinic to issue a new quote.
              </div>
            )}
            {cancelled && (
              <div className="rounded-lg bg-grey-5 border border-grey-15 px-4 py-3 text-sm text-grey-75">
                This quote has been cancelled.
              </div>
            )}
            {quote.status === 'accepted' && (
              <div className="rounded-lg bg-tone-sage/5 border border-tone-sage/30 px-4 py-3 text-sm text-tone-sage">
                <p className="font-semibold mb-0.5">✓ Already accepted</p>
                Payment is pending. Please complete payment to confirm your booking.
              </div>
            )}
            {quote.status === 'paid' && (
              <div className="rounded-lg bg-tone-sage/10 border border-tone-sage/30 px-4 py-3 text-sm text-tone-sage">
                <p className="font-semibold mb-0.5">✓ Paid</p>
                Your booking is confirmed. See you soon!
              </div>
            )}

            {/* Accept flow — only for pending quotes */}
            {!isTerminal && !accepted && (
              <form onSubmit={handleAccept} className="space-y-3 pt-2">
                <div>
                  <label className="block text-xs font-medium text-grey-75 mb-1">
                    Pick a date &amp; time for your treatment
                  </label>
                  <input
                    type="datetime-local"
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                    className="w-full rounded-lg border border-grey-15 bg-tone-surface px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-tone-sage"
                  />
                  <p className="mt-1 text-[11px] text-grey-45">
                    The clinic will confirm staff availability after you accept.
                  </p>
                </div>

                {error && (
                  <div className="rounded-lg bg-semantic-danger/5 border border-semantic-danger/30 px-3 py-2 text-xs text-semantic-danger">
                    {error}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={accepting}
                  className="w-full rounded-xl bg-tone-ink text-tone-surface py-3 text-sm font-semibold hover:opacity-90 disabled:opacity-50 transition-opacity"
                >
                  {accepting ? 'Accepting…' : `Accept quote & reserve slot`}
                </button>
                <p className="text-[11px] text-grey-60 text-center">
                  Payment will be collected after you accept — you&apos;ll be guided through it on the next screen.
                </p>
              </form>
            )}

            {accepted && (
              <div className="rounded-lg bg-tone-sage/10 border border-tone-sage/30 px-4 py-4 text-sm text-tone-sage text-center">
                <div className="w-12 h-12 bg-tone-sage/10 text-tone-sage rounded-full mx-auto flex items-center justify-center text-2xl mb-2">
                  ✓
                </div>
                <p className="font-semibold">Quote accepted — slot reserved</p>
                <p className="text-xs text-grey-75 mt-1">
                  Redirecting you back to {merchant.name}…
                </p>
              </div>
            )}
          </div>

          <div className="px-6 pb-6">
            <Link
              href={`/${merchant.slug}`}
              className="block w-full text-center rounded-xl border border-grey-15 py-2.5 text-xs font-medium text-grey-75 hover:border-tone-sage/50 transition-colors"
            >
              ← Back to {merchant.name}
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
