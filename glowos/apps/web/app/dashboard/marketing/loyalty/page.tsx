'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch } from '../../../lib/api';

// ─── Types ─────────────────────────────────────────────────────────────────────

interface LoyaltyProgram {
  id: string | null;
  merchantId?: string;
  enabled: boolean;
  pointsPerDollar: number;
  pointsPerVisit: number;
  pointsPerDollarRedeem: number;
  minRedeemPoints: number;
  earnExpiryMonths: number;
  createdAt?: string | null;
  updatedAt?: string | null;
}

// ─── LoyaltyProgramCard ────────────────────────────────────────────────────────

function LoyaltyProgramCard() {
  const [program, setProgram] = useState<LoyaltyProgram | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Editable state
  const [enabled, setEnabled] = useState(false);
  const [pointsPerDollar, setPointsPerDollar] = useState('1');
  const [pointsPerVisit, setPointsPerVisit] = useState('0');
  const [pointsPerDollarRedeem, setPointsPerDollarRedeem] = useState('100');
  const [minRedeemPoints, setMinRedeemPoints] = useState('100');
  const [earnExpiryMonths, setEarnExpiryMonths] = useState('0');

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    apiFetch('/merchant/loyalty/program')
      .then((data: { program: LoyaltyProgram }) => {
        const p = data.program;
        setProgram(p);
        setEnabled(p.enabled);
        setPointsPerDollar(String(p.pointsPerDollar));
        setPointsPerVisit(String(p.pointsPerVisit));
        setPointsPerDollarRedeem(String(p.pointsPerDollarRedeem));
        setMinRedeemPoints(String(p.minRedeemPoints));
        setEarnExpiryMonths(String(p.earnExpiryMonths));
      })
      .catch((err: Error) => setLoadError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const data = (await apiFetch('/merchant/loyalty/program', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled,
          pointsPerDollar: parseInt(pointsPerDollar, 10) || 0,
          pointsPerVisit: parseInt(pointsPerVisit, 10) || 0,
          pointsPerDollarRedeem: parseInt(pointsPerDollarRedeem, 10) || 100,
          minRedeemPoints: parseInt(minRedeemPoints, 10) || 0,
          earnExpiryMonths: parseInt(earnExpiryMonths, 10) || 0,
        }),
      })) as { program: LoyaltyProgram };
      setProgram(data.program);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }, [enabled, pointsPerDollar, pointsPerVisit, pointsPerDollarRedeem, minRedeemPoints, earnExpiryMonths]);

  // Derived: preview text for redeem rate
  const ppdRedeemNum = parseInt(pointsPerDollarRedeem, 10) || 100;
  const redeemPreview = `${ppdRedeemNum} points = SGD 1 off`;

  if (loading) return <p className="text-sm text-grey-50">Loading…</p>;
  if (loadError) return <p className="text-sm state-danger">{loadError}</p>;

  return (
    <div className="bg-tone-surface border border-grey-15 rounded-xl p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-tone-ink">Loyalty Points</h2>
          <p className="text-sm text-grey-60 mt-0.5">
            Clients earn points on every completed booking. They can redeem points for discounts.
          </p>
        </div>
        {/* Enable toggle */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className={`text-xs font-semibold uppercase tracking-wider ${enabled ? 'text-tone-sage' : 'text-grey-50'}`}>
            {enabled ? 'On' : 'Off'}
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            onClick={() => setEnabled((v) => !v)}
            className={`relative inline-flex h-7 flex-shrink-0 rounded-full border-2 transition-colors focus:outline-none focus:ring-2 focus:ring-tone-sage/30 ${
              enabled ? 'bg-tone-sage border-tone-sage' : 'bg-grey-15 border-grey-30'
            }`}
            style={{ width: '3rem' }}
          >
            <span
              className={`inline-block h-5 w-5 rounded-full bg-tone-surface shadow-md ring-1 ring-grey-30/50 transform transition-transform ${
                enabled ? 'translate-x-5' : 'translate-x-0.5'
              }`}
              style={{ marginTop: '1px' }}
            />
          </button>
        </div>
      </div>

      <div className="border-t border-grey-10 pt-5 space-y-5">
        {/* Earn rules */}
        <div>
          <h3 className="text-sm font-semibold text-grey-80 mb-3">Earn rules</h3>
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <label className="text-sm text-grey-70 w-52 flex-shrink-0">
                Points per SGD spent
              </label>
              <input
                type="number"
                min={0}
                max={100}
                value={pointsPerDollar}
                onChange={(e) => setPointsPerDollar(e.target.value)}
                className="w-20 px-3 py-1.5 border border-grey-20 rounded-lg text-sm text-tone-ink bg-tone-surface focus:outline-none focus:border-tone-ink"
              />
              <span className="text-sm text-grey-50">pts / SGD</span>
            </div>
            <div className="flex items-center gap-3">
              <label className="text-sm text-grey-70 w-52 flex-shrink-0">
                Bonus points per visit
              </label>
              <input
                type="number"
                min={0}
                max={1000}
                value={pointsPerVisit}
                onChange={(e) => setPointsPerVisit(e.target.value)}
                className="w-20 px-3 py-1.5 border border-grey-20 rounded-lg text-sm text-tone-ink bg-tone-surface focus:outline-none focus:border-tone-ink"
              />
              <span className="text-sm text-grey-50">pts / visit</span>
            </div>
          </div>
        </div>

        {/* Redeem rules */}
        <div>
          <h3 className="text-sm font-semibold text-grey-80 mb-3">Redeem rules</h3>
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <label className="text-sm text-grey-70 w-52 flex-shrink-0">
                Points per SGD 1 off
              </label>
              <input
                type="number"
                min={1}
                max={10000}
                value={pointsPerDollarRedeem}
                onChange={(e) => setPointsPerDollarRedeem(e.target.value)}
                className="w-24 px-3 py-1.5 border border-grey-20 rounded-lg text-sm text-tone-ink bg-tone-surface focus:outline-none focus:border-tone-ink"
              />
              <span className="text-sm text-grey-45">{redeemPreview}</span>
            </div>
            <div className="flex items-center gap-3">
              <label className="text-sm text-grey-70 w-52 flex-shrink-0">
                Minimum points to redeem
              </label>
              <input
                type="number"
                min={0}
                max={100000}
                value={minRedeemPoints}
                onChange={(e) => setMinRedeemPoints(e.target.value)}
                className="w-24 px-3 py-1.5 border border-grey-20 rounded-lg text-sm text-tone-ink bg-tone-surface focus:outline-none focus:border-tone-ink"
              />
              <span className="text-sm text-grey-50">pts minimum</span>
            </div>
          </div>
        </div>

        {/* Expiry */}
        <div>
          <h3 className="text-sm font-semibold text-grey-80 mb-3">Expiry</h3>
          <div className="flex items-center gap-3">
            <label className="text-sm text-grey-70 w-52 flex-shrink-0">
              Points expire after
            </label>
            <input
              type="number"
              min={0}
              max={60}
              value={earnExpiryMonths}
              onChange={(e) => setEarnExpiryMonths(e.target.value)}
              className="w-20 px-3 py-1.5 border border-grey-20 rounded-lg text-sm text-tone-ink bg-tone-surface focus:outline-none focus:border-tone-ink"
            />
            <span className="text-sm text-grey-50">
              months {earnExpiryMonths === '0' ? '(never expire)' : 'from earn date'}
            </span>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between pt-2 border-t border-grey-10">
        <p className="text-xs text-grey-45">
          {program?.updatedAt
            ? `Last saved ${new Date(program.updatedAt).toLocaleString('en-SG', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}`
            : program?.id ? 'Saved' : 'Not yet configured'}
        </p>
        <div className="flex items-center gap-3">
          {saveError && <p className="text-xs state-danger">{saveError}</p>}
          {saved && <p className="text-xs text-grey-60">Saved</p>}
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-1.5 bg-tone-ink text-tone-surface text-sm font-medium rounded-lg hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function LoyaltyPage() {
  const router = useRouter();
  // Owner-only client-side guard. Backend enforces the same rule on
  // GET /merchant/loyalty/program; this just avoids a flash of the form
  // for non-owners who could otherwise reach the route by direct URL.
  const [allowed, setAllowed] = useState<boolean | null>(null);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const u = JSON.parse(localStorage.getItem('user') ?? '{}');
      if (u.role === 'owner') {
        setAllowed(true);
      } else {
        setAllowed(false);
        router.replace('/dashboard');
      }
    } catch {
      setAllowed(false);
      router.replace('/dashboard');
    }
  }, [router]);

  if (allowed !== true) return null;

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-tone-ink">Loyalty program</h1>
        <p className="text-sm text-grey-60 mt-1">
          Configure how clients earn and redeem points at this location. Balances are
          per-merchant and preserved even when the program is toggled off.
        </p>
      </div>
      <LoyaltyProgramCard />
    </div>
  );
}
