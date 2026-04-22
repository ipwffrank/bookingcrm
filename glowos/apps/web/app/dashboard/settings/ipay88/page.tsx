'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiFetch } from '../../../lib/api';

interface Status {
  paymentGateway: 'stripe' | 'ipay88';
  ipay88: { connected: false } | {
    connected: true;
    merchantCode: string;
    currency: 'MYR' | 'SGD';
    environment: 'sandbox' | 'production';
  };
}

export default function Ipay88SettingsPage() {
  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [savedBanner, setSavedBanner] = useState(false);

  const [merchantCode, setMerchantCode] = useState('');
  const [merchantKey, setMerchantKey] = useState('');
  const [currency, setCurrency] = useState<'MYR' | 'SGD'>('MYR');
  const [environment, setEnvironment] = useState<'sandbox' | 'production'>('sandbox');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const s = (await apiFetch('/merchant/payments/ipay88/status')) as Status;
      setStatus(s);
      if (s.ipay88.connected) {
        setMerchantCode(s.ipay88.merchantCode);
        setCurrency(s.ipay88.currency);
        setEnvironment(s.ipay88.environment);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!merchantCode.trim() || !merchantKey.trim()) {
      setError('Merchant Code and Merchant Key are required');
      return;
    }
    setSaving(true);
    try {
      await apiFetch('/merchant/payments/ipay88/connect', {
        method: 'POST',
        body: JSON.stringify({
          merchant_code: merchantCode.trim(),
          merchant_key: merchantKey.trim(),
          currency,
          environment,
        }),
      });
      setMerchantKey('');
      setSavedBanner(true);
      setTimeout(() => setSavedBanner(false), 3000);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function handleDisconnect() {
    if (!confirm('Disconnect iPay88? Future bookings will fall back to Stripe.')) return;
    try {
      await apiFetch('/merchant/payments/ipay88/disconnect', { method: 'POST' });
      setMerchantCode('');
      setMerchantKey('');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Disconnect failed');
    }
  }

  return (
    <div className="max-w-2xl">
      <div className="mb-6">
        <Link href="/dashboard/settings" className="text-xs text-tone-sage hover:underline">← Back to settings</Link>
        <h1 className="text-2xl font-bold text-tone-ink mt-2">iPay88 payment gateway</h1>
        <p className="text-sm text-grey-60 mt-1">
          For Malaysia-market bookings. Accept FPX, DuitNow, Boost, GrabPay MY, Touch &apos;n Go, Visa &amp; Mastercard directly at the booking page.
        </p>
      </div>

      {error && (
        <div className="mb-4 rounded-lg bg-semantic-danger/5 border border-semantic-danger/30 px-4 py-3 text-sm text-semantic-danger">
          {error}
        </div>
      )}

      {savedBanner && (
        <div className="mb-4 rounded-lg bg-tone-sage/5 border border-tone-sage/30 px-4 py-3 text-sm text-tone-sage">
          iPay88 credentials saved. Your booking widget will now route payments through iPay88.
        </div>
      )}

      {loading ? (
        <div className="h-48 rounded-xl bg-tone-surface border border-grey-15 animate-pulse" />
      ) : status ? (
        <>
          {status.ipay88.connected && (
            <div className="mb-6 rounded-xl bg-tone-surface border border-grey-15 p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs text-grey-60 uppercase tracking-wider mb-1">Currently connected</p>
                  <p className="text-sm text-tone-ink">
                    <span className="font-mono">{status.ipay88.merchantCode}</span> · {status.ipay88.currency} ·{' '}
                    <span className={status.ipay88.environment === 'production' ? 'text-tone-sage' : 'text-semantic-warn'}>
                      {status.ipay88.environment}
                    </span>
                  </p>
                </div>
                <button
                  onClick={handleDisconnect}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium text-semantic-danger border border-semantic-danger/30 hover:bg-semantic-danger/5 transition-colors"
                >
                  Disconnect
                </button>
              </div>
            </div>
          )}

          <div className="bg-tone-surface rounded-xl border border-grey-15 p-6">
            <h2 className="text-sm font-semibold text-tone-ink mb-4">
              {status.ipay88.connected ? 'Update credentials' : 'Connect iPay88'}
            </h2>
            <form onSubmit={handleSave} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-grey-75 mb-1">Merchant Code</label>
                <input
                  type="text"
                  value={merchantCode}
                  onChange={(e) => setMerchantCode(e.target.value)}
                  className="w-full rounded-lg border border-grey-15 bg-tone-surface px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-tone-sage font-mono"
                  placeholder="e.g. M12345"
                  maxLength={20}
                />
                <p className="text-[11px] text-grey-45 mt-1">Issued by iPay88 during merchant onboarding.</p>
              </div>
              <div>
                <label className="block text-xs font-medium text-grey-75 mb-1">Merchant Key</label>
                <input
                  type="password"
                  value={merchantKey}
                  onChange={(e) => setMerchantKey(e.target.value)}
                  className="w-full rounded-lg border border-grey-15 bg-tone-surface px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-tone-sage font-mono"
                  placeholder={status.ipay88.connected ? '••••••••  (re-enter to update)' : 'Paste your MerchantKey'}
                  autoComplete="off"
                />
                <p className="text-[11px] text-grey-45 mt-1">
                  Treated as a secret. Stored server-side, never returned to the browser. If updating, paste the key once more.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-grey-75 mb-1">Currency</label>
                  <select
                    value={currency}
                    onChange={(e) => setCurrency(e.target.value as 'MYR' | 'SGD')}
                    className="w-full rounded-lg border border-grey-15 bg-tone-surface px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-tone-sage"
                  >
                    <option value="MYR">MYR — Malaysia</option>
                    <option value="SGD">SGD — Singapore</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-grey-75 mb-1">Environment</label>
                  <select
                    value={environment}
                    onChange={(e) => setEnvironment(e.target.value as 'sandbox' | 'production')}
                    className="w-full rounded-lg border border-grey-15 bg-tone-surface px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-tone-sage"
                  >
                    <option value="sandbox">Sandbox (test)</option>
                    <option value="production">Production (live)</option>
                  </select>
                </div>
              </div>
              <div className="pt-2">
                <button
                  type="submit"
                  disabled={saving}
                  className="w-full rounded-xl bg-tone-ink py-2.5 text-sm font-semibold text-tone-surface hover:opacity-90 disabled:opacity-60 transition-opacity"
                >
                  {saving ? 'Saving…' : status.ipay88.connected ? 'Update iPay88' : 'Connect iPay88'}
                </button>
              </div>
            </form>
          </div>

          <div className="mt-6 bg-semantic-warn/5 border border-semantic-warn/30 rounded-xl p-5 text-xs text-grey-75 space-y-2">
            <p className="font-semibold text-tone-ink">Before your first live transaction</p>
            <ol className="list-decimal list-inside space-y-1.5 ml-1">
              <li>Apply for an iPay88 merchant account at <a href="https://www.ipay88.com/how-to-apply-for-payment-gateway-with-ipay88/" target="_blank" rel="noopener noreferrer" className="text-tone-sage hover:underline">ipay88.com</a>. Expect 1–2 weeks.</li>
              <li>
                Email iPay88 support (<span className="font-mono">support@ipay88.com.my</span>) to whitelist:
                <ul className="list-disc list-inside ml-4 mt-1">
                  <li className="font-mono break-all">Response URL: https://bookingcrm-production.up.railway.app/webhooks/ipay88/response</li>
                  <li className="font-mono break-all">Backend URL: https://bookingcrm-production.up.railway.app/webhooks/ipay88/backend</li>
                </ul>
                Unregistered URLs are rejected with "Permission denied".
              </li>
              <li>Test with a MYR 1.00 transaction before switching Environment to <strong>production</strong>.</li>
              <li>Refunds are not self-service — contact iPay88 directly or use their merchant console.</li>
            </ol>
          </div>
        </>
      ) : null}
    </div>
  );
}
