'use client';

import { useState } from 'react';
import { apiFetch } from '../../lib/api';

export interface CancelBookingResult {
  refundType: 'full' | 'partial' | 'none';
  refundPercentage: number;
}

interface Props {
  bookingId: string;
  // Short context line shown in the header so the user knows which booking
  // they're cancelling. e.g. "Picosure Pigmentation Laser · 09:15 with Dr. Mei".
  bookingLabel: string;
  onClose: () => void;
  onCancelled: (result: CancelBookingResult) => void;
}

export function CancelBookingDialog({ bookingId, bookingLabel, onClose, onCancelled }: Props) {
  const [reason, setReason] = useState('');
  const [waivePolicy, setWaivePolicy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConfirm() {
    setSaving(true);
    setError(null);
    try {
      const res = await apiFetch(`/merchant/bookings/${bookingId}/cancel`, {
        method: 'PUT',
        body: JSON.stringify({
          ...(reason.trim() ? { reason: reason.trim() } : {}),
          waive_policy: waivePolicy,
        }),
      });
      onCancelled({
        refundType: res?.refund?.type ?? 'none',
        refundPercentage: res?.refund?.percentage ?? 0,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to cancel');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <div className="fixed inset-0 bg-black/40" onClick={saving ? undefined : onClose} />
      <div className="relative bg-tone-surface rounded-2xl shadow-2xl w-full max-w-md p-6 z-10">
        <div className="flex items-start justify-between mb-3">
          <div>
            <h2 className="text-base font-semibold text-tone-ink">Cancel appointment?</h2>
            <p className="text-xs text-grey-60 mt-0.5">{bookingLabel}</p>
          </div>
          <button
            onClick={onClose}
            disabled={saving}
            className="p-1 rounded-lg text-grey-45 hover:text-grey-75 hover:bg-grey-15 disabled:opacity-50 transition-colors"
            aria-label="Close"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <p className="text-xs text-grey-75 mb-4 leading-relaxed">
          The customer will be notified. Refund follows your cancellation policy unless waived below.
        </p>

        <div className="space-y-3">
          <div>
            <label className="block text-[10px] font-medium text-grey-60 uppercase tracking-wide mb-1">
              Reason (optional)
            </label>
            <input
              type="text"
              value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder="e.g. Customer requested via phone"
              maxLength={500}
              disabled={saving}
              className="w-full px-3 py-2 text-sm rounded-lg border border-grey-30 bg-tone-surface focus:outline-none focus:ring-2 focus:ring-tone-sage disabled:opacity-60"
            />
          </div>

          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={waivePolicy}
              onChange={e => setWaivePolicy(e.target.checked)}
              disabled={saving}
              className="mt-0.5 rounded border-grey-30 disabled:opacity-60"
            />
            <span className="text-xs text-grey-75 leading-snug">
              Waive cancellation policy — issue full refund
            </span>
          </label>

          {error && (
            <p className="text-xs text-semantic-danger">{error}</p>
          )}
        </div>

        <div className="flex gap-2 mt-5">
          <button
            onClick={handleConfirm}
            disabled={saving}
            className="flex-1 py-2 px-3 bg-semantic-danger text-white text-sm font-semibold rounded-lg hover:opacity-90 disabled:opacity-60 transition-opacity"
          >
            {saving ? 'Cancelling…' : 'Confirm Cancellation'}
          </button>
          <button
            onClick={onClose}
            disabled={saving}
            className="py-2 px-4 bg-grey-15 text-grey-75 text-sm font-medium rounded-lg hover:bg-grey-30 disabled:opacity-60 transition-colors"
          >
            Keep
          </button>
        </div>
      </div>
    </div>
  );
}

export function describeRefund(result: CancelBookingResult): string {
  if (result.refundType === 'full') return 'Full refund issued.';
  if (result.refundType === 'partial') return `${result.refundPercentage}% refund issued.`;
  return 'No refund per policy.';
}
