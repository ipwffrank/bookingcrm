'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch, ApiError } from '../../lib/api';

// ─── Types ─────────────────────────────────────────────────────────────────────

type Category = 'hair' | 'nails' | 'face' | 'body' | 'massage' | 'dining' | 'medical' | 'other';

interface Service {
  id: string;
  name: string;
  description: string;
  category: Category;
  durationMinutes: number;
  bufferMinutes: number;
  priceSgd: string;
  displayOrder: number;
  isActive: boolean;
  slotType: 'standard' | 'consult' | 'treatment';
  requiresConsultFirst: boolean;
  consultServiceId: string | null;
}

interface ServiceForm {
  name: string;
  description: string;
  category: Category;
  duration_minutes: string;
  buffer_minutes: string;
  price_sgd: string;
  slot_type: 'standard' | 'consult' | 'treatment';
  requires_consult_first: boolean;
  consult_service_id: string;
}

const CATEGORIES: { value: Category; label: string }[] = [
  { value: 'hair', label: 'Hair' },
  { value: 'nails', label: 'Nails' },
  { value: 'face', label: 'Face / Skin' },
  { value: 'body', label: 'Body / Wellness' },
  { value: 'massage', label: 'Massage' },
  { value: 'dining', label: 'Dining / F&B' },
  { value: 'medical', label: 'Medical / Clinical' },
  { value: 'other', label: 'Other' },
];

const CATEGORY_COLORS: Record<Category, string> = {
  hair:    'bg-pink-100 text-pink-700 border-pink-200',
  nails:   'bg-purple-100 text-purple-700 border-purple-200',
  face:    'bg-blue-100 text-blue-700 border-blue-200',
  body:    'bg-green-100 text-green-700 border-green-200',
  massage: 'bg-amber-100 text-amber-700 border-amber-200',
  dining:  'bg-orange-100 text-orange-700 border-orange-200',
  medical: 'bg-teal-100 text-teal-700 border-teal-200',
  other:   'bg-gray-100 text-gray-600 border-gray-200',
};

// ─── Helpers ───────────────────────────────────────────────────────────────────

function Spinner() {
  return (
    <div className="flex items-center justify-center py-16">
      <div className="w-8 h-8 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin" />
    </div>
  );
}

function blankForm(): ServiceForm {
  return { name: '', description: '', category: 'hair', duration_minutes: '60', buffer_minutes: '0', price_sgd: '', slot_type: 'standard', requires_consult_first: false, consult_service_id: '' };
}

type FormErrors = Partial<Record<keyof ServiceForm, string>>;

function validateForm(form: ServiceForm): FormErrors {
  const e: FormErrors = {};
  if (!form.name.trim()) e.name = 'Service name is required';
  if (!form.description.trim()) e.description = 'Description is required';
  const dur = parseInt(form.duration_minutes, 10);
  if (isNaN(dur) || dur <= 0) e.duration_minutes = 'Duration must be a positive number';
  const buf = parseInt(form.buffer_minutes, 10);
  if (isNaN(buf) || buf < 0) e.buffer_minutes = 'Buffer must be 0 or more';
  const price = parseFloat(form.price_sgd);
  if (isNaN(price) || price <= 0) e.price_sgd = 'Price must be a positive number';
  return e;
}

// ─── Service Modal ─────────────────────────────────────────────────────────────

function ServiceModal({
  initial,
  services,
  onClose,
  onSave,
}: {
  initial: Service | null;
  services: Service[];
  onClose: () => void;
  onSave: () => void;
}) {
  const router = useRouter();
  const [form, setForm] = useState<ServiceForm>(
    initial
      ? {
          name: initial.name,
          description: initial.description,
          category: initial.category,
          duration_minutes: String(initial.durationMinutes),
          buffer_minutes: String(initial.bufferMinutes),
          price_sgd: String(initial.priceSgd),
          slot_type: initial.slotType ?? 'standard',
          requires_consult_first: initial.requiresConsultFirst ?? false,
          consult_service_id: initial.consultServiceId ?? '',
        }
      : blankForm()
  );
  const [errors, setErrors] = useState<FormErrors>({});
  const [saving, setSaving] = useState(false);
  const [apiError, setApiError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const errs = validateForm(form);
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;

    const token = localStorage.getItem('access_token');
    setSaving(true);
    setApiError('');
    try {
      const payload = {
        name: form.name.trim(),
        description: form.description.trim(),
        category: form.category,
        duration_minutes: parseInt(form.duration_minutes, 10),
        buffer_minutes: parseInt(form.buffer_minutes, 10),
        price_sgd: parseFloat(form.price_sgd),
        slot_type: form.slot_type,
        requires_consult_first: form.requires_consult_first,
        consult_service_id: form.consult_service_id || null,
      };
      if (initial) {
        await apiFetch(`/merchant/services/${initial.id}`, {
          method: 'PUT',
          headers: { Authorization: `Bearer ${token}` },
          body: JSON.stringify(payload),
        });
      } else {
        await apiFetch('/merchant/services', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          body: JSON.stringify(payload),
        });
      }
      onSave();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to save';
      if (err instanceof ApiError && err.status === 401) {
        router.push('/login');
      } else {
        setApiError(msg);
      }
    } finally {
      setSaving(false);
    }
  }

  type StringFormKey = { [K in keyof ServiceForm]: ServiceForm[K] extends string ? K : never }[keyof ServiceForm];

  function field(key: StringFormKey) {
    return {
      value: form[key] as string,
      onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
        setForm({ ...form, [key]: e.target.value }),
    };
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <div className="fixed inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg p-6 z-10 max-h-[90vh] overflow-y-auto">
        <h2 className="text-lg font-bold text-gray-900 mb-4">
          {initial ? 'Edit Service' : 'Add Service'}
        </h2>

        {apiError && (
          <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-600">
            {apiError}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Service Name</label>
            <input type="text" {...field('name')} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500" placeholder="e.g. Balayage Treatment" />
            {errors.name && <p className="text-xs text-red-500 mt-1">{errors.name}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
            <textarea {...field('description')} rows={2} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500 resize-none" placeholder="Brief description of the service..." />
            {errors.description && <p className="text-xs text-red-500 mt-1">{errors.description}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
            <select {...field('category')} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500">
              {CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </div>

          {/* Booking Type */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Booking Type</label>
            <select
              value={form.slot_type}
              onChange={(e) => setForm({ ...form, slot_type: e.target.value as 'standard' | 'consult' | 'treatment' })}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="standard">Standard — book directly</option>
              <option value="consult">Consultation — assess client first</option>
              <option value="treatment">Treatment — requires prior consult</option>
            </select>
            <p className="text-xs text-gray-500 mt-1">
              &quot;Consultation&quot; slots let staff assess the client before recommending a treatment.
              &quot;Treatment&quot; slots can be linked to require a consult booking first.
            </p>
          </div>

          {/* Requires Consult First (only shown for treatment type) */}
          {form.slot_type === 'treatment' && (
            <div className="space-y-2">
              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  id="requires_consult_first"
                  checked={form.requires_consult_first}
                  onChange={(e) => setForm({ ...form, requires_consult_first: e.target.checked })}
                  className="w-4 h-4 rounded"
                />
                <label htmlFor="requires_consult_first" className="text-sm text-gray-700">
                  Require consultation booking before this treatment
                </label>
              </div>
              {form.requires_consult_first && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Consultation service (optional)
                  </label>
                  <select
                    value={form.consult_service_id}
                    onChange={(e) => setForm({ ...form, consult_service_id: e.target.value })}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="">— any consultation —</option>
                    {services
                      .filter((s) => s.slotType === 'consult' && s.id !== initial?.id)
                      .map((s) => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                  </select>
                </div>
              )}
            </div>
          )}

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Duration (min)</label>
              <input type="number" min="1" {...field('duration_minutes')} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500" />
              {errors.duration_minutes && <p className="text-xs text-red-500 mt-1">{errors.duration_minutes}</p>}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Buffer (min)</label>
              <input type="number" min="0" {...field('buffer_minutes')} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500" />
              {errors.buffer_minutes && <p className="text-xs text-red-500 mt-1">{errors.buffer_minutes}</p>}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Price (S$)</label>
              <input type="number" min="0.01" step="0.01" {...field('price_sgd')} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500" placeholder="0.00" />
              {errors.price_sgd && <p className="text-xs text-red-500 mt-1">{errors.price_sgd}</p>}
            </div>
          </div>

          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose} className="flex-1 rounded-xl border border-gray-300 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">
              Cancel
            </button>
            <button type="submit" disabled={saving} className="flex-1 rounded-xl bg-indigo-600 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60 transition-colors">
              {saving ? 'Saving...' : (initial ? 'Save Changes' : 'Add Service')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

export default function ServicesPage() {
  const router = useRouter();
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Service | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const fetchServices = useCallback(async () => {
    const token = localStorage.getItem('access_token');
    if (!token) { router.push('/login'); return; }
    try {
      const data = await apiFetch('/merchant/services', {
        headers: { Authorization: `Bearer ${token}` },
      }) as { services: Service[] };
      setServices(data.services ?? []);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load services';
      if (err instanceof ApiError && err.status === 401) {
        router.push('/login');
      } else {
        setError(msg);
      }
    }
  }, [router]);

  useEffect(() => {
    const token = localStorage.getItem('access_token');
    if (!token) { router.push('/login'); return; }
    setLoading(true);
    fetchServices().finally(() => setLoading(false));
  }, [fetchServices, router]);

  async function handleDelete(id: string) {
    if (!confirm('Deactivate this service? It will no longer appear on your booking page.')) return;
    const token = localStorage.getItem('access_token');
    setDeleting(id);
    try {
      await apiFetch(`/merchant/services/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      await fetchServices();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to delete';
      if (err instanceof ApiError && err.status === 401) {
        router.push('/login');
      } else {
        alert(msg);
      }
    } finally {
      setDeleting(null);
    }
  }

  return (
    <>
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Services</h1>
          <p className="text-sm text-gray-500 mt-0.5">{services.length} service{services.length !== 1 ? 's' : ''} configured</p>
        </div>
        <button
          onClick={() => { setEditing(null); setModalOpen(true); }}
          className="flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 transition-colors shadow-sm flex-shrink-0"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          Add Service
        </button>
      </div>

      {loading && <Spinner />}

      {!loading && error && (
        <div className="rounded-xl bg-red-50 border border-red-200 p-6 text-center">
          <p className="text-red-600 font-medium mb-3">{error}</p>
          <button onClick={() => { setError(''); setLoading(true); fetchServices().finally(() => setLoading(false)); }} className="px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700 transition-colors">
            Retry
          </button>
        </div>
      )}

      {!loading && !error && services.length === 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <div className="text-4xl mb-3">✂️</div>
          <h3 className="text-lg font-semibold text-gray-900 mb-1">No services yet</h3>
          <p className="text-sm text-gray-500 mb-4">Add your first service to start accepting bookings.</p>
          <button onClick={() => { setEditing(null); setModalOpen(true); }} className="px-4 py-2 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 transition-colors">
            Add Service
          </button>
        </div>
      )}

      {!loading && !error && services.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {services.map((service) => (
            <div key={service.id} className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm hover:shadow-md transition-shadow">
              <div className="flex items-start justify-between gap-2 mb-3">
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-gray-900 truncate">{service.name}</h3>
                  <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{service.description}</p>
                </div>
                <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium border capitalize ${CATEGORY_COLORS[service.category]}`}>
                    {service.category}
                  </span>
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${service.isActive ? 'bg-green-50 text-green-600 border-green-200' : 'bg-gray-100 text-gray-400 border-gray-200'}`}>
                    {service.isActive ? 'Active' : 'Inactive'}
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2 mb-4">
                <div className="bg-gray-50 rounded-lg p-2 text-center">
                  <p className="text-xs text-gray-500">Duration</p>
                  <p className="text-sm font-semibold text-gray-900">{service.durationMinutes}m</p>
                </div>
                <div className="bg-gray-50 rounded-lg p-2 text-center">
                  <p className="text-xs text-gray-500">Buffer</p>
                  <p className="text-sm font-semibold text-gray-900">{service.bufferMinutes}m</p>
                </div>
                <div className="bg-indigo-50 rounded-lg p-2 text-center">
                  <p className="text-xs text-indigo-500">Price</p>
                  <p className="text-sm font-bold text-indigo-700">S${parseFloat(service.priceSgd).toFixed(2)}</p>
                </div>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => { setEditing(service); setModalOpen(true); }}
                  className="flex-1 py-2 rounded-lg border border-gray-300 text-xs font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  Edit
                </button>
                <button
                  onClick={() => handleDelete(service.id)}
                  disabled={deleting === service.id || !service.isActive}
                  className="flex-1 py-2 rounded-lg border border-red-200 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  {deleting === service.id ? 'Removing...' : (service.isActive ? 'Deactivate' : 'Inactive')}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {modalOpen && (
        <ServiceModal
          initial={editing}
          services={services}
          onClose={() => setModalOpen(false)}
          onSave={() => {
            setModalOpen(false);
            void fetchServices();
          }}
        />
      )}
    </>
  );
}
