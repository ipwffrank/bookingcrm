'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch, ApiError } from '../../lib/api';

interface ServiceOption {
  id: string;
  name: string;
  durationMinutes: number;
  priceSgd: string;
}

interface StaffOption {
  id: string;
  name: string;
  title: string | null;
}

interface WalkinForm {
  client_name: string;
  client_phone: string;
  client_email: string;
  service_id: string;
  staff_id: string;
  payment_method: 'cash' | 'otc' | 'stripe';
  notes: string;
}

export default function WalkinsPage() {
  const router = useRouter();
  const [services, setServices] = useState<ServiceOption[]>([]);
  const [staff, setStaff] = useState<StaffOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const emptyForm: WalkinForm = {
    client_name: '',
    client_phone: '',
    client_email: '',
    service_id: '',
    staff_id: '',
    payment_method: 'cash',
    notes: '',
  };

  const [form, setForm] = useState<WalkinForm>(emptyForm);

  const loadOptions = useCallback(async () => {
    try {
      const [svcRes, staffRes] = await Promise.all([
        apiFetch('/merchant/services?active=true'),
        apiFetch('/merchant/staff'),
      ]);
      setServices((svcRes as any).services ?? []);
      setStaff(((staffRes as any).staff ?? []).filter((s: any) => !s.isAnyAvailable));
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.push('/login');
      }
    }
  }, [router]);

  useEffect(() => {
    loadOptions();
  }, [loadOptions]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const startTime = new Date().toISOString();
      await apiFetch('/merchant/walkins/register', {
        method: 'POST',
        body: JSON.stringify({
          client_name: form.client_name,
          client_phone: form.client_phone,
          client_email: form.client_email || undefined,
          service_id: form.service_id,
          staff_id: form.staff_id,
          start_time: startTime,
          payment_method: form.payment_method,
          notes: form.notes || undefined,
        }),
      });

      setSuccess(`Walk-in registered for ${form.client_name}`);
      setForm(emptyForm);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        if (err.status === 401) router.push('/login');
      } else {
        setError('Failed to register walk-in');
      }
    } finally {
      setLoading(false);
    }
  }

  const selectedService = services.find((s) => s.id === form.service_id);

  return (
    <div className="max-w-lg mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-white">Walk-in Registration</h1>
        <p className="text-gray-400 text-sm mt-1">Register a walk-in client and record payment</p>
      </div>

      {success && (
        <div className="bg-green-900/30 border border-green-700 rounded-lg px-4 py-3 text-green-300 text-sm">
          {success}
        </div>
      )}
      {error && (
        <div className="bg-red-900/30 border border-red-700 rounded-lg px-4 py-3 text-red-300 text-sm">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Client Info */}
        <div className="bg-gray-800 rounded-lg p-4 space-y-3">
          <h2 className="text-sm font-medium text-gray-300 uppercase tracking-wide">Client</h2>
          <input
            type="text"
            value={form.client_name}
            onChange={(e) => setForm({ ...form, client_name: e.target.value })}
            placeholder="Full name *"
            required
            className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm"
          />
          <input
            type="tel"
            value={form.client_phone}
            onChange={(e) => setForm({ ...form, client_phone: e.target.value })}
            placeholder="Phone number * (used for profile)"
            required
            className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm"
          />
          <input
            type="email"
            value={form.client_email}
            onChange={(e) => setForm({ ...form, client_email: e.target.value })}
            placeholder="Email (optional)"
            className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm"
          />
        </div>

        {/* Appointment */}
        <div className="bg-gray-800 rounded-lg p-4 space-y-3">
          <h2 className="text-sm font-medium text-gray-300 uppercase tracking-wide">Appointment</h2>
          <select
            value={form.service_id}
            onChange={(e) => setForm({ ...form, service_id: e.target.value })}
            required
            className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm"
          >
            <option value="">Select service *</option>
            {services.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} — {s.durationMinutes}min — S${s.priceSgd}
              </option>
            ))}
          </select>
          <select
            value={form.staff_id}
            onChange={(e) => setForm({ ...form, staff_id: e.target.value })}
            required
            className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm"
          >
            <option value="">Select staff *</option>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}{s.title ? ` — ${s.title}` : ''}
              </option>
            ))}
          </select>
        </div>

        {/* Payment */}
        <div className="bg-gray-800 rounded-lg p-4 space-y-3">
          <h2 className="text-sm font-medium text-gray-300 uppercase tracking-wide">Payment</h2>
          <div className="flex gap-3">
            {(['cash', 'otc', 'stripe'] as const).map((method) => (
              <button
                key={method}
                type="button"
                onClick={() => setForm({ ...form, payment_method: method })}
                className={`flex-1 py-2 rounded-lg text-sm font-medium border transition-colors ${
                  form.payment_method === method
                    ? 'bg-amber-600 border-amber-500 text-white'
                    : 'bg-gray-700 border-gray-600 text-gray-300 hover:bg-gray-600'
                }`}
              >
                {method === 'cash' ? 'Cash' : method === 'otc' ? 'OTC / Terminal' : 'Card (Stripe)'}
              </button>
            ))}
          </div>
          {selectedService && (
            <p className="text-sm text-gray-400">
              Amount: <span className="text-white font-medium">S${selectedService.priceSgd}</span>
            </p>
          )}
        </div>

        {/* Notes */}
        <textarea
          value={form.notes}
          onChange={(e) => setForm({ ...form, notes: e.target.value })}
          placeholder="Notes (optional)"
          rows={2}
          className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm"
        />

        <button
          type="submit"
          disabled={loading}
          className="w-full py-3 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white font-medium rounded-lg transition-colors"
        >
          {loading ? 'Registering...' : 'Register Walk-in'}
        </button>
      </form>
    </div>
  );
}
