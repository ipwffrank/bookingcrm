'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';
import DashboardShell from '../components/DashboardShell';
import { useAuth } from '../lib/auth';

interface ServiceItem {
  id: string;
  name: string;
  category: string;
  durationMinutes: number;
  priceSgd: string;
  isActive: boolean;
}

interface StaffItem {
  id: string;
  name: string;
  title: string | null;
  isActive: boolean;
}

interface StripeStatus {
  connected: boolean;
  charges_enabled: boolean;
  payouts_enabled: boolean;
  details_submitted: boolean;
}

type ActiveSection = 'profile' | 'services' | 'staff' | 'cancellation' | 'payments';

export default function SettingsPage() {
  const { merchant } = useAuth();
  const [activeSection, setActiveSection] = useState<ActiveSection>('profile');

  const SECTIONS: { id: ActiveSection; label: string; icon: string }[] = [
    { id: 'profile', label: 'Business Profile', icon: '🏢' },
    { id: 'services', label: 'Services', icon: '✂️' },
    { id: 'staff', label: 'Staff', icon: '👤' },
    { id: 'cancellation', label: 'Cancellation Policy', icon: '📋' },
    { id: 'payments', label: 'Payments', icon: '💳' },
  ];

  return (
    <DashboardShell>
      <div className="max-w-5xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
          <p className="text-gray-500 text-sm mt-0.5">Manage your salon configuration</p>
        </div>

        <div className="flex flex-col sm:flex-row gap-6">
          {/* Nav */}
          <div className="sm:w-48 shrink-0">
            <nav className="space-y-1">
              {SECTIONS.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setActiveSection(s.id)}
                  className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-medium text-left transition-colors ${
                    activeSection === s.id
                      ? 'bg-indigo-50 text-indigo-700'
                      : 'text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  <span>{s.icon}</span>
                  {s.label}
                </button>
              ))}
            </nav>
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0">
            {activeSection === 'profile' && <ProfileSection />}
            {activeSection === 'services' && <ServicesSection />}
            {activeSection === 'staff' && <StaffSection />}
            {activeSection === 'cancellation' && <CancellationSection />}
            {activeSection === 'payments' && <PaymentsSection />}
          </div>
        </div>
      </div>
    </DashboardShell>
  );
}

// ── Profile Section ───────────────────────────────────────────────────────────

function ProfileSection() {
  const { merchant } = useAuth();
  const [form, setForm] = useState({
    name: merchant?.name ?? '',
    phone: '',
    address_line1: '',
    description: '',
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await apiFetch('/merchant/me', { method: 'PUT', body: JSON.stringify(form) });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      alert('Failed to save');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
      <h2 className="text-base font-semibold text-gray-900 mb-4">Business Profile</h2>
      <form onSubmit={save} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Salon name</label>
          <input
            value={form.name}
            onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
          <input
            value={form.phone}
            onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Address</label>
          <input
            value={form.address_line1}
            onChange={(e) => setForm((p) => ({ ...p, address_line1: e.target.value }))}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
          <textarea
            value={form.description}
            onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
            rows={3}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
          />
        </div>
        <button
          type="submit"
          disabled={saving}
          className="rounded-xl bg-indigo-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60 transition-colors"
        >
          {saved ? '✓ Saved' : saving ? 'Saving…' : 'Save Changes'}
        </button>
      </form>
    </div>
  );
}

// ── Services Section ──────────────────────────────────────────────────────────

function ServicesSection() {
  const [services, setServices] = useState<ServiceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: '',
    description: '',
    category: 'hair',
    duration_minutes: 60,
    price_sgd: 0,
    buffer_minutes: 0,
  });

  async function load() {
    setLoading(true);
    try {
      const res = (await apiFetch('/merchant/services')) as { services: ServiceItem[] };
      setServices(res.services);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  function startEdit(svc: ServiceItem) {
    setEditId(svc.id);
    setForm({
      name: svc.name,
      description: '',
      category: svc.category,
      duration_minutes: svc.durationMinutes,
      price_sgd: parseFloat(svc.priceSgd),
      buffer_minutes: 0,
    });
    setShowForm(true);
  }

  async function saveService(e: React.FormEvent) {
    e.preventDefault();
    try {
      if (editId) {
        await apiFetch(`/merchant/services/${editId}`, {
          method: 'PUT',
          body: JSON.stringify(form),
        });
      } else {
        await apiFetch('/merchant/services', {
          method: 'POST',
          body: JSON.stringify(form),
        });
      }
      setShowForm(false);
      setEditId(null);
      await load();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to save');
    }
  }

  async function deleteService(id: string) {
    if (!confirm('Deactivate this service?')) return;
    try {
      await apiFetch(`/merchant/services/${id}`, { method: 'DELETE' });
      await load();
    } catch {
      alert('Failed to delete');
    }
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-50">
        <h2 className="text-base font-semibold text-gray-900">Services</h2>
        <button
          onClick={() => {
            setEditId(null);
            setForm({ name: '', description: '', category: 'hair', duration_minutes: 60, price_sgd: 0, buffer_minutes: 0 });
            setShowForm(true);
          }}
          className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 transition-colors"
        >
          + Add Service
        </button>
      </div>

      {showForm && (
        <form onSubmit={saveService} className="px-6 py-4 bg-gray-50 border-b border-gray-100 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="block text-xs font-medium text-gray-600 mb-1">Name *</label>
              <input
                value={form.name}
                onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                required
                className="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Category</label>
              <select
                value={form.category}
                onChange={(e) => setForm((p) => ({ ...p, category: e.target.value }))}
                className="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
              >
                {['hair', 'nails', 'face', 'body', 'massage', 'other'].map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Duration (min)</label>
              <input
                type="number"
                value={form.duration_minutes}
                onChange={(e) => setForm((p) => ({ ...p, duration_minutes: parseInt(e.target.value) || 0 }))}
                className="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Price (SGD)</label>
              <input
                type="number"
                step="0.01"
                value={form.price_sgd}
                onChange={(e) => setForm((p) => ({ ...p, price_sgd: parseFloat(e.target.value) || 0 }))}
                className="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Description</label>
              <input
                value={form.description}
                onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
                className="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="rounded-lg border border-gray-200 px-4 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-100"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="rounded-lg bg-indigo-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700"
            >
              Save
            </button>
          </div>
        </form>
      )}

      {loading && (
        <div className="flex justify-center py-8">
          <div className="w-6 h-6 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin" />
        </div>
      )}

      {services.map((svc, idx) => (
        <div
          key={svc.id}
          className={`flex items-center gap-4 px-6 py-4 ${idx > 0 ? 'border-t border-gray-50' : ''}`}
        >
          <div className="flex-1">
            <div className="text-sm font-medium text-gray-900">{svc.name}</div>
            <div className="text-xs text-gray-500 mt-0.5">
              {svc.durationMinutes}min · SGD {parseFloat(svc.priceSgd).toFixed(2)} · {svc.category}
            </div>
          </div>
          <div className="flex gap-2 shrink-0">
            <button
              onClick={() => startEdit(svc)}
              className="text-xs text-indigo-600 hover:underline"
            >
              Edit
            </button>
            <button
              onClick={() => deleteService(svc.id)}
              className="text-xs text-red-500 hover:underline"
            >
              Delete
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Staff Section ─────────────────────────────────────────────────────────────

function StaffSection() {
  const [staffList, setStaffList] = useState<StaffItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', title: '' });

  async function load() {
    setLoading(true);
    try {
      const res = (await apiFetch('/merchant/staff')) as { staff: StaffItem[] };
      setStaffList(res.staff);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  async function saveStaff(e: React.FormEvent) {
    e.preventDefault();
    try {
      await apiFetch('/merchant/staff', {
        method: 'POST',
        body: JSON.stringify(form),
      });
      setShowForm(false);
      await load();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to save');
    }
  }

  async function deleteStaff(id: string) {
    if (!confirm('Deactivate this staff member?')) return;
    try {
      await apiFetch(`/merchant/staff/${id}`, { method: 'DELETE' });
      await load();
    } catch {
      alert('Failed');
    }
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-50">
        <h2 className="text-base font-semibold text-gray-900">Staff</h2>
        <button
          onClick={() => setShowForm(true)}
          className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 transition-colors"
        >
          + Add Staff
        </button>
      </div>

      {showForm && (
        <form onSubmit={saveStaff} className="px-6 py-4 bg-gray-50 border-b border-gray-100 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Name *</label>
              <input
                value={form.name}
                onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                required
                className="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Title</label>
              <input
                value={form.title}
                onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))}
                placeholder="Senior Stylist"
                className="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="rounded-lg border border-gray-200 px-4 py-1.5 text-xs font-medium text-gray-600"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="rounded-lg bg-indigo-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700"
            >
              Save
            </button>
          </div>
        </form>
      )}

      {loading && (
        <div className="flex justify-center py-8">
          <div className="w-6 h-6 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin" />
        </div>
      )}

      {staffList.map((s, idx) => (
        <div
          key={s.id}
          className={`flex items-center gap-4 px-6 py-4 ${idx > 0 ? 'border-t border-gray-50' : ''}`}
        >
          <div className="w-9 h-9 rounded-full bg-gradient-to-br from-indigo-300 to-purple-400 flex items-center justify-center text-white text-sm font-semibold shrink-0">
            {s.name.charAt(0)}
          </div>
          <div className="flex-1">
            <div className="text-sm font-medium text-gray-900">{s.name}</div>
            {s.title && <div className="text-xs text-gray-500">{s.title}</div>}
          </div>
          <button
            onClick={() => deleteStaff(s.id)}
            className="text-xs text-red-500 hover:underline shrink-0"
          >
            Remove
          </button>
        </div>
      ))}
    </div>
  );
}

// ── Cancellation Policy Section ───────────────────────────────────────────────

function CancellationSection() {
  const [form, setForm] = useState({
    hours_for_full_refund: 24,
    hours_for_partial_refund: 12,
    partial_refund_percentage: 50,
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await apiFetch('/merchant/me', {
        method: 'PUT',
        body: JSON.stringify({ cancellation_policy: form }),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      alert('Failed to save');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
      <h2 className="text-base font-semibold text-gray-900 mb-1">Cancellation Policy</h2>
      <p className="text-sm text-gray-500 mb-5">
        Configure when clients are eligible for refunds when they cancel.
      </p>
      <form onSubmit={save} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Full refund window (hours before appointment)
          </label>
          <input
            type="number"
            value={form.hours_for_full_refund}
            onChange={(e) =>
              setForm((p) => ({ ...p, hours_for_full_refund: parseInt(e.target.value) || 0 }))
            }
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <p className="text-xs text-gray-400 mt-1">
            Clients who cancel at least this many hours before get a full refund.
          </p>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Partial refund window (hours before appointment)
          </label>
          <input
            type="number"
            value={form.hours_for_partial_refund}
            onChange={(e) =>
              setForm((p) => ({ ...p, hours_for_partial_refund: parseInt(e.target.value) || 0 }))
            }
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Partial refund percentage (%)
          </label>
          <input
            type="number"
            min={0}
            max={100}
            value={form.partial_refund_percentage}
            onChange={(e) =>
              setForm((p) => ({
                ...p,
                partial_refund_percentage: parseInt(e.target.value) || 0,
              }))
            }
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
        <button
          type="submit"
          disabled={saving}
          className="rounded-xl bg-indigo-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60 transition-colors"
        >
          {saved ? '✓ Saved' : saving ? 'Saving…' : 'Save Policy'}
        </button>
      </form>
    </div>
  );
}

// ── Payments Section ──────────────────────────────────────────────────────────

function PaymentsSection() {
  const [status, setStatus] = useState<StripeStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const res = (await apiFetch('/merchant/payments/connect-status')) as StripeStatus;
        setStatus(res);
      } catch {
        /* ignore */
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, []);

  async function connectStripe() {
    setConnecting(true);
    try {
      const res = (await apiFetch('/merchant/payments/connect-account', {
        method: 'POST',
        body: JSON.stringify({ business_type: 'individual' }),
      })) as { onboarding_url: string };
      window.location.href = res.onboarding_url;
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to start Stripe onboarding');
      setConnecting(false);
    }
  }

  async function openDashboard() {
    try {
      const res = (await apiFetch('/merchant/payments/connect-dashboard-link', {
        method: 'POST',
      })) as { url: string };
      window.open(res.url, '_blank');
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed');
    }
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
      <h2 className="text-base font-semibold text-gray-900 mb-1">Payments</h2>
      <p className="text-sm text-gray-500 mb-5">
        Connect your Stripe account to accept online payments from clients.
      </p>

      {loading && (
        <div className="flex justify-center py-6">
          <div className="w-6 h-6 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin" />
        </div>
      )}

      {!loading && status && (
        <div className="space-y-4">
          <div className="rounded-xl bg-gray-50 border border-gray-200 px-5 py-4 space-y-3">
            {[
              {
                label: 'Stripe Connected',
                value: status.connected,
              },
              {
                label: 'Charges Enabled',
                value: status.charges_enabled,
              },
              {
                label: 'Payouts Enabled',
                value: status.payouts_enabled,
              },
              {
                label: 'Details Submitted',
                value: status.details_submitted,
              },
            ].map((item) => (
              <div key={item.label} className="flex justify-between text-sm">
                <span className="text-gray-600">{item.label}</span>
                <span
                  className={`font-medium ${item.value ? 'text-green-600' : 'text-gray-400'}`}
                >
                  {item.value ? '✓ Yes' : '— No'}
                </span>
              </div>
            ))}
          </div>

          {!status.connected && (
            <button
              onClick={connectStripe}
              disabled={connecting}
              className="w-full rounded-xl bg-indigo-600 py-3 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60 transition-colors"
            >
              {connecting ? 'Redirecting to Stripe…' : 'Connect Stripe Account'}
            </button>
          )}

          {status.connected && !status.details_submitted && (
            <button
              onClick={connectStripe}
              disabled={connecting}
              className="w-full rounded-xl bg-amber-500 py-3 text-sm font-semibold text-white hover:bg-amber-600 disabled:opacity-60 transition-colors"
            >
              {connecting ? 'Redirecting…' : 'Complete Stripe Onboarding'}
            </button>
          )}

          {status.connected && status.details_submitted && (
            <button
              onClick={openDashboard}
              className="w-full rounded-xl border border-gray-200 py-3 text-sm font-semibold text-gray-700 hover:bg-gray-50 transition-colors"
            >
              Open Stripe Dashboard ↗
            </button>
          )}
        </div>
      )}
    </div>
  );
}
