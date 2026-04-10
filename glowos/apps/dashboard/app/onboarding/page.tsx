'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch } from '../lib/api';
import { useAuth } from '../lib/auth';

const TOTAL_STEPS = 5;

interface ServiceForm {
  name: string;
  description: string;
  category: string;
  duration_minutes: number;
  price_sgd: number;
}

interface StaffForm {
  name: string;
  title: string;
}

export default function OnboardingPage() {
  const router = useRouter();
  const { merchant } = useAuth();
  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Step 1: Business Profile
  const [profile, setProfile] = useState({
    name: merchant?.name ?? '',
    phone: '',
    address_line1: '',
    description: '',
    hours: { open: '09:00', close: '20:00' },
  });

  // Step 2: Services
  const [services, setServices] = useState<ServiceForm[]>([
    { name: '', description: '', category: 'hair', duration_minutes: 60, price_sgd: 0 },
  ]);

  // Step 3: Staff
  const [staffList, setStaffList] = useState<StaffForm[]>([{ name: '', title: '' }]);

  // Step 5: Cancellation Policy
  const [policy, setPolicy] = useState({
    hours_for_full_refund: 24,
    hours_for_partial_refund: 12,
    partial_refund_percentage: 50,
  });

  async function saveStep1() {
    await apiFetch('/merchant/me', {
      method: 'PUT',
      body: JSON.stringify({
        name: profile.name,
        phone: profile.phone,
        address_line1: profile.address_line1,
        description: profile.description,
      }),
    });
  }

  async function saveStep2() {
    for (const svc of services) {
      if (!svc.name.trim()) continue;
      await apiFetch('/merchant/services', {
        method: 'POST',
        body: JSON.stringify(svc),
      });
    }
  }

  async function saveStep3() {
    for (const s of staffList) {
      if (!s.name.trim()) continue;
      await apiFetch('/merchant/staff', {
        method: 'POST',
        body: JSON.stringify(s),
      });
    }
  }

  async function saveStep5() {
    await apiFetch('/merchant/me', {
      method: 'PUT',
      body: JSON.stringify({ cancellation_policy: policy }),
    });
  }

  async function handleNext() {
    setSaving(true);
    setError('');
    try {
      if (step === 1) await saveStep1();
      if (step === 2) await saveStep2();
      if (step === 3) await saveStep3();
      if (step < TOTAL_STEPS) {
        setStep((s) => s + 1);
      } else {
        await saveStep5();
        await apiFetch('/merchant/onboarding/complete', { method: 'POST' });
        router.push('/dashboard');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setSaving(false);
    }
  }

  async function handleStripeConnect() {
    setSaving(true);
    try {
      const res = (await apiFetch('/merchant/payments/connect-account', {
        method: 'POST',
        body: JSON.stringify({ business_type: 'individual' }),
      })) as { onboarding_url: string };
      window.location.href = res.onboarding_url;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
      setSaving(false);
    }
  }

  const progressPct = ((step - 1) / (TOTAL_STEPS - 1)) * 100;

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-purple-50">
      {/* Progress bar */}
      <div className="fixed top-0 inset-x-0 z-10 bg-white border-b border-gray-100 px-6 py-4">
        <div className="max-w-lg mx-auto">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-gray-700">Setup your salon</span>
            <span className="text-sm text-gray-400">
              Step {step} of {TOTAL_STEPS}
            </span>
          </div>
          <div className="w-full bg-gray-100 rounded-full h-1.5">
            <div
              className="bg-indigo-600 h-1.5 rounded-full transition-all duration-500"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
      </div>

      <div className="pt-24 pb-12 px-4">
        <div className="max-w-lg mx-auto">
          {error && (
            <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-600">
              {error}
            </div>
          )}

          {/* Step 1: Business Profile */}
          {step === 1 && (
            <div className="bg-white rounded-2xl shadow-xl border border-gray-100 p-8">
              <h2 className="text-xl font-bold text-gray-900 mb-1">Business Profile</h2>
              <p className="text-sm text-gray-500 mb-6">Tell us about your salon</p>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Salon name *
                  </label>
                  <input
                    value={profile.name}
                    onChange={(e) => setProfile((p) => ({ ...p, name: e.target.value }))}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
                  <input
                    type="tel"
                    value={profile.phone}
                    onChange={(e) => setProfile((p) => ({ ...p, phone: e.target.value }))}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                    placeholder="+65 6123 4567"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Address</label>
                  <input
                    value={profile.address_line1}
                    onChange={(e) => setProfile((p) => ({ ...p, address_line1: e.target.value }))}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                    placeholder="123 Orchard Road, #01-01"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Description
                  </label>
                  <textarea
                    value={profile.description}
                    onChange={(e) => setProfile((p) => ({ ...p, description: e.target.value }))}
                    rows={3}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
                    placeholder="Tell clients about your salon…"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Opening time
                    </label>
                    <input
                      type="time"
                      value={profile.hours.open}
                      onChange={(e) =>
                        setProfile((p) => ({ ...p, hours: { ...p.hours, open: e.target.value } }))
                      }
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Closing time
                    </label>
                    <input
                      type="time"
                      value={profile.hours.close}
                      onChange={(e) =>
                        setProfile((p) => ({ ...p, hours: { ...p.hours, close: e.target.value } }))
                      }
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Step 2: Services */}
          {step === 2 && (
            <div className="bg-white rounded-2xl shadow-xl border border-gray-100 p-8">
              <h2 className="text-xl font-bold text-gray-900 mb-1">Add Your Services</h2>
              <p className="text-sm text-gray-500 mb-6">
                Add the services you offer to clients
              </p>
              <div className="space-y-4">
                {services.map((svc, idx) => (
                  <div
                    key={idx}
                    className="rounded-xl border border-gray-200 p-4 space-y-3"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-gray-700">
                        Service {idx + 1}
                      </span>
                      {services.length > 1 && (
                        <button
                          onClick={() =>
                            setServices((prev) => prev.filter((_, i) => i !== idx))
                          }
                          className="text-xs text-red-500 hover:underline"
                        >
                          Remove
                        </button>
                      )}
                    </div>
                    <input
                      value={svc.name}
                      onChange={(e) =>
                        setServices((prev) =>
                          prev.map((s, i) => (i === idx ? { ...s, name: e.target.value } : s))
                        )
                      }
                      placeholder="Service name *"
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        type="number"
                        value={svc.duration_minutes}
                        onChange={(e) =>
                          setServices((prev) =>
                            prev.map((s, i) =>
                              i === idx
                                ? { ...s, duration_minutes: parseInt(e.target.value) || 0 }
                                : s
                            )
                          )
                        }
                        placeholder="Duration (min)"
                        className="rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                      <input
                        type="number"
                        step="0.01"
                        value={svc.price_sgd}
                        onChange={(e) =>
                          setServices((prev) =>
                            prev.map((s, i) =>
                              i === idx
                                ? { ...s, price_sgd: parseFloat(e.target.value) || 0 }
                                : s
                            )
                          )
                        }
                        placeholder="Price (SGD)"
                        className="rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>
                    <select
                      value={svc.category}
                      onChange={(e) =>
                        setServices((prev) =>
                          prev.map((s, i) =>
                            i === idx ? { ...s, category: e.target.value } : s
                          )
                        )
                      }
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                    >
                      {['hair', 'nails', 'face', 'body', 'massage', 'other'].map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
                <button
                  onClick={() =>
                    setServices((prev) => [
                      ...prev,
                      {
                        name: '',
                        description: '',
                        category: 'hair',
                        duration_minutes: 60,
                        price_sgd: 0,
                      },
                    ])
                  }
                  className="w-full rounded-xl border-2 border-dashed border-gray-200 py-3 text-sm font-medium text-gray-500 hover:border-indigo-300 hover:text-indigo-600 transition-colors"
                >
                  + Add Another Service
                </button>
              </div>
            </div>
          )}

          {/* Step 3: Staff */}
          {step === 3 && (
            <div className="bg-white rounded-2xl shadow-xl border border-gray-100 p-8">
              <h2 className="text-xl font-bold text-gray-900 mb-1">Add Your Staff</h2>
              <p className="text-sm text-gray-500 mb-6">Who will be performing services?</p>
              <div className="space-y-4">
                {staffList.map((s, idx) => (
                  <div key={idx} className="rounded-xl border border-gray-200 p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-gray-700">
                        Staff member {idx + 1}
                      </span>
                      {staffList.length > 1 && (
                        <button
                          onClick={() =>
                            setStaffList((prev) => prev.filter((_, i) => i !== idx))
                          }
                          className="text-xs text-red-500 hover:underline"
                        >
                          Remove
                        </button>
                      )}
                    </div>
                    <input
                      value={s.name}
                      onChange={(e) =>
                        setStaffList((prev) =>
                          prev.map((st, i) =>
                            i === idx ? { ...st, name: e.target.value } : st
                          )
                        )
                      }
                      placeholder="Name *"
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                    <input
                      value={s.title}
                      onChange={(e) =>
                        setStaffList((prev) =>
                          prev.map((st, i) =>
                            i === idx ? { ...st, title: e.target.value } : st
                          )
                        )
                      }
                      placeholder="Title (e.g. Senior Stylist)"
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                ))}
                <button
                  onClick={() => setStaffList((prev) => [...prev, { name: '', title: '' }])}
                  className="w-full rounded-xl border-2 border-dashed border-gray-200 py-3 text-sm font-medium text-gray-500 hover:border-indigo-300 hover:text-indigo-600 transition-colors"
                >
                  + Add Another Staff Member
                </button>
              </div>
            </div>
          )}

          {/* Step 4: Payment Setup */}
          {step === 4 && (
            <div className="bg-white rounded-2xl shadow-xl border border-gray-100 p-8">
              <h2 className="text-xl font-bold text-gray-900 mb-1">Payment Setup</h2>
              <p className="text-sm text-gray-500 mb-6">
                Connect your Stripe account to accept online payments
              </p>
              <div className="rounded-xl bg-indigo-50 border border-indigo-100 p-5 mb-6">
                <div className="text-sm font-medium text-indigo-800 mb-2">
                  Why connect Stripe?
                </div>
                <ul className="text-sm text-indigo-700 space-y-1.5">
                  <li>✓ Accept card payments, PayNow &amp; GrabPay</li>
                  <li>✓ Automatic payouts to your bank account</li>
                  <li>✓ Secure, PCI-compliant payment processing</li>
                </ul>
              </div>
              <button
                onClick={handleStripeConnect}
                disabled={saving}
                className="w-full rounded-xl bg-indigo-600 py-3 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60 transition-colors mb-3"
              >
                {saving ? 'Redirecting to Stripe…' : 'Connect with Stripe →'}
              </button>
              <button
                onClick={() => setStep(5)}
                className="w-full rounded-xl border border-gray-200 py-3 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors"
              >
                Skip for now
              </button>
            </div>
          )}

          {/* Step 5: Cancellation Policy */}
          {step === 5 && (
            <div className="bg-white rounded-2xl shadow-xl border border-gray-100 p-8">
              <h2 className="text-xl font-bold text-gray-900 mb-1">Cancellation Policy</h2>
              <p className="text-sm text-gray-500 mb-6">
                Set your refund rules for client cancellations
              </p>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Full refund window
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      value={policy.hours_for_full_refund}
                      onChange={(e) =>
                        setPolicy((p) => ({
                          ...p,
                          hours_for_full_refund: parseInt(e.target.value) || 0,
                        }))
                      }
                      className="w-24 rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                    <span className="text-sm text-gray-500">hours before appointment</span>
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Partial refund window
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      value={policy.hours_for_partial_refund}
                      onChange={(e) =>
                        setPolicy((p) => ({
                          ...p,
                          hours_for_partial_refund: parseInt(e.target.value) || 0,
                        }))
                      }
                      className="w-24 rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                    <span className="text-sm text-gray-500">hours before appointment</span>
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Partial refund percentage
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={policy.partial_refund_percentage}
                      onChange={(e) =>
                        setPolicy((p) => ({
                          ...p,
                          partial_refund_percentage: parseInt(e.target.value) || 0,
                        }))
                      }
                      className="w-24 rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                    <span className="text-sm text-gray-500">% refunded</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Navigation */}
          <div className="flex justify-between gap-3 mt-6">
            {step > 1 && step !== 4 && (
              <button
                onClick={() => setStep((s) => s - 1)}
                disabled={saving}
                className="flex-1 rounded-xl border border-gray-200 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
              >
                ← Back
              </button>
            )}
            {step !== 4 && (
              <button
                onClick={handleNext}
                disabled={saving}
                className="flex-1 rounded-xl bg-indigo-600 py-3 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60 transition-colors"
              >
                {saving
                  ? 'Saving…'
                  : step === TOTAL_STEPS
                  ? 'Finish Setup →'
                  : 'Next →'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
