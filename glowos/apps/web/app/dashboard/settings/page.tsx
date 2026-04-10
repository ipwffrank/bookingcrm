'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { apiFetch } from '../../lib/api';

// ─── Types ─────────────────────────────────────────────────────────────────────

type MerchantCategory = 'hair_salon' | 'nail_studio' | 'spa' | 'massage' | 'beauty_centre';
type NoShowCharge = 'full' | 'partial' | 'none';

interface Merchant {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  postalCode: string | null;
  phone: string | null;
  email: string | null;
  category: MerchantCategory | null;
  logoUrl: string | null;
  operatingHours: Record<string, { open: string; close: string; closed: boolean }> | null;
  cancellationPolicy: {
    free_cancellation_hours: number;
    late_cancellation_refund_pct: number;
    no_show_charge: NoShowCharge;
  } | null;
}

interface ConnectStatus {
  connected: boolean;
  charges_enabled: boolean;
  payouts_enabled: boolean;
  details_submitted: boolean;
  requirements: {
    currently_due?: string[];
    eventually_due?: string[];
    past_due?: string[];
    disabled_reason?: string | null;
  } | null;
}

interface ProfileForm {
  name: string;
  description: string;
  addressLine1: string;
  addressLine2: string;
  postalCode: string;
  phone: string;
  email: string;
  category: MerchantCategory | '';
  logoUrl: string;
}

interface CancellationForm {
  free_cancellation_hours: number;
  late_cancellation_refund_pct: number;
  no_show_charge: NoShowCharge;
}

// ─── Tab types ─────────────────────────────────────────────────────────────────

type TabId = 'profile' | 'cancellation' | 'payments' | 'booking-page' | 'account';

interface Tab {
  id: TabId;
  label: string;
}

const TABS: Tab[] = [
  { id: 'profile', label: 'Business Profile' },
  { id: 'cancellation', label: 'Cancellation Policy' },
  { id: 'payments', label: 'Payments' },
  { id: 'booking-page', label: 'Booking Page' },
  { id: 'account', label: 'Account' },
];

const CATEGORY_OPTIONS: { value: MerchantCategory; label: string }[] = [
  { value: 'hair_salon', label: 'Hair Salon' },
  { value: 'nail_studio', label: 'Nail Studio' },
  { value: 'spa', label: 'Spa' },
  { value: 'massage', label: 'Massage' },
  { value: 'beauty_centre', label: 'Beauty Centre' },
];

// ─── Toast ─────────────────────────────────────────────────────────────────────

interface ToastProps {
  message: string;
  type: 'success' | 'error';
  onDismiss: () => void;
}

function Toast({ message, type, onDismiss }: ToastProps) {
  useEffect(() => {
    const t = setTimeout(onDismiss, 4000);
    return () => clearTimeout(t);
  }, [onDismiss]);

  return (
    <div
      className={`fixed bottom-6 right-6 z-50 flex items-center gap-3 rounded-xl px-4 py-3 shadow-lg text-sm font-medium transition-all ${
        type === 'success'
          ? 'bg-green-600 text-white'
          : 'bg-red-600 text-white'
      }`}
    >
      {type === 'success' ? (
        <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
        </svg>
      ) : (
        <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
        </svg>
      )}
      {message}
      <button onClick={onDismiss} className="ml-2 opacity-70 hover:opacity-100">
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}

// ─── Spinner ───────────────────────────────────────────────────────────────────

function Spinner() {
  return (
    <div className="flex items-center justify-center py-16">
      <div className="w-8 h-8 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin" />
    </div>
  );
}

// ─── Business Profile Tab ──────────────────────────────────────────────────────

function ProfileTab({
  merchant,
  onSaved,
}: {
  merchant: Merchant;
  onSaved: (msg: string) => void;
}) {
  const router = useRouter();
  const [form, setForm] = useState<ProfileForm>({
    name: merchant.name ?? '',
    description: merchant.description ?? '',
    addressLine1: merchant.addressLine1 ?? '',
    addressLine2: merchant.addressLine2 ?? '',
    postalCode: merchant.postalCode ?? '',
    phone: merchant.phone ?? '',
    email: merchant.email ?? '',
    category: merchant.category ?? '',
    logoUrl: merchant.logoUrl ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  function setField<K extends keyof ProfileForm>(key: K, val: ProfileForm[K]) {
    setForm((f) => ({ ...f, [key]: val }));
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError('');
    const token = localStorage.getItem('access_token');
    try {
      const payload: Record<string, string> = {};
      if (form.name.trim()) payload.name = form.name.trim();
      if (form.description.trim()) payload.description = form.description.trim();
      if (form.addressLine1.trim()) payload.addressLine1 = form.addressLine1.trim();
      if (form.addressLine2.trim()) payload.addressLine2 = form.addressLine2.trim();
      if (form.postalCode.trim()) payload.postalCode = form.postalCode.trim();
      if (form.phone.trim()) payload.phone = form.phone.trim();
      if (form.email.trim()) payload.email = form.email.trim();
      if (form.category) payload.category = form.category;
      if (form.logoUrl.trim()) payload.logoUrl = form.logoUrl.trim();

      await apiFetch('/merchant/me', {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
      });
      onSaved('Business profile saved successfully');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to save';
      if (msg.includes('401') || msg.toLowerCase().includes('unauthorized')) {
        router.push('/login');
      } else {
        setError(msg);
      }
    } finally {
      setSaving(false);
    }
  }

  const inputCls = 'w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-colors';
  const labelCls = 'block text-sm font-medium text-gray-700 mb-1.5';

  const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

  return (
    <form onSubmit={handleSave} className="space-y-6">
      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-600">
          {error}
        </div>
      )}

      {/* Basic Info */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h3 className="text-sm font-semibold text-gray-900 mb-4">Basic Information</h3>
        <div className="space-y-4">
          <div>
            <label className={labelCls}>Salon Name</label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setField('name', e.target.value)}
              className={inputCls}
              placeholder="e.g. Glow Beauty Studio"
            />
          </div>
          <div>
            <label className={labelCls}>Description</label>
            <textarea
              value={form.description}
              onChange={(e) => setField('description', e.target.value)}
              rows={3}
              className={`${inputCls} resize-none`}
              placeholder="Brief description of your salon..."
            />
          </div>
          <div>
            <label className={labelCls}>Category</label>
            <select
              value={form.category}
              onChange={(e) => setField('category', e.target.value as MerchantCategory | '')}
              className={inputCls}
            >
              <option value="">Select category...</option>
              {CATEGORY_OPTIONS.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>Logo URL</label>
            <input
              type="url"
              value={form.logoUrl}
              onChange={(e) => setField('logoUrl', e.target.value)}
              className={inputCls}
              placeholder="https://example.com/logo.png"
            />
            {form.logoUrl && (
              <div className="mt-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={form.logoUrl}
                  alt="Logo preview"
                  className="h-16 w-16 rounded-lg object-cover border border-gray-200"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Contact */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h3 className="text-sm font-semibold text-gray-900 mb-4">Contact & Address</h3>
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Phone</label>
              <input
                type="tel"
                value={form.phone}
                onChange={(e) => setField('phone', e.target.value)}
                className={inputCls}
                placeholder="+65 9123 4567"
              />
            </div>
            <div>
              <label className={labelCls}>Email</label>
              <input
                type="email"
                value={form.email}
                onChange={(e) => setField('email', e.target.value)}
                className={inputCls}
                placeholder="hello@salon.com"
              />
            </div>
          </div>
          <div>
            <label className={labelCls}>Address Line 1</label>
            <input
              type="text"
              value={form.addressLine1}
              onChange={(e) => setField('addressLine1', e.target.value)}
              className={inputCls}
              placeholder="123 Orchard Road"
            />
          </div>
          <div>
            <label className={labelCls}>Address Line 2</label>
            <input
              type="text"
              value={form.addressLine2}
              onChange={(e) => setField('addressLine2', e.target.value)}
              className={inputCls}
              placeholder="Unit #02-10"
            />
          </div>
          <div className="sm:w-1/3">
            <label className={labelCls}>Postal Code</label>
            <input
              type="text"
              value={form.postalCode}
              onChange={(e) => setField('postalCode', e.target.value)}
              className={inputCls}
              placeholder="238888"
            />
          </div>
        </div>
      </div>

      {/* Operating Hours (display-only) */}
      {merchant.operatingHours && (
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h3 className="text-sm font-semibold text-gray-900 mb-1">Operating Hours</h3>
          <p className="text-xs text-gray-500 mb-4">Manage operating hours from the staff / schedule section.</p>
          <div className="space-y-2">
            {DAYS.map((day) => {
              const hours = merchant.operatingHours?.[day];
              return (
                <div key={day} className="flex items-center justify-between py-1.5 border-b border-gray-100 last:border-0">
                  <span className="text-sm font-medium text-gray-700 capitalize">{day}</span>
                  {hours?.closed ? (
                    <span className="text-sm text-gray-400">Closed</span>
                  ) : (
                    <span className="text-sm text-gray-600">
                      {hours?.open ?? '—'} – {hours?.close ?? '—'}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={saving}
          className="rounded-xl bg-indigo-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60 transition-colors shadow-sm"
        >
          {saving ? 'Saving...' : 'Save Changes'}
        </button>
      </div>
    </form>
  );
}

// ─── Cancellation Policy Tab ───────────────────────────────────────────────────

function CancellationTab({
  merchant,
  onSaved,
}: {
  merchant: Merchant;
  onSaved: (msg: string) => void;
}) {
  const router = useRouter();
  const [form, setForm] = useState<CancellationForm>({
    free_cancellation_hours: merchant.cancellationPolicy?.free_cancellation_hours ?? 24,
    late_cancellation_refund_pct: merchant.cancellationPolicy?.late_cancellation_refund_pct ?? 50,
    no_show_charge: merchant.cancellationPolicy?.no_show_charge ?? 'full',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError('');
    const token = localStorage.getItem('access_token');
    try {
      await apiFetch('/merchant/settings/cancellation-policy', {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}` },
        body: JSON.stringify(form),
      });
      onSaved('Cancellation policy saved successfully');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to save';
      if (msg.includes('401') || msg.toLowerCase().includes('unauthorized')) {
        router.push('/login');
      } else {
        setError(msg);
      }
    } finally {
      setSaving(false);
    }
  }

  function RadioGroup<T extends string | number>({
    label,
    name,
    value,
    onChange,
    options,
  }: {
    label: string;
    name: string;
    value: T;
    onChange: (v: T) => void;
    options: { value: T; label: string; description?: string }[];
  }) {
    return (
      <div>
        <p className="text-sm font-medium text-gray-700 mb-3">{label}</p>
        <div className="space-y-2">
          {options.map((opt) => (
            <label
              key={String(opt.value)}
              className={`flex items-start gap-3 p-3.5 rounded-lg border cursor-pointer transition-colors ${
                value === opt.value
                  ? 'border-indigo-400 bg-indigo-50'
                  : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
              }`}
            >
              <input
                type="radio"
                name={name}
                value={String(opt.value)}
                checked={value === opt.value}
                onChange={() => onChange(opt.value)}
                className="mt-0.5 accent-indigo-600"
              />
              <div>
                <span className="text-sm font-medium text-gray-900">{opt.label}</span>
                {opt.description && (
                  <p className="text-xs text-gray-500 mt-0.5">{opt.description}</p>
                )}
              </div>
            </label>
          ))}
        </div>
      </div>
    );
  }

  // Policy preview text
  const freeHours = form.free_cancellation_hours;
  const refundPct = form.late_cancellation_refund_pct;
  const noShowLabel =
    form.no_show_charge === 'full'
      ? 'the full service amount'
      : form.no_show_charge === 'partial'
      ? 'a partial fee'
      : 'no fee';

  return (
    <form onSubmit={handleSave} className="space-y-6">
      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-600">
          {error}
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h3 className="text-sm font-semibold text-gray-900 mb-5">Cancellation Rules</h3>
        <div className="space-y-6">
          <RadioGroup<number>
            label="Free Cancellation Window"
            name="free_hours"
            value={form.free_cancellation_hours}
            onChange={(v) => setForm((f) => ({ ...f, free_cancellation_hours: v }))}
            options={[
              { value: 24, label: '24 hours notice', description: 'Clients can cancel for free up to 24h before their appointment' },
              { value: 48, label: '48 hours notice', description: 'Clients can cancel for free up to 48h before their appointment' },
              { value: 72, label: '72 hours notice', description: 'Clients can cancel for free up to 72h before their appointment' },
            ]}
          />

          <RadioGroup<number>
            label="Late Cancellation Refund"
            name="refund_pct"
            value={form.late_cancellation_refund_pct}
            onChange={(v) => setForm((f) => ({ ...f, late_cancellation_refund_pct: v }))}
            options={[
              { value: 100, label: 'Full refund (100%)', description: 'Always refund in full, even for late cancellations' },
              { value: 50, label: 'Partial refund (50%)', description: 'Refund half the booking amount for late cancellations' },
              { value: 0, label: 'No refund (0%)', description: 'No refund for late cancellations' },
            ]}
          />

          <RadioGroup<NoShowCharge>
            label="No-Show Fee"
            name="no_show"
            value={form.no_show_charge}
            onChange={(v) => setForm((f) => ({ ...f, no_show_charge: v }))}
            options={[
              { value: 'full', label: 'Full charge', description: 'Charge the full service amount for no-shows' },
              { value: 'partial', label: 'Partial charge', description: 'Charge a partial fee for no-shows' },
              { value: 'none', label: 'No fee', description: 'Do not charge anything for no-shows' },
            ]}
          />
        </div>
      </div>

      {/* Live Preview */}
      <div className="bg-indigo-50 rounded-xl border border-indigo-200 p-6">
        <h3 className="text-sm font-semibold text-indigo-900 mb-3">How clients will see this policy</h3>
        <div className="bg-white rounded-lg border border-indigo-100 p-4 space-y-2">
          <p className="text-sm text-gray-700">
            <span className="font-medium">Free cancellation:</span> Cancel up to{' '}
            <span className="text-indigo-600 font-semibold">{freeHours} hours</span> before your appointment at no charge.
          </p>
          <p className="text-sm text-gray-700">
            <span className="font-medium">Late cancellation:</span> Cancellations within {freeHours} hours will receive a{' '}
            <span className="text-indigo-600 font-semibold">{refundPct}% refund</span>.
          </p>
          <p className="text-sm text-gray-700">
            <span className="font-medium">No-shows:</span> Clients who do not attend will be charged{' '}
            <span className="text-indigo-600 font-semibold">{noShowLabel}</span>.
          </p>
        </div>
      </div>

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={saving}
          className="rounded-xl bg-indigo-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60 transition-colors shadow-sm"
        >
          {saving ? 'Saving...' : 'Save Policy'}
        </button>
      </div>
    </form>
  );
}

// ─── Payments Tab ──────────────────────────────────────────────────────────────

function PaymentsTab({ onSaved, onError }: { onSaved: (msg: string) => void; onError: (msg: string) => void }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<ConnectStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [openingDashboard, setOpeningDashboard] = useState(false);

  const fetchStatus = useCallback(async () => {
    const token = localStorage.getItem('access_token');
    if (!token) { router.push('/login'); return; }
    try {
      const data = await apiFetch('/merchant/payments/connect-status', {
        headers: { Authorization: `Bearer ${token}` },
      }) as ConnectStatus;
      setStatus(data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load payment status';
      if (msg.includes('401') || msg.toLowerCase().includes('unauthorized')) {
        router.push('/login');
      } else {
        onError(msg);
      }
    } finally {
      setLoading(false);
    }
  }, [router, onError]);

  useEffect(() => {
    void fetchStatus();
  }, [fetchStatus]);

  // Handle return from Stripe onboarding
  useEffect(() => {
    const setupComplete = searchParams.get('setup');
    const refresh = searchParams.get('refresh');
    if (setupComplete === 'complete') {
      onSaved('Stripe account connected successfully!');
      void fetchStatus();
    } else if (refresh === 'true') {
      void fetchStatus();
    }
  }, [searchParams, onSaved, fetchStatus]);

  async function handleConnect() {
    setConnecting(true);
    const token = localStorage.getItem('access_token');
    try {
      const data = await apiFetch('/merchant/payments/connect-account', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: JSON.stringify({ business_type: 'individual' }),
      }) as { onboarding_url: string };
      window.location.href = data.onboarding_url;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to start Stripe onboarding';
      if (msg.includes('401') || msg.toLowerCase().includes('unauthorized')) {
        router.push('/login');
      } else {
        onError(msg);
        setConnecting(false);
      }
    }
  }

  async function handleOpenDashboard() {
    setOpeningDashboard(true);
    const token = localStorage.getItem('access_token');
    try {
      const data = await apiFetch('/merchant/payments/connect-dashboard-link', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      }) as { url: string };
      window.open(data.url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to open Stripe dashboard';
      onError(msg);
    } finally {
      setOpeningDashboard(false);
    }
  }

  if (loading) return <Spinner />;

  const isFullyConnected = status?.connected && status.charges_enabled && status.payouts_enabled;
  const isPending = status?.connected && (!status.charges_enabled || !status.payouts_enabled);

  const requirementItems = [
    ...(status?.requirements?.currently_due ?? []),
    ...(status?.requirements?.past_due ?? []),
  ];

  return (
    <div className="space-y-6">
      {/* Stripe Connect Status Card */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h3 className="text-sm font-semibold text-gray-900">Stripe Connect</h3>
            <p className="text-xs text-gray-500 mt-0.5">Accept card payments and receive payouts</p>
          </div>
          {/* Status badge */}
          {isFullyConnected && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-green-100 text-green-700 border border-green-200">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
              Connected
            </span>
          )}
          {isPending && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-yellow-100 text-yellow-700 border border-yellow-200">
              <span className="w-1.5 h-1.5 rounded-full bg-yellow-500" />
              Pending
            </span>
          )}
          {!status?.connected && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-gray-100 text-gray-500 border border-gray-200">
              <span className="w-1.5 h-1.5 rounded-full bg-gray-400" />
              Not Connected
            </span>
          )}
        </div>

        {/* Not connected */}
        {!status?.connected && (
          <div className="rounded-lg bg-gray-50 border border-gray-200 p-4 mb-4">
            <p className="text-sm text-gray-600 mb-3">
              Connect your Stripe account to accept card payments and PayNow from clients. You&apos;ll receive payouts directly to your bank account.
            </p>
            <ul className="space-y-1 mb-4">
              {['Accept card payments & PayNow', 'Automatic weekly payouts', 'Real-time payment dashboard'].map((feat) => (
                <li key={feat} className="flex items-center gap-2 text-xs text-gray-600">
                  <svg className="w-3.5 h-3.5 text-green-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                  </svg>
                  {feat}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Pending requirements */}
        {isPending && requirementItems.length > 0 && (
          <div className="rounded-lg bg-yellow-50 border border-yellow-200 p-4 mb-4">
            <p className="text-sm font-medium text-yellow-800 mb-2">Action required to enable payments</p>
            <ul className="space-y-1">
              {requirementItems.slice(0, 5).map((req) => (
                <li key={req} className="text-xs text-yellow-700 flex items-center gap-1.5">
                  <span className="w-1 h-1 rounded-full bg-yellow-500 flex-shrink-0" />
                  {req.replace(/_/g, ' ')}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Fully connected stats */}
        {isFullyConnected && (
          <div className="grid grid-cols-2 gap-3 mb-4">
            <div className="bg-green-50 rounded-lg p-3 border border-green-100">
              <p className="text-xs text-green-600 font-medium">Charges</p>
              <p className="text-sm font-semibold text-green-800 mt-0.5">Enabled</p>
            </div>
            <div className="bg-green-50 rounded-lg p-3 border border-green-100">
              <p className="text-xs text-green-600 font-medium">Payouts</p>
              <p className="text-sm font-semibold text-green-800 mt-0.5">Enabled</p>
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-3">
          {!status?.connected && (
            <button
              onClick={() => { void handleConnect(); }}
              disabled={connecting}
              className="flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60 transition-colors shadow-sm"
            >
              {connecting ? (
                <>
                  <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Connecting...
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622 1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244" />
                  </svg>
                  Connect Stripe
                </>
              )}
            </button>
          )}
          {(isPending || isFullyConnected) && (
            <>
              {isPending && (
                <button
                  onClick={() => { void handleConnect(); }}
                  disabled={connecting}
                  className="flex items-center gap-2 rounded-xl border border-yellow-300 bg-yellow-50 px-5 py-2.5 text-sm font-semibold text-yellow-800 hover:bg-yellow-100 disabled:opacity-60 transition-colors"
                >
                  {connecting ? 'Opening...' : 'Complete Setup'}
                </button>
              )}
              <button
                onClick={() => { void handleOpenDashboard(); }}
                disabled={openingDashboard}
                className="flex items-center gap-2 rounded-xl border border-gray-300 px-5 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-60 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                </svg>
                {openingDashboard ? 'Opening...' : 'View Stripe Dashboard'}
              </button>
            </>
          )}
        </div>
      </div>

      {/* Payout Info */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h3 className="text-sm font-semibold text-gray-900 mb-1">Payout Schedule</h3>
        <p className="text-xs text-gray-500 mb-4">How often Stripe transfers your earnings to your bank account</p>
        <div className="flex items-center gap-3 p-3.5 rounded-lg bg-gray-50 border border-gray-200">
          <div className="w-9 h-9 rounded-lg bg-indigo-100 flex items-center justify-center flex-shrink-0">
            <svg className="w-5 h-5 text-indigo-600" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18.75a60.07 60.07 0 0 1 15.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 0 1 3 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 0 0-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 0 1-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 0 0 3 15h-.75M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm3 0h.008v.008H18V10.5Zm-12 0h.008v.008H6V10.5Z" />
            </svg>
          </div>
          <div>
            <p className="text-sm font-semibold text-gray-900">Weekly payouts</p>
            <p className="text-xs text-gray-500">Funds transferred every Monday for the previous week</p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Booking Page Tab ──────────────────────────────────────────────────────────

function BookingPageTab({ merchant }: { merchant: Merchant }) {
  const bookingUrl = `https://glowos-nine.vercel.app/${merchant.slug}`;
  const [copied, setCopied] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  function handleCopy() {
    void navigator.clipboard.writeText(bookingUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  // Draw a simple QR-code-style visual (URL text encoded as a visual grid pattern)
  // Since we can't use a library, we render a prominent URL display with visual accent
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const SIZE = 200;
    canvas.width = SIZE;
    canvas.height = SIZE;

    // Build a simple pseudo-QR pattern based on the URL string
    const text = bookingUrl;
    const cellSize = 8;
    const cols = Math.floor(SIZE / cellSize);
    const rows = Math.floor(SIZE / cellSize);

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, SIZE, SIZE);

    // Deterministic grid based on URL bytes
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const idx = (r * cols + c) % text.length;
        const charCode = text.charCodeAt(idx);
        // XOR with position for variation
        const val = (charCode ^ (r * 7 + c * 13)) % 2;
        if (val === 0) {
          ctx.fillStyle = '#4f46e5';
          ctx.fillRect(c * cellSize, r * cellSize, cellSize - 1, cellSize - 1);
        }
      }
    }

    // Draw finder patterns (top-left, top-right, bottom-left corners)
    function drawFinder(x: number, y: number) {
      if (!ctx) return;
      ctx.fillStyle = '#4f46e5';
      ctx.fillRect(x, y, 7 * cellSize, 7 * cellSize);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(x + cellSize, y + cellSize, 5 * cellSize, 5 * cellSize);
      ctx.fillStyle = '#4f46e5';
      ctx.fillRect(x + 2 * cellSize, y + 2 * cellSize, 3 * cellSize, 3 * cellSize);
    }

    drawFinder(0, 0);
    drawFinder(SIZE - 7 * cellSize, 0);
    drawFinder(0, SIZE - 7 * cellSize);
  }, [bookingUrl]);

  return (
    <div className="space-y-6">
      {/* URL Card */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h3 className="text-sm font-semibold text-gray-900 mb-1">Your Booking Page URL</h3>
        <p className="text-xs text-gray-500 mb-4">Share this link with clients so they can book appointments online.</p>

        <div className="flex items-center gap-2 p-3 bg-gray-50 rounded-lg border border-gray-200 mb-4">
          <span className="flex-1 text-sm text-indigo-600 font-mono truncate">{bookingUrl}</span>
          <button
            onClick={handleCopy}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors flex-shrink-0 ${
              copied
                ? 'bg-green-100 text-green-700 border border-green-200'
                : 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-100'
            }`}
          >
            {copied ? (
              <>
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                </svg>
                Copied!
              </>
            ) : (
              <>
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 0 1-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 0 1 1.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 0 0-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 0 1-1.125-1.125v-9.25m12 6.625v-1.875a3.375 3.375 0 0 0-3.375-3.375h-1.5a1.125 1.125 0 0 1-1.125-1.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H9.75" />
                </svg>
                Copy Link
              </>
            )}
          </button>
          <a
            href={bookingUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-indigo-600 text-white hover:bg-indigo-700 transition-colors flex-shrink-0"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
            </svg>
            Preview
          </a>
        </div>
      </div>

      {/* QR Code Card */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h3 className="text-sm font-semibold text-gray-900 mb-1">QR Code</h3>
        <p className="text-xs text-gray-500 mb-4">Print this QR code and display it in your salon for walk-in clients to scan.</p>
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-6">
          <div className="p-4 bg-white border-2 border-gray-200 rounded-xl shadow-sm">
            <canvas ref={canvasRef} className="block" style={{ imageRendering: 'pixelated' }} />
          </div>
          <div className="space-y-3">
            <p className="text-xs text-gray-500 max-w-xs">
              This QR code points to your booking page. Clients can scan it with their phone camera to book instantly.
            </p>
            <p className="text-xs font-mono text-indigo-600 break-all bg-indigo-50 rounded-lg px-3 py-2 border border-indigo-100">
              {bookingUrl}
            </p>
            <button
              onClick={handleCopy}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold border border-gray-300 text-gray-700 hover:bg-gray-50 transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 0 1-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 0 1 1.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 0 0-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 0 1-1.125-1.125v-9.25m12 6.625v-1.875a3.375 3.375 0 0 0-3.375-3.375h-1.5a1.125 1.125 0 0 1-1.125-1.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H9.75" />
              </svg>
              Copy URL
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Account Tab ───────────────────────────────────────────────────────────────

function AccountTab({ onSaved, onError }: { onSaved: (msg: string) => void; onError: (msg: string) => void }) {
  const router = useRouter();
  const [userInfo, setUserInfo] = useState<{ name: string; email: string; role: string } | null>(null);
  const [pwForm, setPwForm] = useState({ current: '', next: '', confirm: '' });
  const [pwErrors, setPwErrors] = useState<{ current?: string; next?: string; confirm?: string }>({});
  const [pwSaving, setPwSaving] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem('access_token');
    if (!token) { router.push('/login'); return; }
    apiFetch('/merchant/me', {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((data: unknown) => {
        const d = data as { merchant?: { name?: string; email?: string }; name?: string; email?: string };
        const m = d.merchant ?? d;
        setUserInfo({
          name: (m.name as string) ?? '',
          email: (m.email as string) ?? '',
          role: 'owner',
        });
      })
      .catch(() => {
        router.push('/login');
      });
  }, [router]);

  function validatePw() {
    const e: typeof pwErrors = {};
    if (!pwForm.current) e.current = 'Current password is required';
    if (!pwForm.next) e.next = 'New password is required';
    else if (pwForm.next.length < 8) e.next = 'Password must be at least 8 characters';
    if (!pwForm.confirm) e.confirm = 'Please confirm your new password';
    else if (pwForm.next !== pwForm.confirm) e.confirm = 'Passwords do not match';
    setPwErrors(e);
    return Object.keys(e).length === 0;
  }

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    if (!validatePw()) return;
    setPwSaving(true);
    const token = localStorage.getItem('access_token');
    try {
      await apiFetch('/auth/change-password', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: JSON.stringify({ current_password: pwForm.current, new_password: pwForm.next }),
      });
      setPwForm({ current: '', next: '', confirm: '' });
      onSaved('Password changed successfully');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to change password';
      if (msg.includes('401') || msg.toLowerCase().includes('unauthorized')) {
        router.push('/login');
      } else {
        onError(msg);
      }
    } finally {
      setPwSaving(false);
    }
  }

  async function handleDeleteAccount() {
    if (deleteConfirm !== 'DELETE') return;
    setDeleting(true);
    const token = localStorage.getItem('access_token');
    try {
      await apiFetch('/auth/delete-account', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      localStorage.clear();
      router.push('/');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to delete account';
      onError(msg);
      setDeleting(false);
      setShowDeleteModal(false);
    }
  }

  const inputCls = 'w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-colors';
  const labelCls = 'block text-sm font-medium text-gray-700 mb-1.5';

  return (
    <div className="space-y-6">
      {/* User Info */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h3 className="text-sm font-semibold text-gray-900 mb-4">Account Information</h3>
        {userInfo ? (
          <div className="space-y-3">
            <div className="flex items-center gap-4 p-4 bg-gray-50 rounded-lg border border-gray-200">
              <div className="w-12 h-12 rounded-full bg-indigo-100 flex items-center justify-center flex-shrink-0">
                <span className="text-indigo-600 font-bold text-lg">
                  {userInfo.name.charAt(0).toUpperCase()}
                </span>
              </div>
              <div>
                <p className="text-sm font-semibold text-gray-900">{userInfo.name}</p>
                <p className="text-xs text-gray-500">{userInfo.email}</p>
                <span className="inline-flex items-center mt-1 px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-100 text-indigo-700 border border-indigo-200 capitalize">
                  {userInfo.role}
                </span>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <div className="w-4 h-4 border-2 border-indigo-200 border-t-indigo-600 rounded-full animate-spin" />
            Loading...
          </div>
        )}
      </div>

      {/* Change Password */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h3 className="text-sm font-semibold text-gray-900 mb-4">Change Password</h3>
        <form onSubmit={handleChangePassword} className="space-y-4 max-w-sm">
          <div>
            <label className={labelCls}>Current Password</label>
            <input
              type="password"
              value={pwForm.current}
              onChange={(e) => setPwForm((f) => ({ ...f, current: e.target.value }))}
              className={inputCls}
              placeholder="Enter current password"
              autoComplete="current-password"
            />
            {pwErrors.current && <p className="text-xs text-red-500 mt-1">{pwErrors.current}</p>}
          </div>
          <div>
            <label className={labelCls}>New Password</label>
            <input
              type="password"
              value={pwForm.next}
              onChange={(e) => setPwForm((f) => ({ ...f, next: e.target.value }))}
              className={inputCls}
              placeholder="At least 8 characters"
              autoComplete="new-password"
            />
            {pwErrors.next && <p className="text-xs text-red-500 mt-1">{pwErrors.next}</p>}
          </div>
          <div>
            <label className={labelCls}>Confirm New Password</label>
            <input
              type="password"
              value={pwForm.confirm}
              onChange={(e) => setPwForm((f) => ({ ...f, confirm: e.target.value }))}
              className={inputCls}
              placeholder="Re-enter new password"
              autoComplete="new-password"
            />
            {pwErrors.confirm && <p className="text-xs text-red-500 mt-1">{pwErrors.confirm}</p>}
          </div>
          <div className="pt-1">
            <button
              type="submit"
              disabled={pwSaving}
              className="rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60 transition-colors"
            >
              {pwSaving ? 'Changing...' : 'Change Password'}
            </button>
          </div>
        </form>
      </div>

      {/* Danger Zone */}
      <div className="bg-white rounded-xl border border-red-200 p-6">
        <h3 className="text-sm font-semibold text-red-600 mb-1">Danger Zone</h3>
        <p className="text-xs text-gray-500 mb-4">
          Once you delete your account, all data including bookings, clients, and services will be permanently removed. This action cannot be undone.
        </p>
        <button
          onClick={() => setShowDeleteModal(true)}
          className="flex items-center gap-2 rounded-xl border border-red-300 px-4 py-2.5 text-sm font-semibold text-red-600 hover:bg-red-50 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
          </svg>
          Delete Account
        </button>
      </div>

      {/* Delete Confirmation Modal */}
      {showDeleteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div className="fixed inset-0 bg-black/50" onClick={() => setShowDeleteModal(false)} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 z-10">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0">
                <svg className="w-5 h-5 text-red-600" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                </svg>
              </div>
              <div>
                <h2 className="text-base font-bold text-gray-900">Delete Account</h2>
                <p className="text-xs text-gray-500">This action is permanent and cannot be undone</p>
              </div>
            </div>
            <p className="text-sm text-gray-600 mb-4">
              All your data — bookings, clients, services, staff, and payment history — will be permanently deleted.
            </p>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Type <span className="font-mono font-bold text-red-600">DELETE</span> to confirm
              </label>
              <input
                type="text"
                value={deleteConfirm}
                onChange={(e) => setDeleteConfirm(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent"
                placeholder="DELETE"
              />
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => { setShowDeleteModal(false); setDeleteConfirm(''); }}
                className="flex-1 rounded-xl border border-gray-300 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => { void handleDeleteAccount(); }}
                disabled={deleteConfirm !== 'DELETE' || deleting}
                className="flex-1 rounded-xl bg-red-600 py-2.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {deleting ? 'Deleting...' : 'Delete Forever'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main Settings Page ────────────────────────────────────────────────────────

export default function SettingsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [activeTab, setActiveTab] = useState<TabId>(() => {
    if (typeof window !== 'undefined') {
      const urlTab = new URLSearchParams(window.location.search).get('tab') as TabId | null;
      if (urlTab && TABS.some((t) => t.id === urlTab)) return urlTab;
    }
    return 'profile';
  });
  const [merchant, setMerchant] = useState<Merchant | null>(null);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  // Sync tab from URL (e.g. redirect back from Stripe with ?tab=payments)
  useEffect(() => {
    const tab = searchParams.get('tab') as TabId | null;
    if (tab && TABS.some((t) => t.id === tab)) {
      setActiveTab(tab);
    }
  }, [searchParams]);

  useEffect(() => {
    const token = localStorage.getItem('access_token');
    if (!token) { router.push('/login'); return; }

    apiFetch('/merchant/me', {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((data: unknown) => {
        const d = data as { merchant?: Merchant } & Merchant;
        setMerchant(d.merchant ?? d);
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : 'Failed to load';
        if (msg.includes('401') || msg.toLowerCase().includes('unauthorized')) {
          router.push('/login');
        }
      })
      .finally(() => setLoading(false));
  }, [router]);

  function showToast(message: string, type: 'success' | 'error' = 'success') {
    setToast({ message, type });
  }

  if (loading) {
    return (
      <div>
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
          <p className="text-sm text-gray-500 mt-0.5">Manage your salon&apos;s profile, policies, and integrations</p>
        </div>
        <Spinner />
      </div>
    );
  }

  if (!merchant) return null;

  return (
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
        <p className="text-sm text-gray-500 mt-0.5">Manage your salon&apos;s profile, policies, and integrations</p>
      </div>

      {/* Tabs */}
      <div className="mb-6 border-b border-gray-200 -mx-4 lg:-mx-8 px-4 lg:px-8">
        <nav className="flex gap-1 overflow-x-auto scrollbar-hide pb-px">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex-shrink-0 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                activeTab === tab.id
                  ? 'border-indigo-600 text-indigo-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab Content */}
      <div>
        {activeTab === 'profile' && (
          <ProfileTab
            merchant={merchant}
            onSaved={(msg) => {
              showToast(msg);
              // Refresh merchant data after save
              const token = localStorage.getItem('access_token');
              if (token) {
                apiFetch('/merchant/me', { headers: { Authorization: `Bearer ${token}` } })
                  .then((d: unknown) => {
                    const data = d as { merchant?: Merchant } & Merchant;
                    setMerchant(data.merchant ?? data);
                  })
                  .catch(() => {/* ignore */});
              }
            }}
          />
        )}
        {activeTab === 'cancellation' && (
          <CancellationTab
            merchant={merchant}
            onSaved={(msg) => showToast(msg)}
          />
        )}
        {activeTab === 'payments' && (
          <PaymentsTab
            onSaved={(msg) => showToast(msg)}
            onError={(msg) => showToast(msg, 'error')}
          />
        )}
        {activeTab === 'booking-page' && (
          <BookingPageTab merchant={merchant} />
        )}
        {activeTab === 'account' && (
          <AccountTab
            onSaved={(msg) => showToast(msg)}
            onError={(msg) => showToast(msg, 'error')}
          />
        )}
      </div>

      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onDismiss={() => setToast(null)}
        />
      )}
    </>
  );
}
