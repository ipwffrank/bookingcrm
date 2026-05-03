'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { apiFetch } from '../lib/api';

type FormData = {
  name: string;
  email: string;
  phone: string;
  password: string;
  salon_name: string;
  salon_category: string;
  country: 'SG' | 'MY';
};

type FieldError = Partial<Record<keyof FormData, string>>;

// Clinical categories (the second group below) imply a clinical `vertical`
// on the merchant record — set server-side in /auth/signup so dental
// odontogram, aesthetic charting etc. light up from day one without a
// post-signup settings round-trip. Non-clinical categories leave
// vertical = NULL.
const CATEGORIES: Array<{ value: string; label: string; group: 'service' | 'clinical' | 'other' }> = [
  // Service businesses (no clinical vertical)
  { value: 'hair_salon', label: 'Hair Salon / Barbershop', group: 'service' },
  { value: 'nail_studio', label: 'Nail Studio', group: 'service' },
  { value: 'beauty_salon', label: 'Beauty / Facial Salon', group: 'service' },
  { value: 'massage', label: 'Massage / Physiotherapy', group: 'service' },
  { value: 'spa', label: 'Spa / Wellness Centre', group: 'service' },
  { value: 'restaurant', label: 'Restaurant / F&B', group: 'service' },
  // Clinical businesses (each implies a vertical)
  { value: 'aesthetic_clinic', label: 'Aesthetic Clinic', group: 'clinical' },
  { value: 'dermatology_clinic', label: 'Dermatology Clinic', group: 'clinical' },
  { value: 'dental_clinic', label: 'Dental Clinic', group: 'clinical' },
  { value: 'medical_gp', label: 'Medical / GP Clinic', group: 'clinical' },
  // Catch-all
  { value: 'other', label: 'Other', group: 'other' },
];

export default function SignupPage() {
  const router = useRouter();
  const [form, setForm] = useState<FormData>({
    name: '',
    email: '',
    phone: '',
    password: '',
    salon_name: '',
    salon_category: '',
    country: 'SG',
  });
  const [errors, setErrors] = useState<FieldError>({});
  const [apiError, setApiError] = useState('');
  const [loading, setLoading] = useState(false);

  function validate(): boolean {
    const next: FieldError = {};
    if (!form.name.trim()) next.name = 'Full name is required';
    if (!form.email.trim()) next.email = 'Email is required';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) next.email = 'Invalid email address';
    if (!form.phone.trim()) next.phone = 'Mobile number is required';
    if (!form.password) next.password = 'Password is required';
    else if (form.password.length < 8) next.password = 'Password must be at least 8 characters';
    if (!form.salon_name.trim()) next.salon_name = 'Business name is required';
    if (!form.salon_category) next.salon_category = 'Please select a category';
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setApiError('');
    if (!validate()) return;
    setLoading(true);
    try {
      const data = await apiFetch('/auth/signup', {
        method: 'POST',
        body: JSON.stringify(form),
      });
      localStorage.setItem('access_token', data.access_token);
      localStorage.setItem('refresh_token', data.refresh_token);
      localStorage.setItem('user', JSON.stringify(data.user));
      localStorage.setItem('merchant', JSON.stringify(data.merchant));
      router.push('/onboarding');
    } catch (err) {
      setApiError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  function field(key: keyof FormData, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
    if (errors[key]) setErrors((prev) => ({ ...prev, [key]: undefined }));
  }

  return (
    <div className="min-h-screen bg-tone-surface-warm flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <Link href="/" className="text-2xl font-bold text-tone-sage">
            GlowOS
          </Link>
          <h1 className="text-2xl font-bold text-tone-ink mt-4 mb-2">Get started with GlowOS</h1>
          <p className="text-grey-60 text-sm">14-day free trial. No credit card required.</p>
        </div>

        <div className="bg-tone-surface rounded-2xl shadow-xl shadow-gray-100 border border-grey-5 p-8">
          {apiError && (
            <div className="mb-4 rounded-lg bg-semantic-danger/5 border border-semantic-danger/30 px-4 py-3 text-sm text-semantic-danger">
              {apiError}
            </div>
          )}

          <form onSubmit={handleSubmit} noValidate className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-grey-75 mb-1">Full name</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => field('name', e.target.value)}
                className={`w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-tone-sage transition ${
                  errors.name ? 'border-red-400 bg-semantic-danger/5' : 'border-grey-30'
                }`}
                placeholder="Jane Tan"
              />
              {errors.name && <p className="text-xs text-semantic-danger mt-1">{errors.name}</p>}
            </div>

            <div>
              <label className="block text-sm font-medium text-grey-75 mb-1">Email</label>
              <input
                type="email"
                value={form.email}
                onChange={(e) => field('email', e.target.value)}
                className={`w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-tone-sage transition ${
                  errors.email ? 'border-red-400 bg-semantic-danger/5' : 'border-grey-30'
                }`}
                placeholder="jane@mybusiness.com"
              />
              {errors.email && <p className="text-xs text-semantic-danger mt-1">{errors.email}</p>}
            </div>

            <div>
              <label className="block text-sm font-medium text-grey-75 mb-1">Mobile number</label>
              <input
                type="tel"
                value={form.phone}
                onChange={(e) => field('phone', e.target.value)}
                className={`w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-tone-sage transition ${
                  errors.phone ? 'border-red-400 bg-semantic-danger/5' : 'border-grey-30'
                }`}
                placeholder="+65 9123 4567"
              />
              {errors.phone && <p className="text-xs text-semantic-danger mt-1">{errors.phone}</p>}
            </div>

            <div>
              <label className="block text-sm font-medium text-grey-75 mb-1">Password</label>
              <input
                type="password"
                value={form.password}
                onChange={(e) => field('password', e.target.value)}
                className={`w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-tone-sage transition ${
                  errors.password ? 'border-red-400 bg-semantic-danger/5' : 'border-grey-30'
                }`}
                placeholder="Min. 8 characters"
              />
              {errors.password && <p className="text-xs text-semantic-danger mt-1">{errors.password}</p>}
            </div>

            <div>
              <label className="block text-sm font-medium text-grey-75 mb-1">Business name</label>
              <input
                type="text"
                value={form.salon_name}
                onChange={(e) => field('salon_name', e.target.value)}
                className={`w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-tone-sage transition ${
                  errors.salon_name ? 'border-red-400 bg-semantic-danger/5' : 'border-grey-30'
                }`}
                placeholder="e.g. Glow Wellness, Ristorante Sole"
              />
              {errors.salon_name && (
                <p className="text-xs text-semantic-danger mt-1">{errors.salon_name}</p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-grey-75 mb-1">
                Business category
              </label>
              <select
                value={form.salon_category}
                onChange={(e) => field('salon_category', e.target.value)}
                className={`w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-tone-sage transition ${
                  errors.salon_category ? 'border-red-400 bg-semantic-danger/5' : 'border-grey-30'
                }`}
              >
                <option value="">Select a category…</option>
                <optgroup label="Service businesses">
                  {CATEGORIES.filter((c) => c.group === 'service').map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="Clinical">
                  {CATEGORIES.filter((c) => c.group === 'clinical').map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </optgroup>
                {CATEGORIES.filter((c) => c.group === 'other').map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
              {errors.salon_category && (
                <p className="text-xs text-semantic-danger mt-1">{errors.salon_category}</p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-grey-75 mb-1">
                Country
              </label>
              <select
                value={form.country}
                onChange={(e) => setForm((prev) => ({ ...prev, country: e.target.value as 'SG' | 'MY' }))}
                className="w-full rounded-lg border border-grey-30 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-tone-sage transition"
              >
                <option value="SG">Singapore (SG)</option>
                <option value="MY">Malaysia (MY)</option>
              </select>
              <p className="text-xs text-grey-60 mt-1">
                Determines default payment gateway, currency, and timezone.
                MY merchants default to iPay88; SG merchants default to Stripe.
              </p>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-xl bg-tone-ink py-3 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed transition-colors mt-2"
            >
              {loading ? 'Creating account…' : 'Create account'}
            </button>
          </form>

          <p className="text-center text-sm text-grey-60 mt-6">
            Already have an account?{' '}
            <Link
              href="/login"
              className="text-tone-sage font-medium hover:underline"
            >
              Log in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
