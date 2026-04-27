'use client';

import { useEffect, useState } from 'react';
import { apiFetch, ApiError } from '../../lib/api';

// ─── Types ─────────────────────────────────────────────────────────────────────

interface BookingCtx {
  booking: {
    id: string;
    status: 'pending' | 'confirmed' | 'in_progress' | 'completed' | 'cancelled' | 'no_show';
    priceSgd: string;
    discountSgd: string;
    loyaltyPointsRedeemed: number;
    paymentMethod: string | null;
  };
  client: { id: string; name: string | null; phone: string; profileId: string | null };
  service?: { id: string; name: string };
  staff?: { id: string; name: string };
}

interface LoyaltyState {
  balance: number;
  program: {
    enabled: boolean;
    pointsPerDollar: number;
    pointsPerDollarRedeem: number;
    minRedeemPoints: number;
  } | null;
}

type PaymentMethod = 'cash' | 'card' | 'paynow' | 'other';

interface Props {
  bookingId: string;
  onClose: () => void;
  onComplete: () => void;
}

// ─── Component ─────────────────────────────────────────────────────────────────

export function CheckoutModal({ bookingId, onClose, onComplete }: Props) {
  const [ctx, setCtx] = useState<BookingCtx | null>(null);
  const [loyalty, setLoyalty] = useState<LoyaltyState | null>(null);
  const [pointsToRedeem, setPointsToRedeem] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── Load booking + loyalty data ──────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const editCtx = (await apiFetch(`/merchant/bookings/${bookingId}/edit-context`)) as {
          booking: BookingCtx['booking'] & { serviceId: string; staffId: string };
          client: BookingCtx['client'];
          services: Array<{ id: string; name: string }>;
          staff: Array<{ id: string; name: string }>;
        };
        if (cancelled) return;
        setCtx({
          booking: editCtx.booking,
          client: editCtx.client,
          service: editCtx.services.find((s) => s.id === editCtx.booking.serviceId),
          staff: editCtx.staff.find((s) => s.id === editCtx.booking.staffId),
        });
        setPaymentMethod((editCtx.booking.paymentMethod ?? 'cash') as PaymentMethod);

        if (editCtx.client.profileId) {
          const lr = (await apiFetch(`/merchant/clients/${editCtx.client.profileId}/loyalty`)) as {
            balance: number;
            program: LoyaltyState['program'];
          };
          if (cancelled) return;
          setLoyalty({ balance: lr.balance, program: lr.program ?? null });
        } else {
          setLoyalty({ balance: 0, program: null });
        }
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.message : 'Failed to load checkout');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [bookingId]);

  // ── Derived values ───────────────────────────────────────────────────────
  const gross = ctx ? parseFloat(ctx.booking.priceSgd) : 0;
  const existingDiscount = ctx ? parseFloat(ctx.booking.discountSgd ?? '0') : 0;
  const existingRedemption = ctx?.booking.loyaltyPointsRedeemed ?? 0;
  const program = loyalty?.program ?? null;
  const balance = loyalty?.balance ?? 0;

  const points = parseInt(pointsToRedeem || '0', 10);
  const validPoints = Number.isFinite(points) && points > 0 ? points : 0;

  // What's the max redeemable: capped by balance, by booking total in SGD,
  // and ensures we never redeem more SGD than the booking is worth.
  const remainingPriceForRedemption = Math.max(0, gross - existingDiscount);
  const maxRedeemable = program
    ? Math.min(balance, Math.floor(remainingPriceForRedemption * program.pointsPerDollarRedeem))
    : 0;

  const newRedemptionSgd =
    program && validPoints >= program.minRedeemPoints && validPoints <= maxRedeemable
      ? validPoints / program.pointsPerDollarRedeem
      : 0;

  const finalDiscount = existingDiscount + newRedemptionSgd;
  const netDue = Math.max(0, gross - finalDiscount);

  const canOfferRedemption =
    !!program?.enabled &&
    existingRedemption === 0 &&
    balance >= (program?.minRedeemPoints ?? 0) &&
    maxRedeemable >= (program?.minRedeemPoints ?? 0);

  // ── Submit ───────────────────────────────────────────────────────────────
  async function handleSubmit() {
    if (!ctx) return;
    setSubmitting(true);
    setError(null);
    try {
      // Step 1: ensure booking is in_progress (check in if pending/confirmed)
      if (ctx.booking.status === 'pending' || ctx.booking.status === 'confirmed') {
        await apiFetch(`/merchant/bookings/${bookingId}/check-in`, { method: 'PUT' });
      }

      // Step 2: apply loyalty redemption if requested
      if (canOfferRedemption && validPoints >= (program?.minRedeemPoints ?? 0)) {
        await apiFetch(`/merchant/bookings/${bookingId}/apply-loyalty-redemption`, {
          method: 'POST',
          body: JSON.stringify({ points: validPoints }),
        });
      }

      // Step 3: update payment method if changed
      if (paymentMethod !== (ctx.booking.paymentMethod ?? 'cash')) {
        await apiFetch(`/merchant/bookings/${bookingId}`, {
          method: 'PATCH',
          body: JSON.stringify({ payment_method: paymentMethod }),
        });
      }

      // Step 4: mark complete
      await apiFetch(`/merchant/bookings/${bookingId}/complete`, { method: 'PUT' });

      onComplete();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Checkout failed');
      setSubmitting(false);
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4 print:hidden">
      <div className="bg-tone-surface w-full max-w-md rounded-xl shadow-2xl max-h-[92vh] flex flex-col">
        {/* Header */}
        <div className="px-5 py-4 border-b border-grey-15 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-tone-ink">Checkout</h2>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="text-grey-60 hover:text-tone-ink disabled:opacity-50"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {loading && <p className="text-sm text-grey-60">Loading…</p>}

          {error && (
            <div className="rounded-lg border border-semantic-danger/30 bg-semantic-danger/5 px-3 py-2 text-sm text-semantic-danger">
              {error}
            </div>
          )}

          {!loading && ctx && (
            <>
              {/* Client */}
              <div className="rounded-lg bg-grey-5 px-4 py-3">
                <p className="text-sm font-semibold text-tone-ink">{ctx.client.name ?? 'Unknown'}</p>
                <p className="text-xs text-grey-60 mt-0.5">{ctx.client.phone}</p>
              </div>

              {/* Service summary */}
              <div className="text-sm text-grey-75">
                {ctx.service?.name ?? 'Service'}
                {ctx.staff && <> · <span className="text-grey-60">{ctx.staff.name}</span></>}
              </div>

              {/* Loyalty section */}
              {program?.enabled && (
                <div className="rounded-lg border border-tone-sage/30 bg-tone-sage/5 px-3 py-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold text-tone-sage">Loyalty</p>
                    <p className="text-xs text-grey-75">
                      Balance: <span className="font-semibold">{balance} pts</span>
                    </p>
                  </div>

                  {existingRedemption > 0 ? (
                    <p className="text-sm text-tone-ink">
                      Already redeemed: <span className="font-semibold">{existingRedemption} pts</span>
                      <span className="text-grey-60"> (−S${existingDiscount.toFixed(2)})</span>
                    </p>
                  ) : canOfferRedemption ? (
                    <div className="space-y-1.5">
                      <p className="text-xs text-grey-75">
                        Apply points (min {program.minRedeemPoints}, max {maxRedeemable})
                      </p>
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          inputMode="numeric"
                          min={program.minRedeemPoints}
                          max={maxRedeemable}
                          step={1}
                          value={pointsToRedeem}
                          onChange={(e) => setPointsToRedeem(e.target.value)}
                          placeholder={`min ${program.minRedeemPoints}`}
                          disabled={submitting}
                          className="w-32 rounded-lg border border-grey-30 px-2 py-1.5 text-sm"
                        />
                        <span className="text-xs text-grey-60">
                          = −S${(validPoints / program.pointsPerDollarRedeem || 0).toFixed(2)}
                        </span>
                        {validPoints > 0 && (
                          <button
                            type="button"
                            onClick={() => setPointsToRedeem('')}
                            disabled={submitting}
                            className="ml-auto text-xs text-grey-60 hover:text-tone-ink underline"
                          >
                            Skip
                          </button>
                        )}
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-grey-60">
                      {balance < program.minRedeemPoints
                        ? `Below minimum of ${program.minRedeemPoints} pts.`
                        : 'Booking total too low to redeem.'}
                    </p>
                  )}
                </div>
              )}

              {/* Payment method */}
              <div>
                <label className="block text-xs font-medium text-grey-75 mb-1">Payment method</label>
                <select
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
                  disabled={submitting}
                  className="w-full rounded-lg border border-grey-30 px-3 py-2 text-sm"
                >
                  <option value="cash">Cash</option>
                  <option value="card">Card</option>
                  <option value="paynow">PayNow</option>
                  <option value="other">Other</option>
                </select>
              </div>

              {/* Totals */}
              <div className="border-t border-grey-15 pt-3 space-y-1 text-sm">
                <div className="flex justify-between text-grey-75">
                  <span>Subtotal</span>
                  <span>S${gross.toFixed(2)}</span>
                </div>
                {existingDiscount > 0 && (
                  <div className="flex justify-between text-tone-sage">
                    <span>Already-applied discount</span>
                    <span>−S${existingDiscount.toFixed(2)}</span>
                  </div>
                )}
                {newRedemptionSgd > 0 && (
                  <div className="flex justify-between text-tone-sage">
                    <span>Loyalty discount ({validPoints} pts)</span>
                    <span>−S${newRedemptionSgd.toFixed(2)}</span>
                  </div>
                )}
                <div className="flex justify-between text-tone-ink font-semibold pt-1 border-t border-grey-10">
                  <span>Total due</span>
                  <span>S${netDue.toFixed(2)}</span>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-grey-15 flex gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="px-4 py-2 rounded-lg text-sm font-medium text-grey-75 bg-grey-5 hover:bg-grey-15 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={loading || submitting || !!error}
            className="ml-auto px-4 py-2 rounded-lg text-sm font-semibold text-tone-surface bg-tone-ink hover:opacity-90 disabled:opacity-50"
          >
            {submitting
              ? 'Processing…'
              : validPoints > 0 && newRedemptionSgd > 0
                ? `Apply ${validPoints} pts & complete`
                : 'Take payment & complete'}
          </button>
        </div>
      </div>
    </div>
  );
}
