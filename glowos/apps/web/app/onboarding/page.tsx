'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { apiFetch } from '../lib/api';

// ─── Types ─────────────────────────────────────────────────────────────────────

type Merchant = {
  id: string;
  name: string;
  phone: string | null;
  description: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  postalCode: string | null;
  category: string | null;
  cancellationPolicy: CancellationPolicy | null;
  country: 'SG' | 'MY' | null;
  paymentGateway: 'stripe' | 'ipay88' | null;
  ipay88MerchantCode: string | null;
};

type Service = {
  id: string;
  name: string;
  description: string;
  category: string;
  durationMinutes: number;
  preBufferMinutes: number;
  postBufferMinutes: number;
  priceSgd: string;
};

type WorkingHour = {
  day_of_week: number;
  start_time: string;
  end_time: string;
  is_working: boolean;
};

type StaffMember = {
  id: string;
  name: string;
  title: string;
  service_ids: string[];
  working_hours: WorkingHour[];
};

type StripeStatus = {
  connected: boolean;
  charges_enabled: boolean;
  payouts_enabled: boolean;
  details_submitted: boolean;
};

type CancellationPolicy = {
  free_cancellation_hours: number;
  late_cancellation_refund_pct: number;
  no_show_charge: 'full' | 'partial' | 'none';
};

// ─── Constants ─────────────────────────────────────────────────────────────────

const CATEGORIES = [
  { value: 'restaurant', label: 'Restaurant / F&B' },
  { value: 'hair_salon', label: 'Hair Salon / Barbershop' },
  { value: 'beauty_clinic', label: 'Beauty / Facial Clinic' },
  { value: 'medical_clinic', label: 'Medical / Dental Clinic' },
  { value: 'spa', label: 'Spa / Wellness Centre' },
  { value: 'nail_studio', label: 'Nail Studio' },
  { value: 'massage', label: 'Massage / Physiotherapy' },
  { value: 'other', label: 'Other' },
];

const SERVICE_CATEGORIES = [
  { value: 'hair', label: 'Hair' },
  { value: 'nails', label: 'Nails' },
  { value: 'face', label: 'Face / Skin' },
  { value: 'body', label: 'Body / Wellness' },
  { value: 'massage', label: 'Massage' },
  { value: 'dining', label: 'Dining / F&B' },
  { value: 'medical', label: 'Medical / Clinical' },
  { value: 'other', label: 'Other' },
];

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const DEFAULT_WORKING_HOURS: WorkingHour[] = DAYS.map((_, i) => ({
  day_of_week: i,
  start_time: '09:00',
  end_time: '18:00',
  is_working: i >= 1 && i <= 6, // Mon–Sat default
}));

const STEP_TITLES = ['Profile', 'Services', 'Staff', 'Payments', 'Policy'];

// ─── Helpers ───────────────────────────────────────────────────────────────────

function authHeaders(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  const token = localStorage.getItem('access_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// ─── Sub-components ────────────────────────────────────────────────────────────

function ProgressBar({ current }: { current: number }) {
  return (
    <div className="w-full mb-8">
      <div className="flex items-center justify-between mb-2">
        {STEP_TITLES.map((title, i) => {
          const stepNum = i + 1;
          const isDone = stepNum < current;
          const isActive = stepNum === current;
          return (
            <div key={title} className="flex flex-col items-center flex-1">
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all ${
                  isDone
                    ? 'bg-indigo-600 text-white'
                    : isActive
                    ? 'bg-indigo-600 text-white ring-4 ring-indigo-100'
                    : 'bg-gray-200 text-gray-500'
                }`}
              >
                {isDone ? (
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  stepNum
                )}
              </div>
              <span
                className={`text-xs mt-1 font-medium ${
                  isActive ? 'text-indigo-600' : isDone ? 'text-gray-600' : 'text-gray-400'
                }`}
              >
                {title}
              </span>
            </div>
          );
        })}
      </div>
      <div className="relative h-1 bg-gray-200 rounded-full mt-1">
        <div
          className="absolute top-0 left-0 h-1 bg-indigo-600 rounded-full transition-all duration-500"
          style={{ width: `${((current - 1) / (STEP_TITLES.length - 1)) * 100}%` }}
        />
      </div>
    </div>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-600">
      {message}
    </div>
  );
}

function inputClass(hasError?: boolean) {
  return `w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500 transition ${
    hasError ? 'border-red-400 bg-red-50' : 'border-gray-300'
  }`;
}

// ─── Step 1: Business Profile ──────────────────────────────────────────────────

type Step1Props = {
  merchant: Merchant | null;
  onNext: () => void;
};

function Step1Profile({ merchant, onNext }: Step1Props) {
  const [form, setForm] = useState({
    name: merchant?.name ?? '',
    phone: merchant?.phone ?? '',
    description: merchant?.description ?? '',
    addressLine1: merchant?.addressLine1 ?? '',
    addressLine2: merchant?.addressLine2 ?? '',
    postalCode: merchant?.postalCode ?? '',
    category: merchant?.category ?? '',
  });
  const [errors, setErrors] = useState<Partial<typeof form>>({});
  const [apiError, setApiError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (merchant) {
      setForm({
        name: merchant.name ?? '',
        phone: merchant.phone ?? '',
        description: merchant.description ?? '',
        addressLine1: merchant.addressLine1 ?? '',
        addressLine2: merchant.addressLine2 ?? '',
        postalCode: merchant.postalCode ?? '',
        category: merchant.category ?? '',
      });
    }
  }, [merchant]);

  function validate() {
    const next: Partial<typeof form> = {};
    if (!form.name.trim()) next.name = 'Business name is required';
    if (!form.addressLine1.trim()) next.addressLine1 = 'Address is required';
    if (!form.postalCode.trim()) next.postalCode = 'Postal code is required';
    if (!form.category) next.category = 'Please select a category';
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function handleNext() {
    if (!validate()) return;
    setLoading(true);
    setApiError('');
    try {
      await apiFetch('/merchant/me', {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify({
          name: form.name,
          phone: form.phone,
          description: form.description,
          addressLine1: form.addressLine1,
          addressLine2: form.addressLine2,
          postalCode: form.postalCode,
          category: form.category || undefined,
        }),
      });
      onNext();
    } catch (err) {
      setApiError(err instanceof Error ? err.message : 'Failed to save profile');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <h2 className="text-xl font-bold text-gray-900 mb-1">Business Profile</h2>
      <p className="text-sm text-gray-500 mb-6">Tell clients about your business.</p>
      {apiError && <ErrorBanner message={apiError} />}
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Business name</label>
          <input
            type="text"
            value={form.name}
            onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
            className={inputClass(!!errors.name)}
            placeholder="e.g. Glow Wellness, Trattoria Sole"
          />
          {errors.name && <p className="text-xs text-red-500 mt-1">{errors.name}</p>}
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
          <select
            value={form.category}
            onChange={(e) => setForm((p) => ({ ...p, category: e.target.value }))}
            className={inputClass(!!errors.category)}
          >
            <option value="">Select a category…</option>
            {CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
          {errors.category && <p className="text-xs text-red-500 mt-1">{errors.category}</p>}
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Business phone</label>
          <input
            type="tel"
            value={form.phone}
            onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))}
            className={inputClass()}
            placeholder="+65 9123 4567"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Address line 1</label>
          <input
            type="text"
            value={form.addressLine1}
            onChange={(e) => setForm((p) => ({ ...p, addressLine1: e.target.value }))}
            className={inputClass(!!errors.addressLine1)}
            placeholder="123 Orchard Road"
          />
          {errors.addressLine1 && <p className="text-xs text-red-500 mt-1">{errors.addressLine1}</p>}
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Address line 2 <span className="text-gray-400 font-normal">(optional)</span></label>
          <input
            type="text"
            value={form.addressLine2}
            onChange={(e) => setForm((p) => ({ ...p, addressLine2: e.target.value }))}
            className={inputClass()}
            placeholder="#02-01"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Postal code</label>
          <input
            type="text"
            value={form.postalCode}
            onChange={(e) => setForm((p) => ({ ...p, postalCode: e.target.value }))}
            className={inputClass(!!errors.postalCode)}
            placeholder="238801"
          />
          {errors.postalCode && <p className="text-xs text-red-500 mt-1">{errors.postalCode}</p>}
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Short description <span className="text-gray-400 font-normal">(optional)</span></label>
          <textarea
            value={form.description}
            onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
            className={`${inputClass()} resize-none`}
            rows={3}
            placeholder="Briefly describe what makes your business special…"
          />
        </div>
      </div>

      <div className="mt-8 flex justify-end">
        <button
          onClick={handleNext}
          disabled={loading}
          className="rounded-xl bg-indigo-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? 'Saving…' : 'Next: Services'}
        </button>
      </div>
    </div>
  );
}

// ─── Step 2: Services ──────────────────────────────────────────────────────────

type Step2Props = {
  services: Service[];
  onServicesChange: (services: Service[]) => void;
  onNext: () => void;
  onBack: () => void;
};

const EMPTY_SERVICE_FORM = {
  name: '',
  description: '',
  category: 'hair' as string,
  duration_minutes: 60,
  pre_buffer_minutes: 0,
  post_buffer_minutes: 0,
  price_sgd: 0,
};

function Step2Services({ services, onServicesChange, onNext, onBack }: Step2Props) {
  const [form, setForm] = useState({ ...EMPTY_SERVICE_FORM });
  const [formErrors, setFormErrors] = useState<Partial<Record<keyof typeof EMPTY_SERVICE_FORM, string>>>({});
  const [apiError, setApiError] = useState('');
  const [stepError, setStepError] = useState('');
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState(services.length === 0);
  const [editingId, setEditingId] = useState<string | null>(null);

  function validateForm() {
    const next: Partial<Record<keyof typeof EMPTY_SERVICE_FORM, string>> = {};
    if (!form.name.trim()) next.name = 'Service name is required';
    if (!form.description.trim()) next.description = 'Description is required';
    if (!form.category) next.category = 'Category is required';
    if (!form.duration_minutes || form.duration_minutes <= 0) next.duration_minutes = 'Duration must be positive';
    if (!form.price_sgd || form.price_sgd <= 0) next.price_sgd = 'Price must be positive';
    setFormErrors(next);
    return Object.keys(next).length === 0;
  }

  async function handleAddService() {
    if (!validateForm()) return;
    setLoading(true);
    setApiError('');
    try {
      if (editingId) {
        const data = await apiFetch(`/merchant/services/${editingId}`, {
          method: 'PUT',
          headers: authHeaders(),
          body: JSON.stringify(form),
        });
        onServicesChange(services.map((s) => (s.id === editingId ? data.service : s)));
        setEditingId(null);
      } else {
        const data = await apiFetch('/merchant/services', {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify(form),
        });
        onServicesChange([...services, data.service]);
      }
      setForm({ ...EMPTY_SERVICE_FORM });
      setAdding(false);
    } catch (err) {
      setApiError(err instanceof Error ? err.message : 'Failed to save service');
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(id: string) {
    try {
      await apiFetch(`/merchant/services/${id}`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
      onServicesChange(services.filter((s) => s.id !== id));
    } catch (err) {
      setApiError(err instanceof Error ? err.message : 'Failed to delete service');
    }
  }

  function startEdit(svc: Service) {
    setForm({
      name: svc.name,
      description: svc.description,
      category: svc.category,
      duration_minutes: svc.durationMinutes,
      pre_buffer_minutes: svc.preBufferMinutes ?? 0,
      post_buffer_minutes: svc.postBufferMinutes ?? 0,
      price_sgd: parseFloat(svc.priceSgd),
    });
    setEditingId(svc.id);
    setAdding(true);
  }

  function handleNext() {
    if (services.length === 0) {
      setStepError('Add at least one service to continue.');
      return;
    }
    setStepError('');
    onNext();
  }

  return (
    <div>
      <h2 className="text-xl font-bold text-gray-900 mb-1">Services</h2>
      <p className="text-sm text-gray-500 mb-6">Add the services your business offers.</p>
      {apiError && <ErrorBanner message={apiError} />}

      {/* Service list */}
      {services.length > 0 && (
        <div className="mb-4 space-y-2">
          {services.map((svc) => (
            <div key={svc.id} className="flex items-center justify-between rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
              <div>
                <p className="text-sm font-semibold text-gray-800">{svc.name}</p>
                <p className="text-xs text-gray-500">{svc.durationMinutes} min · S${parseFloat(svc.priceSgd).toFixed(2)}</p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => startEdit(svc)}
                  className="text-xs text-indigo-600 hover:text-indigo-700 font-medium"
                >
                  Edit
                </button>
                <button
                  onClick={() => handleDelete(svc.id)}
                  className="text-xs text-red-500 hover:text-red-600 font-medium"
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add / edit form */}
      {adding ? (
        <div className="rounded-xl border border-indigo-200 bg-indigo-50/40 p-4 space-y-3">
          <h3 className="text-sm font-semibold text-gray-800">{editingId ? 'Edit Service' : 'New Service'}</h3>

          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="block text-xs font-medium text-gray-700 mb-1">Service name</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                className={inputClass(!!formErrors.name)}
                placeholder="Korean Perm"
              />
              {formErrors.name && <p className="text-xs text-red-500 mt-1">{formErrors.name}</p>}
            </div>

            <div className="col-span-2">
              <label className="block text-xs font-medium text-gray-700 mb-1">Description</label>
              <input
                type="text"
                value={form.description}
                onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
                className={inputClass(!!formErrors.description)}
                placeholder="Includes wash, treatment, and style"
              />
              {formErrors.description && <p className="text-xs text-red-500 mt-1">{formErrors.description}</p>}
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Category</label>
              <select
                value={form.category}
                onChange={(e) => setForm((p) => ({ ...p, category: e.target.value }))}
                className={inputClass(!!formErrors.category)}
              >
                {SERVICE_CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Duration (min)</label>
              <input
                type="number"
                min={1}
                value={form.duration_minutes}
                onChange={(e) => setForm((p) => ({ ...p, duration_minutes: parseInt(e.target.value) || 0 }))}
                className={inputClass(!!formErrors.duration_minutes)}
              />
              {formErrors.duration_minutes && <p className="text-xs text-red-500 mt-1">{formErrors.duration_minutes}</p>}
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Pre-buffer (min)</label>
              <input
                type="number"
                min={0}
                max={120}
                step={5}
                value={form.pre_buffer_minutes}
                onChange={(e) => setForm((p) => ({ ...p, pre_buffer_minutes: parseInt(e.target.value) || 0 }))}
                className={inputClass()}
              />
              <p className="text-[10px] text-gray-500 mt-0.5">Time before treatment owned by secondary staff (e.g., prep)</p>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Post-buffer (min)</label>
              <input
                type="number"
                min={0}
                max={120}
                step={5}
                value={form.post_buffer_minutes}
                onChange={(e) => setForm((p) => ({ ...p, post_buffer_minutes: parseInt(e.target.value) || 0 }))}
                className={inputClass()}
              />
              <p className="text-[10px] text-gray-500 mt-0.5">Time after treatment owned by secondary staff (e.g., cleanup)</p>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Price (S$)</label>
              <input
                type="number"
                min={0}
                step={0.01}
                value={form.price_sgd}
                onChange={(e) => setForm((p) => ({ ...p, price_sgd: parseFloat(e.target.value) || 0 }))}
                className={inputClass(!!formErrors.price_sgd)}
              />
              {formErrors.price_sgd && <p className="text-xs text-red-500 mt-1">{formErrors.price_sgd}</p>}
            </div>
          </div>

          <div className="flex gap-2 pt-1">
            <button
              onClick={handleAddService}
              disabled={loading}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-60 transition-colors"
            >
              {loading ? 'Saving…' : editingId ? 'Save Changes' : 'Add Service'}
            </button>
            <button
              onClick={() => {
                setAdding(false);
                setEditingId(null);
                setForm({ ...EMPTY_SERVICE_FORM });
                setFormErrors({});
              }}
              className="rounded-lg border border-gray-300 px-4 py-2 text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setAdding(true)}
          className="w-full rounded-xl border-2 border-dashed border-indigo-200 py-3 text-sm font-medium text-indigo-600 hover:border-indigo-400 hover:bg-indigo-50/40 transition-colors"
        >
          + Add a Service
        </button>
      )}

      {stepError && <p className="text-sm text-red-500 mt-3">{stepError}</p>}

      <div className="mt-8 flex justify-between">
        <button onClick={onBack} className="rounded-xl border border-gray-300 px-6 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">
          Back
        </button>
        <button
          onClick={handleNext}
          className="rounded-xl bg-indigo-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 transition-colors"
        >
          Next: Staff
        </button>
      </div>
    </div>
  );
}

// ─── Step 3: Staff ─────────────────────────────────────────────────────────────

type Step3Props = {
  staffList: StaffMember[];
  services: Service[];
  onStaffChange: (staff: StaffMember[]) => void;
  onNext: () => void;
  onBack: () => void;
};

const EMPTY_STAFF_FORM = {
  name: '',
  title: '',
  service_ids: [] as string[],
  working_hours: DEFAULT_WORKING_HOURS,
};

function Step3Staff({ staffList, services, onStaffChange, onNext, onBack }: Step3Props) {
  const [form, setForm] = useState({ ...EMPTY_STAFF_FORM, working_hours: [...DEFAULT_WORKING_HOURS] });
  const [formErrors, setFormErrors] = useState<{ name?: string }>({});
  const [apiError, setApiError] = useState('');
  const [stepError, setStepError] = useState('');
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState(staffList.length === 0);
  const [editingId, setEditingId] = useState<string | null>(null);

  function validateForm() {
    const next: { name?: string } = {};
    if (!form.name.trim()) next.name = 'Staff name is required';
    setFormErrors(next);
    return Object.keys(next).length === 0;
  }

  async function handleAddStaff() {
    if (!validateForm()) return;
    setLoading(true);
    setApiError('');
    try {
      if (editingId) {
        const data = await apiFetch(`/merchant/staff/${editingId}`, {
          method: 'PUT',
          headers: authHeaders(),
          body: JSON.stringify(form),
        });
        onStaffChange(staffList.map((s) => (s.id === editingId ? data.staff : s)));
        setEditingId(null);
      } else {
        const data = await apiFetch('/merchant/staff', {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify(form),
        });
        onStaffChange([...staffList, data.staff]);
      }
      setForm({ ...EMPTY_STAFF_FORM, working_hours: [...DEFAULT_WORKING_HOURS] });
      setAdding(false);
    } catch (err) {
      setApiError(err instanceof Error ? err.message : 'Failed to save staff');
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(id: string) {
    try {
      await apiFetch(`/merchant/staff/${id}`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
      onStaffChange(staffList.filter((s) => s.id !== id));
    } catch (err) {
      setApiError(err instanceof Error ? err.message : 'Failed to remove staff');
    }
  }

  function startEdit(member: StaffMember) {
    setForm({
      name: member.name,
      title: member.title,
      service_ids: member.service_ids,
      working_hours: member.working_hours.length > 0 ? member.working_hours : [...DEFAULT_WORKING_HOURS],
    });
    setEditingId(member.id);
    setAdding(true);
  }

  function toggleService(id: string) {
    setForm((p) => ({
      ...p,
      service_ids: p.service_ids.includes(id)
        ? p.service_ids.filter((s) => s !== id)
        : [...p.service_ids, id],
    }));
  }

  function updateHour(dayIndex: number, field: 'start_time' | 'end_time' | 'is_working', value: string | boolean) {
    setForm((p) => ({
      ...p,
      working_hours: p.working_hours.map((wh) =>
        wh.day_of_week === dayIndex ? { ...wh, [field]: value } : wh
      ),
    }));
  }

  function handleNext() {
    if (staffList.length === 0) {
      setStepError('Add at least one staff member to continue.');
      return;
    }
    setStepError('');
    onNext();
  }

  return (
    <div>
      <h2 className="text-xl font-bold text-gray-900 mb-1">Staff</h2>
      <p className="text-sm text-gray-500 mb-6">Add your team members and their schedules.</p>
      {apiError && <ErrorBanner message={apiError} />}

      {/* Staff list */}
      {staffList.length > 0 && (
        <div className="mb-4 space-y-2">
          {staffList.map((member) => (
            <div key={member.id} className="flex items-center justify-between rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
              <div>
                <p className="text-sm font-semibold text-gray-800">{member.name}</p>
                {member.title && <p className="text-xs text-gray-500">{member.title}</p>}
              </div>
              <div className="flex gap-2">
                <button onClick={() => startEdit(member)} className="text-xs text-indigo-600 hover:text-indigo-700 font-medium">Edit</button>
                <button onClick={() => handleDelete(member.id)} className="text-xs text-red-500 hover:text-red-600 font-medium">Remove</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add / edit form */}
      {adding ? (
        <div className="rounded-xl border border-indigo-200 bg-indigo-50/40 p-4 space-y-4">
          <h3 className="text-sm font-semibold text-gray-800">{editingId ? 'Edit Staff' : 'New Staff Member'}</h3>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Name</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                className={inputClass(!!formErrors.name)}
                placeholder="Sarah Lim"
              />
              {formErrors.name && <p className="text-xs text-red-500 mt-1">{formErrors.name}</p>}
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Title</label>
              <input
                type="text"
                value={form.title}
                onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))}
                className={inputClass()}
                placeholder="e.g. Senior Therapist, Head Chef"
              />
            </div>
          </div>

          {/* Service multi-select */}
          {services.length > 0 && (
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-2">Services offered</label>
              <div className="flex flex-wrap gap-2">
                {services.map((svc) => {
                  const selected = form.service_ids.includes(svc.id);
                  return (
                    <button
                      key={svc.id}
                      type="button"
                      onClick={() => toggleService(svc.id)}
                      className={`rounded-full px-3 py-1 text-xs font-medium border transition-colors ${
                        selected
                          ? 'bg-indigo-600 text-white border-indigo-600'
                          : 'bg-white text-gray-600 border-gray-300 hover:border-indigo-400'
                      }`}
                    >
                      {svc.name}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Working hours grid */}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-2">Working hours</label>
            <div className="space-y-2">
              {form.working_hours.map((wh) => (
                <div key={wh.day_of_week} className="flex items-center gap-3">
                  <label className="flex items-center gap-1.5 w-14 shrink-0 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={wh.is_working}
                      onChange={(e) => updateHour(wh.day_of_week, 'is_working', e.target.checked)}
                      className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                    />
                    <span className="text-xs text-gray-600">{DAYS[wh.day_of_week]}</span>
                  </label>
                  {wh.is_working ? (
                    <div className="flex items-center gap-1.5 text-xs text-gray-600">
                      <input
                        type="time"
                        value={wh.start_time}
                        onChange={(e) => updateHour(wh.day_of_week, 'start_time', e.target.value)}
                        className="rounded border border-gray-300 px-2 py-1 text-xs focus:ring-2 focus:ring-indigo-500 outline-none"
                      />
                      <span>–</span>
                      <input
                        type="time"
                        value={wh.end_time}
                        onChange={(e) => updateHour(wh.day_of_week, 'end_time', e.target.value)}
                        className="rounded border border-gray-300 px-2 py-1 text-xs focus:ring-2 focus:ring-indigo-500 outline-none"
                      />
                    </div>
                  ) : (
                    <span className="text-xs text-gray-400 italic">Day off</span>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="flex gap-2">
            <button
              onClick={handleAddStaff}
              disabled={loading}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-60 transition-colors"
            >
              {loading ? 'Saving…' : editingId ? 'Save Changes' : 'Add Staff Member'}
            </button>
            <button
              onClick={() => {
                setAdding(false);
                setEditingId(null);
                setForm({ ...EMPTY_STAFF_FORM, working_hours: [...DEFAULT_WORKING_HOURS] });
                setFormErrors({});
              }}
              className="rounded-lg border border-gray-300 px-4 py-2 text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setAdding(true)}
          className="w-full rounded-xl border-2 border-dashed border-indigo-200 py-3 text-sm font-medium text-indigo-600 hover:border-indigo-400 hover:bg-indigo-50/40 transition-colors"
        >
          + Add a Staff Member
        </button>
      )}

      {stepError && <p className="text-sm text-red-500 mt-3">{stepError}</p>}

      <div className="mt-8 flex justify-between">
        <button onClick={onBack} className="rounded-xl border border-gray-300 px-6 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">
          Back
        </button>
        <button onClick={handleNext} className="rounded-xl bg-indigo-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 transition-colors">
          Next: Payments
        </button>
      </div>
    </div>
  );
}

// ─── Step 4: Payments ──────────────────────────────────────────────────────────

type Gateway = 'stripe' | 'ipay88';

type Step4Props = {
  merchant: Merchant | null;
  onMerchantChange: (m: Merchant) => void;
  onNext: () => void;
  onBack: () => void;
};

function defaultGateway(merchant: Merchant | null): Gateway {
  if (merchant?.paymentGateway) return merchant.paymentGateway;
  return merchant?.country === 'MY' ? 'ipay88' : 'stripe';
}

function Step4Payments({ merchant, onMerchantChange, onNext, onBack }: Step4Props) {
  const [gateway, setGateway] = useState<Gateway>(defaultGateway(merchant));
  const [switching, setSwitching] = useState(false);
  const [status, setStatus] = useState<StripeStatus | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [connectLoading, setConnectLoading] = useState(false);
  const [error, setError] = useState('');

  const fetchStatus = useCallback(async () => {
    setLoadingStatus(true);
    try {
      const data = await apiFetch('/merchant/payments/connect-status', {
        headers: authHeaders(),
      });
      setStatus(data);
    } catch {
      // Non-fatal — show "not connected"
      setStatus({ connected: false, charges_enabled: false, payouts_enabled: false, details_submitted: false });
    } finally {
      setLoadingStatus(false);
    }
  }, []);

  useEffect(() => {
    if (gateway === 'stripe') void fetchStatus();
  }, [fetchStatus, gateway]);

  async function handleSwitchGateway(next: Gateway) {
    if (next === gateway) return;
    setGateway(next);
    setSwitching(true);
    setError('');
    try {
      const data = await apiFetch('/merchant/me', {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify({ paymentGateway: next }),
      });
      if (data?.merchant) onMerchantChange(data.merchant);
    } catch (err) {
      // Roll back the picker if the server rejects the switch
      setGateway(gateway);
      setError(err instanceof Error ? err.message : 'Failed to update payment gateway');
    } finally {
      setSwitching(false);
    }
  }

  async function handleConnect() {
    setConnectLoading(true);
    setError('');
    try {
      const data = await apiFetch('/merchant/payments/connect-account', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ business_type: 'individual' }),
      });
      window.open(data.onboarding_url, '_blank');
      // Recheck status after a short moment
      setTimeout(() => { void fetchStatus(); }, 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start Stripe setup');
    } finally {
      setConnectLoading(false);
    }
  }

  function statusBadge() {
    if (loadingStatus) return <span className="text-xs text-gray-400">Checking…</span>;
    if (!status || !status.connected) {
      return <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600">Not connected</span>;
    }
    if (status.charges_enabled && status.payouts_enabled) {
      return <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-700">Connected</span>;
    }
    return <span className="inline-flex items-center gap-1 rounded-full bg-yellow-100 px-2.5 py-0.5 text-xs font-medium text-yellow-700">Pending verification</span>;
  }

  function ipay88Badge() {
    if (merchant?.ipay88MerchantCode) {
      return <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-700">Connected</span>;
    }
    return <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600">Not connected</span>;
  }

  return (
    <div>
      <h2 className="text-xl font-bold text-gray-900 mb-1">Payment Setup</h2>
      <p className="text-sm text-gray-500 mb-6">
        Choose how you&rsquo;d like to accept online payments. You can skip this and set it up later from Settings.
      </p>
      {error && <ErrorBanner message={error} />}

      {/* Gateway picker — defaults to merchant.paymentGateway, falls back to country
          (MY → iPay88, otherwise Stripe). Switching here PATCHes /merchant/me; the
          credential setup itself happens on the gateway-specific card below. */}
      <div className="grid grid-cols-2 gap-3 mb-5">
        <button
          type="button"
          onClick={() => handleSwitchGateway('stripe')}
          disabled={switching}
          className={`text-left rounded-xl border-2 p-4 transition-colors ${
            gateway === 'stripe'
              ? 'border-indigo-600 bg-indigo-50/40'
              : 'border-gray-200 hover:border-indigo-300'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-gray-800">Stripe</span>
            {gateway === 'stripe' && <span className="text-xs font-medium text-indigo-600">Selected</span>}
          </div>
          <p className="text-xs text-gray-500 mt-1">Cards, PayNow, GrabPay (SG &amp; international)</p>
        </button>
        <button
          type="button"
          onClick={() => handleSwitchGateway('ipay88')}
          disabled={switching}
          className={`text-left rounded-xl border-2 p-4 transition-colors ${
            gateway === 'ipay88'
              ? 'border-indigo-600 bg-indigo-50/40'
              : 'border-gray-200 hover:border-indigo-300'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-gray-800">iPay88</span>
            {gateway === 'ipay88' && <span className="text-xs font-medium text-indigo-600">Selected</span>}
          </div>
          <p className="text-xs text-gray-500 mt-1">FPX, Touch &lsquo;n Go, DuitNow, GrabPay (Malaysia)</p>
        </button>
      </div>

      {gateway === 'stripe' ? (
        <div className="rounded-xl border border-gray-200 bg-white p-6">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h3 className="text-sm font-semibold text-gray-800">Stripe Connect</h3>
              <p className="text-xs text-gray-500 mt-0.5">Powered by Stripe — the safest way to accept payments online</p>
            </div>
            {statusBadge()}
          </div>

          {!loadingStatus && status && !status.charges_enabled && (
            <button
              onClick={handleConnect}
              disabled={connectLoading}
              className="w-full rounded-xl bg-indigo-600 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60 transition-colors"
            >
              {connectLoading ? 'Opening Stripe…' : 'Connect Stripe'}
            </button>
          )}

          {!loadingStatus && status?.charges_enabled && (
            <div className="rounded-lg bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-700">
              Your Stripe account is connected and ready to accept payments.
            </div>
          )}

          {!loadingStatus && status?.connected && !status.charges_enabled && (
            <div className="mt-3 rounded-lg bg-yellow-50 border border-yellow-200 px-4 py-3 text-sm text-yellow-700">
              Your Stripe account is pending verification. Check your email from Stripe for next steps.
            </div>
          )}

          <button
            onClick={() => { void fetchStatus(); }}
            className="mt-3 text-xs text-indigo-600 hover:text-indigo-700 font-medium"
          >
            Refresh status
          </button>
        </div>
      ) : (
        // iPay88 has no inline OAuth — the merchant pastes their credentials
        // into a dedicated form. Keep onboarding moving by pointing them to
        // Settings → iPay88 after the wizard finishes.
        <div className="rounded-xl border border-gray-200 bg-white p-6">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h3 className="text-sm font-semibold text-gray-800">iPay88 (Malaysia)</h3>
              <p className="text-xs text-gray-500 mt-0.5">FPX bank transfer, e-wallets, and cards via iPay88&rsquo;s hosted page</p>
            </div>
            {ipay88Badge()}
          </div>

          {merchant?.ipay88MerchantCode ? (
            <div className="rounded-lg bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-700">
              Your iPay88 account is connected. Bookings will route through iPay88&rsquo;s payment page.
            </div>
          ) : (
            <div className="space-y-3">
              <div className="rounded-lg bg-gray-50 border border-gray-200 px-4 py-3 text-sm text-gray-700">
                You&rsquo;ll need your <strong>iPay88 Merchant Code</strong> and <strong>Merchant Key</strong> from your
                iPay88 dashboard. Don&rsquo;t have an iPay88 account yet?{' '}
                <a
                  href="https://www.ipay88.com.my/sign-up/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-indigo-600 hover:underline font-medium"
                >
                  Sign up here
                </a>
                .
              </div>
              <Link
                href="/dashboard/settings/ipay88"
                className="block w-full rounded-xl bg-indigo-600 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 transition-colors text-center"
              >
                Set up iPay88 credentials
              </Link>
              <p className="text-xs text-gray-500 text-center">
                Or skip for now and add them later from Settings → Payments.
              </p>
            </div>
          )}
        </div>
      )}

      <div className="mt-8 flex justify-between">
        <button onClick={onBack} className="rounded-xl border border-gray-300 px-6 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">
          Back
        </button>
        <div className="flex gap-3">
          <button onClick={onNext} className="rounded-xl border border-gray-300 px-6 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors">
            Skip for now
          </button>
          <button onClick={onNext} className="rounded-xl bg-indigo-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 transition-colors">
            Next: Policy
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Step 5: Cancellation Policy ───────────────────────────────────────────────

type Step5Props = {
  merchant: Merchant | null;
  onBack: () => void;
};

const FREE_WINDOW_OPTIONS = [
  { value: 24, label: '24 hours' },
  { value: 48, label: '48 hours' },
  { value: 72, label: '72 hours' },
];

const REFUND_OPTIONS = [
  { value: 50, label: '50% refund' },
  { value: 0, label: 'No refund' },
];

const NO_SHOW_OPTIONS = [
  { value: 'full' as const, label: 'Full charge' },
  { value: 'partial' as const, label: 'Partial charge (50%)' },
  { value: 'none' as const, label: 'No fee' },
];

function Step5Policy({ merchant, onBack }: Step5Props) {
  const router = useRouter();
  const existing = merchant?.cancellationPolicy;
  const [freeHours, setFreeHours] = useState<number>(existing?.free_cancellation_hours ?? 24);
  const [refundPct, setRefundPct] = useState<number>(existing?.late_cancellation_refund_pct ?? 50);
  const [noShow, setNoShow] = useState<'full' | 'partial' | 'none'>(existing?.no_show_charge ?? 'full');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleComplete() {
    setLoading(true);
    setError('');
    try {
      await apiFetch('/merchant/settings/cancellation-policy', {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify({
          free_cancellation_hours: freeHours,
          late_cancellation_refund_pct: refundPct,
          no_show_charge: noShow,
        }),
      });
      await apiFetch('/merchant/onboarding/complete', {
        method: 'POST',
        headers: authHeaders(),
      });
      router.push('/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save policy');
    } finally {
      setLoading(false);
    }
  }

  const noShowLabel = NO_SHOW_OPTIONS.find((o) => o.value === noShow)?.label ?? '';

  return (
    <div>
      <h2 className="text-xl font-bold text-gray-900 mb-1">Cancellation Policy</h2>
      <p className="text-sm text-gray-500 mb-6">Set the rules for cancellations and no-shows.</p>
      {error && <ErrorBanner message={error} />}

      <div className="space-y-6">
        {/* Free cancellation window */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Free cancellation window</label>
          <div className="flex gap-3">
            {FREE_WINDOW_OPTIONS.map((opt) => (
              <label key={opt.value} className="flex-1 cursor-pointer">
                <input
                  type="radio"
                  name="free_hours"
                  value={opt.value}
                  checked={freeHours === opt.value}
                  onChange={() => setFreeHours(opt.value)}
                  className="sr-only"
                />
                <div className={`rounded-lg border-2 py-2.5 text-center text-sm font-medium transition-colors ${
                  freeHours === opt.value
                    ? 'border-indigo-600 bg-indigo-50 text-indigo-700'
                    : 'border-gray-200 text-gray-600 hover:border-indigo-300'
                }`}>
                  {opt.label}
                </div>
              </label>
            ))}
          </div>
          <p className="text-xs text-gray-400 mt-1">Clients can cancel for free up to {freeHours}h before their appointment.</p>
        </div>

        {/* Late cancellation refund */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Late cancellation refund</label>
          <div className="flex gap-3">
            {REFUND_OPTIONS.map((opt) => (
              <label key={opt.value} className="flex-1 cursor-pointer">
                <input
                  type="radio"
                  name="refund_pct"
                  value={opt.value}
                  checked={refundPct === opt.value}
                  onChange={() => setRefundPct(opt.value)}
                  className="sr-only"
                />
                <div className={`rounded-lg border-2 py-2.5 text-center text-sm font-medium transition-colors ${
                  refundPct === opt.value
                    ? 'border-indigo-600 bg-indigo-50 text-indigo-700'
                    : 'border-gray-200 text-gray-600 hover:border-indigo-300'
                }`}>
                  {opt.label}
                </div>
              </label>
            ))}
          </div>
          <p className="text-xs text-gray-400 mt-1">Applied when clients cancel within {freeHours}h of their appointment.</p>
        </div>

        {/* No-show fee */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">No-show fee</label>
          <div className="flex gap-3">
            {NO_SHOW_OPTIONS.map((opt) => (
              <label key={opt.value} className="flex-1 cursor-pointer">
                <input
                  type="radio"
                  name="no_show"
                  value={opt.value}
                  checked={noShow === opt.value}
                  onChange={() => setNoShow(opt.value)}
                  className="sr-only"
                />
                <div className={`rounded-lg border-2 py-2.5 text-center text-sm font-medium transition-colors ${
                  noShow === opt.value
                    ? 'border-indigo-600 bg-indigo-50 text-indigo-700'
                    : 'border-gray-200 text-gray-600 hover:border-indigo-300'
                }`}>
                  {opt.label}
                </div>
              </label>
            ))}
          </div>
        </div>

        {/* Policy preview */}
        <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Policy preview (as clients see it)</h3>
          <p className="text-sm text-gray-700 leading-relaxed">
            You may cancel your appointment free of charge up to <strong>{freeHours} hours</strong> before your scheduled time.
            {' '}Cancellations made within {freeHours} hours will receive{' '}
            <strong>{refundPct === 100 ? 'a full refund' : refundPct === 0 ? 'no refund' : `a ${refundPct}% refund`}</strong>.
            {' '}Clients who do not show up will be charged{' '}
            <strong>{noShowLabel.toLowerCase()}</strong>.
          </p>
        </div>
      </div>

      <div className="mt-8 flex justify-between">
        <button onClick={onBack} className="rounded-xl border border-gray-300 px-6 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">
          Back
        </button>
        <button
          onClick={handleComplete}
          disabled={loading}
          className="rounded-xl bg-indigo-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? 'Finishing…' : 'Complete Setup'}
        </button>
      </div>
    </div>
  );
}

// ─── Main Onboarding Page ──────────────────────────────────────────────────────

export default function OnboardingPage() {
  const [step, setStep] = useState(1);
  const [merchant, setMerchant] = useState<Merchant | null>(null);
  const [services, setServices] = useState<Service[]>([]);
  const [staffList, setStaffList] = useState<StaffMember[]>([]);
  const [booting, setBooting] = useState(true);

  // Load existing data on mount
  useEffect(() => {
    async function load() {
      try {
        const headers = authHeaders();
        const [merchantData, servicesData, staffData] = await Promise.all([
          apiFetch('/merchant/me', { headers }),
          apiFetch('/merchant/services', { headers }),
          apiFetch('/merchant/staff', { headers }),
        ]);
        setMerchant(merchantData.merchant);
        setServices(servicesData.services ?? []);
        setStaffList(staffData.staff ?? []);
      } catch {
        // Continue — pre-fill will be empty
      } finally {
        setBooting(false);
      }
    }
    void load();
  }, []);

  if (booting) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-purple-50 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 rounded-full border-2 border-indigo-600 border-t-transparent animate-spin" />
          <p className="text-sm text-gray-500">Loading your account…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-purple-50 flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-xl">
        {/* Header */}
        <div className="text-center mb-6">
          <Link href="/" className="text-2xl font-bold text-indigo-600 hover:text-indigo-700 transition-colors">GlowOS</Link>
          <p className="text-gray-500 text-sm mt-1">Let&rsquo;s set up your business in a few quick steps.</p>
        </div>

        <div className="bg-white rounded-2xl shadow-xl shadow-gray-100 border border-gray-100 p-8">
          <ProgressBar current={step} />

          {step === 1 && (
            <Step1Profile
              merchant={merchant}
              onNext={() => setStep(2)}
            />
          )}

          {step === 2 && (
            <Step2Services
              services={services}
              onServicesChange={setServices}
              onNext={() => setStep(3)}
              onBack={() => setStep(1)}
            />
          )}

          {step === 3 && (
            <Step3Staff
              staffList={staffList}
              services={services}
              onStaffChange={setStaffList}
              onNext={() => setStep(4)}
              onBack={() => setStep(2)}
            />
          )}

          {step === 4 && (
            <Step4Payments
              merchant={merchant}
              onMerchantChange={setMerchant}
              onNext={() => setStep(5)}
              onBack={() => setStep(3)}
            />
          )}

          {step === 5 && (
            <Step5Policy
              merchant={merchant}
              onBack={() => setStep(4)}
            />
          )}
        </div>
      </div>
    </div>
  );
}
