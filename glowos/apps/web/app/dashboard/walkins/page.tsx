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

const PAYMENT_OPTIONS: { value: WalkinForm['payment_method']; label: string; icon: string }[] = [
  { value: 'cash',   label: 'Cash',         icon: '💵' },
  { value: 'otc',    label: 'OTC / Terminal', icon: '🖨️' },
  { value: 'stripe', label: 'Card (Stripe)', icon: '💳' },
];

export default function WalkinsPage() {
  const router = useRouter();
  const [services, setServices] = useState<ServiceOption[]>([]);
  const [staff, setStaff]       = useState<StaffOption[]>([]);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [success, setSuccess]   = useState<string | null>(null);

  const emptyForm: WalkinForm = {
    client_name: '', client_phone: '', client_email: '',
    service_id: '', staff_id: '', payment_method: 'cash', notes: '',
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
      if (err instanceof ApiError && err.status === 401) router.push('/login');
    }
  }, [router]);

  useEffect(() => { loadOptions(); }, [loadOptions]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      await apiFetch('/merchant/walkins/register', {
        method: 'POST',
        body: JSON.stringify({
          client_name:    form.client_name,
          client_phone:   form.client_phone,
          client_email:   form.client_email || undefined,
          service_id:     form.service_id,
          staff_id:       form.staff_id,
          start_time:     new Date().toISOString(),
          payment_method: form.payment_method,
          notes:          form.notes || undefined,
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

  const selectedService = services.find(s => s.id === form.service_id);

  return (
    <div className="max-w-xl mx-auto space-y-6 font-manrope">

      {/* ── Header ── */}
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Walk-in Registration</h1>
        <p className="text-xs text-gray-400 mt-0.5">Register a walk-in client and record the appointment</p>
      </div>

      {/* ── Alerts ── */}
      {success && (
        <div className="flex items-center gap-3 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3">
          <svg className="w-4 h-4 text-emerald-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="text-sm font-medium text-emerald-700">{success}</p>
        </div>
      )}
      {error && (
        <div className="flex items-center gap-3 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
          <svg className="w-4 h-4 text-red-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126z" />
          </svg>
          <p className="text-sm font-medium text-red-700">{error}</p>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">

        {/* ── Client ── */}
        <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
          <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Client</h2>
          <input
            type="text"
            value={form.client_name}
            onChange={e => setForm({ ...form, client_name: e.target.value })}
            placeholder="Full name *"
            required
            className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-[#1a2313]/30 transition"
          />
          <input
            type="tel"
            value={form.client_phone}
            onChange={e => setForm({ ...form, client_phone: e.target.value })}
            placeholder="Phone number * (used for client profile)"
            required
            className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-[#1a2313]/30 transition"
          />
          <input
            type="email"
            value={form.client_email}
            onChange={e => setForm({ ...form, client_email: e.target.value })}
            placeholder="Email (optional)"
            className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-[#1a2313]/30 transition"
          />
        </div>

        {/* ── Appointment ── */}
        <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
          <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Appointment</h2>
          <select
            value={form.service_id}
            onChange={e => setForm({ ...form, service_id: e.target.value })}
            required
            className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-[#1a2313]/30 transition bg-white"
          >
            <option value="">Select service *</option>
            {services.map(s => (
              <option key={s.id} value={s.id}>
                {s.name} — {s.durationMinutes} min — S${s.priceSgd}
              </option>
            ))}
          </select>
          <select
            value={form.staff_id}
            onChange={e => setForm({ ...form, staff_id: e.target.value })}
            required
            className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-[#1a2313]/30 transition bg-white"
          >
            <option value="">Select staff *</option>
            {staff.map(s => (
              <option key={s.id} value={s.id}>
                {s.name}{s.title ? ` — ${s.title}` : ''}
              </option>
            ))}
          </select>

          {/* Service summary pill */}
          {selectedService && (
            <div className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2 mt-1">
              <span className="text-xs text-gray-500">{selectedService.durationMinutes} min session</span>
              <span className="text-sm font-semibold text-gray-900">S${selectedService.priceSgd}</span>
            </div>
          )}
        </div>

        {/* ── Payment ── */}
        <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
          <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Payment method</h2>
          <div className="grid grid-cols-3 gap-2">
            {PAYMENT_OPTIONS.map(({ value, label }) => (
              <button
                key={value}
                type="button"
                onClick={() => setForm({ ...form, payment_method: value })}
                className={`py-2.5 px-2 rounded-lg text-sm font-medium border transition-all ${
                  form.payment_method === value
                    ? 'bg-[#1a2313] border-[#1a2313] text-white shadow-sm'
                    : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* ── Notes ── */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Notes</h2>
          <textarea
            value={form.notes}
            onChange={e => setForm({ ...form, notes: e.target.value })}
            placeholder="Any notes about this visit (optional)"
            rows={3}
            className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-[#1a2313]/30 transition resize-none"
          />
        </div>

        {/* ── Submit ── */}
        <button
          type="submit"
          disabled={loading}
          className="w-full py-3 bg-[#1a2313] hover:bg-[#2f3827] disabled:opacity-50 text-white font-semibold rounded-xl transition-colors text-sm"
        >
          {loading ? 'Registering…' : 'Register Walk-in'}
        </button>
      </form>
    </div>
  );
}
