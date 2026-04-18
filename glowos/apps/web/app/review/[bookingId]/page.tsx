'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';

interface BookingDetails {
  merchantName: string;
  merchantLogo: string | null;
  serviceName: string;
  staffName: string;
  appointmentDate: string;
  alreadyReviewed: boolean;
}

function getApiUrl(): string {
  return process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
}

function StarRating({ rating, onRate }: { rating: number; onRate: (r: number) => void }) {
  const [hover, setHover] = useState(0);

  return (
    <div className="flex justify-center gap-1">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          onClick={() => onRate(star)}
          onMouseEnter={() => setHover(star)}
          onMouseLeave={() => setHover(0)}
          className="text-4xl transition-transform hover:scale-110 focus:outline-none"
          aria-label={`Rate ${star} star${star > 1 ? 's' : ''}`}
        >
          <span className={(hover || rating) >= star ? 'text-[#c4a778]' : 'text-gray-200'}>
            ★
          </span>
        </button>
      ))}
    </div>
  );
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-SG', { day: 'numeric', month: 'short' });
}

export default function ReviewPage() {
  const params = useParams();
  const bookingId = params.bookingId as string;

  const [details, setDetails] = useState<BookingDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    fetch(`${getApiUrl()}/review/${bookingId}`)
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error((body as { message?: string }).message || 'Not found');
        }
        return res.json();
      })
      .then((data: BookingDetails) => {
        setDetails(data);
        if (data.alreadyReviewed) setSubmitted(true);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }, [bookingId]);

  async function handleSubmit() {
    if (rating === 0) return;
    setSubmitting(true);

    try {
      const res = await fetch(`${getApiUrl()}/review/${bookingId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rating, comment: comment.trim() || undefined }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { message?: string }).message || 'Failed to submit');
      }

      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[#fafaf8] flex items-center justify-center">
        <div className="animate-pulse text-gray-400">Loading…</div>
      </div>
    );
  }

  if (error && !details) {
    return (
      <div className="min-h-screen bg-[#fafaf8] flex items-center justify-center px-6">
        <div className="text-center">
          <p className="text-gray-500 text-sm">{error}</p>
        </div>
      </div>
    );
  }

  if (!details) return null;

  // Thank-you screen
  if (submitted) {
    return (
      <div className="min-h-screen bg-[#fafaf8] flex items-center justify-center px-6">
        <div className="text-center max-w-sm">
          <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-emerald-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
            </svg>
          </div>
          <h1 className="text-xl font-semibold text-gray-900 mb-2">Thank you!</h1>
          <p className="text-sm text-gray-500">Your feedback has been shared with {details.merchantName}.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#fafaf8] flex items-center justify-center px-6 py-12">
      <div className="w-full max-w-sm">
        {/* Merchant header */}
        <div className="text-center mb-8">
          {details.merchantLogo ? (
            <img src={details.merchantLogo} alt={details.merchantName} className="w-14 h-14 rounded-full mx-auto mb-3 object-cover" />
          ) : (
            <div className="w-14 h-14 rounded-full bg-gradient-to-br from-[#c4a778] to-[#d4b88a] flex items-center justify-center mx-auto mb-3">
              <span className="text-white font-bold text-lg">{getInitials(details.merchantName)}</span>
            </div>
          )}
          <h1 className="font-serif text-xl font-semibold text-[#1a1a2e]">{details.merchantName}</h1>
          <p className="text-sm text-gray-500 mt-1">
            How was your {details.serviceName} on {formatDate(details.appointmentDate)}?
          </p>
        </div>

        {/* Staff card */}
        <div className="bg-white border border-gray-200 rounded-xl p-3 flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-full bg-indigo-100 flex items-center justify-center font-semibold text-indigo-600 text-sm flex-shrink-0">
            {getInitials(details.staffName)}
          </div>
          <div>
            <div className="font-semibold text-sm text-[#1a1a2e]">{details.staffName}</div>
            <div className="text-xs text-gray-400">Your specialist</div>
          </div>
        </div>

        {/* Star rating */}
        <div className="mb-6 text-center">
          <StarRating rating={rating} onRate={setRating} />
          <p className="text-xs text-gray-400 mt-2">Tap to rate</p>
        </div>

        {/* Comment */}
        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Tell us about your experience (optional)"
          maxLength={1000}
          rows={3}
          className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-[#c4a778]/50 resize-none mb-4"
        />

        {/* Error */}
        {error && <p className="text-xs text-red-500 mb-3">{error}</p>}

        {/* Submit */}
        <button
          onClick={handleSubmit}
          disabled={rating === 0 || submitting}
          className="w-full py-3.5 bg-[#1a1a2e] text-white rounded-xl font-semibold text-sm hover:bg-[#2a2a3e] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {submitting ? 'Submitting…' : 'Submit Review'}
        </button>

        <p className="text-[11px] text-gray-400 text-center mt-3">
          Your review is shared with the business only, not displayed publicly.
        </p>
      </div>
    </div>
  );
}
