'use client';

import { useState, useEffect } from 'react';
import { apiFetch } from '../lib/api';

interface ServiceItem {
  id: string;
  name: string;
  durationMinutes: number;
  priceSgd: string;
}

interface StaffItem {
  id: string;
  name: string;
}

interface WalkInModalProps {
  onClose: () => void;
  onSuccess: () => void;
}

export default function WalkInModal({ onClose, onSuccess }: WalkInModalProps) {
  const [services, setServices] = useState<ServiceItem[]>([]);
  const [staff, setStaff] = useState<StaffItem[]>([]);
  const [form, setForm] = useState({
    service_id: '',
    staff_id: '',
    client_name: '',
    client_phone: '',
    start_time: new Date().toISOString().slice(0, 16),
    notes: '',
    payment_method: 'cash',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    async function load() {
      try {
        const [svcRes, staffRes] = await Promise.all([
          apiFetch('/merchant/services?active=true') as Promise<{ services: ServiceItem[] }>,
          apiFetch('/merchant/staff') as Promise<{ staff: StaffItem[] }>,
        ]);
        setServices(svcRes.services);
        setStaff(staffRes.staff);
      } catch {
        setError('Failed to load services or staff');
      }
    }
    void load();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.service_id || !form.staff_id || !form.client_name || !form.client_phone) {
      setError('Please fill in all required fields');
      return;
    }
    setLoading(true);
    setError('');
    try {
      await apiFetch('/booking/merchant', {
        method: 'POST',
        body: JSON.stringify({
          ...form,
          start_time: new Date(form.start_time).toISOString(),
        }),
      });
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create booking');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-lg font-semibold text-gray-900">Add Walk-in Booking</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-4 space-y-4">
          {error && (
            <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-600">
              {error}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2 sm:col-span-1">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Client name *
              </label>
              <input
                type="text"
                value={form.client_name}
                onChange={(e) => setForm((p) => ({ ...p, client_name: e.target.value }))}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                placeholder="Jane Tan"
              />
            </div>
            <div className="col-span-2 sm:col-span-1">
              <label className="block text-sm font-medium text-gray-700 mb-1">Phone *</label>
              <input
                type="tel"
                value={form.client_phone}
                onChange={(e) => setForm((p) => ({ ...p, client_phone: e.target.value }))}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                placeholder="+65 9123 4567"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Service *</label>
            <select
              value={form.service_id}
              onChange={(e) => setForm((p) => ({ ...p, service_id: e.target.value }))}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="">Select service…</option>
              {services.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} — {s.durationMinutes}min — SGD {parseFloat(s.priceSgd).toFixed(2)}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Staff *</label>
            <select
              value={form.staff_id}
              onChange={(e) => setForm((p) => ({ ...p, staff_id: e.target.value }))}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="">Select staff…</option>
              {staff.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Start time *</label>
            <input
              type="datetime-local"
              value={form.start_time}
              onChange={(e) => setForm((p) => ({ ...p, start_time: e.target.value }))}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Payment method
            </label>
            <select
              value={form.payment_method}
              onChange={(e) => setForm((p) => ({ ...p, payment_method: e.target.value }))}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="cash">Cash</option>
              <option value="card">Card</option>
              <option value="paynow">PayNow</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
            <textarea
              value={form.notes}
              onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))}
              rows={2}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
              placeholder="Any special requests…"
            />
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-xl border border-gray-200 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 rounded-xl bg-indigo-600 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60 transition-colors"
            >
              {loading ? 'Saving…' : 'Add Booking'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
