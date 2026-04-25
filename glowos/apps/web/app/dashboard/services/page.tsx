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
  visibleOnBookingPage: boolean;
  discountPct: number | null;
  discountShowOnline: boolean;
  firstTimerDiscountPct: number | null;
  firstTimerDiscountEnabled: boolean;
}

interface ServiceForm {
  name: string;
  description: string;
  category: Category;
  duration_minutes: string;
  buffer_minutes: string;
  price_sgd: string;
  // UI-level booking mode — collapses the old three-option slot_type into two
  // choices the merchant actually thinks in: "book directly" vs "requires
  // consultation first". Mapped to slot_type + requires_consult_first on save.
  booking_mode: 'standard' | 'consult_required';
  consult_service_id: string;
  visible_on_booking_page: boolean;
  discount_pct: string;
  discount_show_online: boolean;
  first_timer_discount_pct: string;
  first_timer_discount_enabled: boolean;
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
  hair:    'bg-grey-15 text-grey-75 border-grey-15',
  nails:   'bg-grey-15 text-grey-75 border-grey-15',
  face:    'bg-grey-15 text-tone-ink border-grey-15',
  body:    'bg-tone-sage/10 text-tone-sage border-tone-sage/30',
  massage: 'bg-semantic-warn/10 text-semantic-warn border-semantic-warn/30',
  dining:  'bg-semantic-warn/10 text-semantic-warn border-semantic-warn/30',
  medical: 'bg-grey-15 text-grey-75 border-grey-15',
  other:   'bg-grey-15 text-grey-75 border-grey-15',
};

// ─── Helpers ───────────────────────────────────────────────────────────────────

function Spinner() {
  return (
    <div className="flex items-center justify-center py-16">
      <div className="w-8 h-8 border-4 border-tone-sage/30 border-t-tone-ink rounded-full animate-spin" />
    </div>
  );
}

function blankForm(): ServiceForm {
  return { name: '', description: '', category: 'hair', duration_minutes: '60', buffer_minutes: '0', price_sgd: '', booking_mode: 'standard', consult_service_id: '', visible_on_booking_page: true, discount_pct: '', discount_show_online: false, first_timer_discount_pct: '', first_timer_discount_enabled: false };
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
          // Legacy services stored slot_type separately from the consult-first
          // checkbox. A saved 'consult' or 'treatment' — or any service flagged
          // requires_consult_first — all surface here as consult_required.
          booking_mode:
            initial.slotType !== 'standard' || initial.requiresConsultFirst
              ? 'consult_required'
              : 'standard',
          consult_service_id: initial.consultServiceId ?? '',
          visible_on_booking_page: initial.visibleOnBookingPage ?? true,
          discount_pct: initial.discountPct?.toString() ?? '',
          discount_show_online: initial.discountShowOnline ?? false,
          first_timer_discount_pct: initial.firstTimerDiscountPct?.toString() ?? '',
          first_timer_discount_enabled: initial.firstTimerDiscountEnabled ?? false,
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
        // Map the unified UI toggle back to the underlying slot_type +
        // requires_consult_first pair. "Consult required" stores as a
        // treatment slot with the gating flag set; standard clears both.
        slot_type: form.booking_mode === 'consult_required' ? 'treatment' : 'standard',
        requires_consult_first: form.booking_mode === 'consult_required',
        consult_service_id: form.consult_service_id || null,
        visible_on_booking_page: form.visible_on_booking_page,
        discount_pct: form.discount_pct ? parseInt(form.discount_pct) : null,
        discount_show_online: form.discount_show_online,
        first_timer_discount_pct: form.first_timer_discount_pct ? parseInt(form.first_timer_discount_pct) : null,
        first_timer_discount_enabled: form.first_timer_discount_enabled,
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
      <div className="relative bg-tone-surface rounded-2xl shadow-2xl w-full max-w-lg p-6 z-10 max-h-[90vh] overflow-y-auto">
        <h2 className="text-lg font-bold text-tone-ink mb-4">
          {initial ? 'Edit Service' : 'Add Service'}
        </h2>

        {apiError && (
          <div className="mb-4 rounded-lg bg-semantic-danger/5 border border-semantic-danger/30 px-4 py-3 text-sm text-semantic-danger">
            {apiError}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-grey-75 mb-1">Service Name</label>
            <input type="text" {...field('name')} className="w-full rounded-lg border border-grey-30 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-tone-sage" placeholder="e.g. Balayage Treatment" />
            {errors.name && <p className="text-xs text-semantic-danger mt-1">{errors.name}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium text-grey-75 mb-1">Description</label>
            <textarea {...field('description')} rows={2} className="w-full rounded-lg border border-grey-30 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-tone-sage resize-none" placeholder="Brief description of the service..." />
            {errors.description && <p className="text-xs text-semantic-danger mt-1">{errors.description}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium text-grey-75 mb-1">Category</label>
            <select {...field('category')} className="w-full rounded-lg border border-grey-30 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-tone-sage">
              {CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </div>

          {/* Booking Type */}
          <div>
            <label className="block text-sm font-medium text-grey-75 mb-1">Booking Type</label>
            <select
              value={form.booking_mode}
              onChange={(e) => setForm({ ...form, booking_mode: e.target.value as 'standard' | 'consult_required' })}
              className="w-full rounded-lg border border-grey-30 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-tone-sage"
            >
              <option value="standard">Standard — book directly</option>
              <option value="consult_required">Consultation — requires prior consult</option>
            </select>
            <p className="text-xs text-grey-60 mt-1">
              Services that require consultation first are hidden from the direct-book flow.
              The clinic issues a quote after the consult, and the client pays via that quote link.
            </p>
          </div>

          {/* Visibility on public booking page */}
          <div>
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form.visible_on_booking_page}
                onChange={(e) => setForm({ ...form, visible_on_booking_page: e.target.checked })}
                className="mt-0.5 rounded border-grey-30 text-tone-sage"
              />
              <span className="text-sm text-grey-75">
                Show this service on the public booking page
                <span className="block text-xs text-grey-60 mt-0.5">
                  Uncheck for package-only add-ons that only make sense bundled with another service.
                </span>
              </span>
            </label>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-sm font-medium text-grey-75 mb-1">Duration (min)</label>
              <input type="number" min="1" {...field('duration_minutes')} className="w-full rounded-lg border border-grey-30 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-tone-sage" />
              {errors.duration_minutes && <p className="text-xs text-semantic-danger mt-1">{errors.duration_minutes}</p>}
            </div>
            <div>
              <label className="block text-sm font-medium text-grey-75 mb-1">Buffer (min)</label>
              <input type="number" min="0" {...field('buffer_minutes')} className="w-full rounded-lg border border-grey-30 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-tone-sage" />
              {errors.buffer_minutes && <p className="text-xs text-semantic-danger mt-1">{errors.buffer_minutes}</p>}
            </div>
            <div>
              <label className="block text-sm font-medium text-grey-75 mb-1">Price (S$)</label>
              <input type="number" min="0.01" step="0.01" {...field('price_sgd')} className="w-full rounded-lg border border-grey-30 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-tone-sage" placeholder="0.00" />
              {errors.price_sgd && <p className="text-xs text-semantic-danger mt-1">{errors.price_sgd}</p>}
            </div>
          </div>

          {/* Discount */}
          <div className="border-t border-grey-5 pt-4 mt-4">
            <h4 className="text-xs font-semibold text-grey-60 uppercase tracking-wide mb-3">Discount</h4>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-grey-75 mb-1">Discount (%)</label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={form.discount_pct}
                  onChange={e => setForm({ ...form, discount_pct: e.target.value })}
                  placeholder="0"
                  className="w-full rounded-lg border border-grey-30 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-tone-sage"
                />
              </div>
              <div className="flex items-end pb-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.discount_show_online}
                    onChange={e => setForm({ ...form, discount_show_online: e.target.checked })}
                    className="rounded border-grey-30 text-tone-sage"
                  />
                  <span className="text-sm text-grey-75">Show on booking page</span>
                </label>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 mt-3">
              <div>
                <label className="block text-sm font-medium text-grey-75 mb-1">First-timer discount (%)</label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={form.first_timer_discount_pct}
                  onChange={e => setForm({ ...form, first_timer_discount_pct: e.target.value })}
                  placeholder="0"
                  className="w-full rounded-lg border border-grey-30 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-tone-sage"
                />
              </div>
              <div className="flex items-end pb-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.first_timer_discount_enabled}
                    onChange={e => setForm({ ...form, first_timer_discount_enabled: e.target.checked })}
                    className="rounded border-grey-30 text-tone-sage"
                  />
                  <span className="text-sm text-grey-75">Enable for first-timers</span>
                </label>
              </div>
            </div>
          </div>

          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose} className="flex-1 rounded-xl border border-grey-30 py-2.5 text-sm font-medium text-grey-75 hover:bg-grey-5 transition-colors">
              Cancel
            </button>
            <button type="submit" disabled={saving} className="flex-1 rounded-xl bg-tone-ink py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-60 transition-colors">
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
  const [categoryFilter, setCategoryFilter] = useState<Category | null>(null);
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

  // Per-category counts so empty categories disappear from the filter row
  // automatically — no point showing a "Massage 0" pill if the merchant has
  // no massage services configured.
  const categoryCounts = services.reduce<Record<Category, number>>((acc, s) => {
    acc[s.category] = (acc[s.category] ?? 0) + 1;
    return acc;
  }, { hair: 0, nails: 0, face: 0, body: 0, massage: 0, dining: 0, medical: 0, other: 0 });
  const availableCategories = CATEGORIES.filter((c) => categoryCounts[c.value] > 0);

  const visibleServices = categoryFilter
    ? services.filter((s) => s.category === categoryFilter)
    : services;

  return (
    <>
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-tone-ink">Services</h1>
          <p className="text-sm text-grey-60 mt-0.5">
            {categoryFilter
              ? `${visibleServices.length} of ${services.length} service${services.length !== 1 ? 's' : ''} (filtered)`
              : `${services.length} service${services.length !== 1 ? 's' : ''} configured`}
          </p>
        </div>
        <button
          onClick={() => { setEditing(null); setModalOpen(true); }}
          className="flex items-center gap-2 rounded-xl bg-tone-ink px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90 transition-colors shadow-sm flex-shrink-0"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          Add Service
        </button>
      </div>

      {/* Category filter — only shown when there are 2+ distinct categories
          (single-category merchants don't need to filter). */}
      {!loading && !error && availableCategories.length >= 2 && (
        <div className="mb-5 flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setCategoryFilter(null)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
              categoryFilter === null
                ? 'bg-tone-ink text-white border-tone-ink'
                : 'bg-tone-surface text-grey-75 border-grey-15 hover:bg-grey-5'
            }`}
          >
            All ({services.length})
          </button>
          {availableCategories.map((c) => {
            const selected = categoryFilter === c.value;
            return (
              <button
                key={c.value}
                type="button"
                onClick={() => setCategoryFilter(selected ? null : c.value)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                  selected
                    ? 'bg-tone-ink text-white border-tone-ink'
                    : 'bg-tone-surface text-grey-75 border-grey-15 hover:bg-grey-5'
                }`}
              >
                {c.label} ({categoryCounts[c.value]})
              </button>
            );
          })}
        </div>
      )}

      {loading && <Spinner />}

      {!loading && error && (
        <div className="rounded-xl bg-semantic-danger/5 border border-semantic-danger/30 p-6 text-center">
          <p className="text-semantic-danger font-medium mb-3">{error}</p>
          <button onClick={() => { setError(''); setLoading(true); fetchServices().finally(() => setLoading(false)); }} className="px-4 py-2 rounded-lg bg-semantic-danger text-white text-sm font-medium hover:bg-semantic-danger transition-colors">
            Retry
          </button>
        </div>
      )}

      {!loading && !error && services.length === 0 && (
        <div className="bg-tone-surface rounded-xl border border-grey-15 p-12 text-center">
          <div className="text-4xl mb-3">✂️</div>
          <h3 className="text-lg font-semibold text-tone-ink mb-1">No services yet</h3>
          <p className="text-sm text-grey-60 mb-4">Add your first service to start accepting bookings.</p>
          <button onClick={() => { setEditing(null); setModalOpen(true); }} className="px-4 py-2 rounded-xl bg-tone-ink text-white text-sm font-semibold hover:opacity-90 transition-colors">
            Add Service
          </button>
        </div>
      )}

      {!loading && !error && services.length > 0 && visibleServices.length === 0 && (
        <div className="bg-tone-surface rounded-xl border border-grey-15 p-10 text-center">
          <p className="text-sm text-grey-60 mb-3">
            No services in this category. Try a different filter.
          </p>
          <button
            type="button"
            onClick={() => setCategoryFilter(null)}
            className="text-xs font-medium text-tone-sage hover:underline"
          >
            Clear filter
          </button>
        </div>
      )}

      {!loading && !error && visibleServices.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {visibleServices.map((service) => (
            <div key={service.id} className="bg-tone-surface rounded-xl border border-grey-15 p-5 shadow-sm hover:shadow-md transition-shadow">
              <div className="flex items-start justify-between gap-2 mb-3">
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-tone-ink truncate">{service.name}</h3>
                  <p className="text-xs text-grey-60 mt-0.5 line-clamp-2">{service.description}</p>
                </div>
                <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium border capitalize ${CATEGORY_COLORS[service.category]}`}>
                    {service.category}
                  </span>
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${service.isActive ? 'bg-tone-sage/5 text-tone-sage border-tone-sage/30' : 'bg-grey-15 text-grey-45 border-grey-15'}`}>
                    {service.isActive ? 'Active' : 'Inactive'}
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2 mb-4">
                <div className="bg-grey-5 rounded-lg p-2 text-center">
                  <p className="text-xs text-grey-60">Duration</p>
                  <p className="text-sm font-semibold text-tone-ink">{service.durationMinutes}m</p>
                </div>
                <div className="bg-grey-5 rounded-lg p-2 text-center">
                  <p className="text-xs text-grey-60">Buffer</p>
                  <p className="text-sm font-semibold text-tone-ink">{service.bufferMinutes}m</p>
                </div>
                <div className="bg-tone-sage/10 rounded-lg p-2 text-center">
                  <p className="text-xs text-tone-sage">Price</p>
                  <p className="text-sm font-bold text-tone-sage">S${parseFloat(service.priceSgd).toFixed(2)}</p>
                </div>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => { setEditing(service); setModalOpen(true); }}
                  className="flex-1 py-2 rounded-lg border border-grey-30 text-xs font-medium text-grey-75 hover:bg-grey-5 transition-colors"
                >
                  Edit
                </button>
                <button
                  onClick={() => handleDelete(service.id)}
                  disabled={deleting === service.id || !service.isActive}
                  className="flex-1 py-2 rounded-lg border border-semantic-danger/30 text-xs font-medium text-semantic-danger hover:bg-semantic-danger/5 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
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
