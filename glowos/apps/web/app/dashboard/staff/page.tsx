'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch, ApiError } from '../../lib/api';

// ─── Types ─────────────────────────────────────────────────────────────────────

interface ServiceOption {
  id: string;
  name: string;
}

interface WorkingHour {
  day_of_week: number;
  start_time: string;
  end_time: string;
  is_working: boolean;
}

interface StaffMember {
  id: string;
  name: string;
  title: string | null;
  photoUrl: string | null;
  isActive: boolean;
  isAnyAvailable: boolean;
  service_ids: string[];
}

interface StaffForm {
  name: string;
  title: string;
  photo_url: string;
  is_any_available: boolean;
  service_ids: string[];
  working_hours: WorkingHour[];
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DEFAULT_HOURS: WorkingHour[] = DAYS.map((_, i) => ({
  day_of_week: i,
  start_time: '09:00',
  end_time: '18:00',
  is_working: i >= 1 && i <= 5, // Mon–Fri on by default
}));

function Spinner() {
  return (
    <div className="flex items-center justify-center py-16">
      <div className="w-8 h-8 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin" />
    </div>
  );
}

function blankForm(): StaffForm {
  return {
    name: '',
    title: '',
    photo_url: '',
    is_any_available: false,
    service_ids: [],
    working_hours: DEFAULT_HOURS,
  };
}

type FormErrors = Partial<{ name: string; service_ids: string }>;

function validateForm(form: StaffForm): FormErrors {
  const e: FormErrors = {};
  if (!form.name.trim()) e.name = 'Staff name is required';
  return e;
}

// ─── Staff Modal ───────────────────────────────────────────────────────────────

function StaffModal({
  initial,
  services,
  onClose,
  onSave,
}: {
  initial: StaffMember | null;
  services: ServiceOption[];
  onClose: () => void;
  onSave: () => void;
}) {
  const router = useRouter();

  function buildInitialForm(): StaffForm {
    if (!initial) return blankForm();
    return {
      name: initial.name,
      title: initial.title ?? '',
      photo_url: initial.photoUrl ?? '',
      is_any_available: initial.isAnyAvailable,
      service_ids: initial.service_ids ?? [],
      working_hours: DEFAULT_HOURS,
    };
  }

  const [form, setForm] = useState<StaffForm>(buildInitialForm);
  const [errors, setErrors] = useState<FormErrors>({});
  const [saving, setSaving] = useState(false);
  const [apiError, setApiError] = useState('');

  function toggleService(id: string) {
    setForm((prev) => ({
      ...prev,
      service_ids: prev.service_ids.includes(id)
        ? prev.service_ids.filter((s) => s !== id)
        : [...prev.service_ids, id],
    }));
  }

  function updateHour(dayIdx: number, field: keyof WorkingHour, value: string | boolean) {
    setForm((prev) => ({
      ...prev,
      working_hours: prev.working_hours.map((wh) =>
        wh.day_of_week === dayIdx ? { ...wh, [field]: value } : wh
      ),
    }));
  }

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
        title: form.title.trim() || undefined,
        photo_url: form.photo_url.trim() || undefined,
        is_any_available: form.is_any_available,
        service_ids: form.service_ids,
        working_hours: form.working_hours,
      };
      if (initial) {
        await apiFetch(`/merchant/staff/${initial.id}`, {
          method: 'PUT',
          headers: { Authorization: `Bearer ${token}` },
          body: JSON.stringify(payload),
        });
      } else {
        await apiFetch('/merchant/staff', {
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <div className="fixed inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-xl p-6 z-10 max-h-[90vh] overflow-y-auto">
        <h2 className="text-lg font-bold text-gray-900 mb-4">
          {initial ? 'Edit Staff Member' : 'Add Staff Member'}
        </h2>

        {apiError && (
          <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-600">
            {apiError}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Basic info */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                placeholder="Jane"
              />
              {errors.name && <p className="text-xs text-red-500 mt-1">{errors.name}</p>}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Title</label>
              <input
                type="text"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                placeholder="e.g. Senior Therapist, Head Chef"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Photo URL (optional)</label>
            <input
              type="url"
              value={form.photo_url}
              onChange={(e) => setForm({ ...form, photo_url: e.target.value })}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="https://..."
            />
          </div>

          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id="any-available"
              checked={form.is_any_available}
              onChange={(e) => setForm({ ...form, is_any_available: e.target.checked })}
              className="w-4 h-4 text-indigo-600 rounded border-gray-300 focus:ring-indigo-500"
            />
            <label htmlFor="any-available" className="text-sm text-gray-700">
              Available as &ldquo;Any available staff&rdquo;
            </label>
          </div>

          {/* Services multi-select */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Assigned Services</label>
            {services.length === 0 ? (
              <p className="text-sm text-gray-400 italic">No services available. Add services first.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {services.map((s) => {
                  const selected = form.service_ids.includes(s.id);
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => toggleService(s.id)}
                      className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                        selected
                          ? 'bg-indigo-600 text-white border-indigo-600'
                          : 'bg-white text-gray-600 border-gray-300 hover:border-indigo-400'
                      }`}
                    >
                      {s.name}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Working hours grid */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Working Hours</label>
            <div className="space-y-2">
              {form.working_hours.map((wh) => (
                <div key={wh.day_of_week} className="flex items-center gap-3">
                  <div className="w-24 flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={wh.is_working}
                      onChange={(e) => updateHour(wh.day_of_week, 'is_working', e.target.checked)}
                      className="w-4 h-4 text-indigo-600 rounded border-gray-300 focus:ring-indigo-500 flex-shrink-0"
                    />
                    <span className={`text-xs font-medium ${wh.is_working ? 'text-gray-900' : 'text-gray-400'}`}>
                      {DAYS[wh.day_of_week]?.slice(0, 3)}
                    </span>
                  </div>
                  <input
                    type="time"
                    value={wh.start_time}
                    disabled={!wh.is_working}
                    onChange={(e) => updateHour(wh.day_of_week, 'start_time', e.target.value)}
                    className="rounded-lg border border-gray-300 px-2 py-1 text-xs outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-40 disabled:bg-gray-50"
                  />
                  <span className="text-xs text-gray-400">to</span>
                  <input
                    type="time"
                    value={wh.end_time}
                    disabled={!wh.is_working}
                    onChange={(e) => updateHour(wh.day_of_week, 'end_time', e.target.value)}
                    className="rounded-lg border border-gray-300 px-2 py-1 text-xs outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-40 disabled:bg-gray-50"
                  />
                </div>
              ))}
            </div>
          </div>

          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose} className="flex-1 rounded-xl border border-gray-300 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">
              Cancel
            </button>
            <button type="submit" disabled={saving} className="flex-1 rounded-xl bg-indigo-600 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60 transition-colors">
              {saving ? 'Saving...' : (initial ? 'Save Changes' : 'Add Staff')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Staff Card ────────────────────────────────────────────────────────────────

function StaffCard({
  member,
  services,
  onEdit,
  onDelete,
  deleting,
}: {
  member: StaffMember;
  services: ServiceOption[];
  onEdit: () => void;
  onDelete: () => void;
  deleting: boolean;
}) {
  const assignedServices = services.filter((s) => member.service_ids.includes(s.id));

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm hover:shadow-md transition-shadow">
      <div className="flex items-start gap-4 mb-3">
        {member.photoUrl ? (
          <img src={member.photoUrl} alt={member.name} className="w-14 h-14 rounded-xl object-cover flex-shrink-0" />
        ) : (
          <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-indigo-100 to-purple-100 flex items-center justify-center flex-shrink-0">
            <span className="text-xl font-bold text-indigo-600">{member.name.charAt(0).toUpperCase()}</span>
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-gray-900 truncate">{member.name}</h3>
            <span className={`px-1.5 py-0.5 rounded-full text-xs font-medium border flex-shrink-0 ${member.isActive ? 'bg-green-50 text-green-600 border-green-200' : 'bg-gray-100 text-gray-400 border-gray-200'}`}>
              {member.isActive ? 'Active' : 'Inactive'}
            </span>
          </div>
          {member.title && (
            <p className="text-sm text-gray-500 mt-0.5">{member.title}</p>
          )}
          {member.isAnyAvailable && (
            <p className="text-xs text-indigo-600 mt-1">Available as &ldquo;Any staff&rdquo;</p>
          )}
        </div>
      </div>

      {assignedServices.length > 0 && (
        <div className="mb-3">
          <p className="text-xs text-gray-500 mb-1.5">Services</p>
          <div className="flex flex-wrap gap-1.5">
            {assignedServices.map((s) => (
              <span key={s.id} className="px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 text-xs border border-indigo-200">
                {s.name}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="flex gap-2">
        <button onClick={onEdit} className="flex-1 py-2 rounded-lg border border-gray-300 text-xs font-medium text-gray-700 hover:bg-gray-50 transition-colors">
          Edit
        </button>
        <button
          onClick={onDelete}
          disabled={deleting || !member.isActive}
          className="flex-1 py-2 rounded-lg border border-red-200 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {deleting ? 'Removing...' : (member.isActive ? 'Deactivate' : 'Inactive')}
        </button>
      </div>
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

export default function StaffPage() {
  const router = useRouter();
  const [staffList, setStaffList] = useState<StaffMember[]>([]);
  const [services, setServices] = useState<ServiceOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<StaffMember | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const fetchStaff = useCallback(async () => {
    const token = localStorage.getItem('access_token');
    if (!token) { router.push('/login'); return; }
    try {
      const data = await apiFetch('/merchant/staff', {
        headers: { Authorization: `Bearer ${token}` },
      }) as { staff: StaffMember[] };
      setStaffList(data.staff ?? []);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load staff';
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
    Promise.all([
      apiFetch('/merchant/staff', { headers: { Authorization: `Bearer ${token}` } }) as Promise<{ staff: StaffMember[] }>,
      apiFetch('/merchant/services', { headers: { Authorization: `Bearer ${token}` } }) as Promise<{ services: ServiceOption[] }>,
    ])
      .then(([staffData, servicesData]) => {
        setStaffList(staffData.staff ?? []);
        setServices(servicesData.services ?? []);
      })
      .catch((err) => {
        const msg = err instanceof Error ? err.message : 'Failed to load data';
        if (err instanceof ApiError && err.status === 401) {
          router.push('/login');
        } else {
          setError(msg);
        }
      })
      .finally(() => setLoading(false));
  }, [router]);

  async function handleDelete(id: string) {
    if (!confirm('Deactivate this staff member?')) return;
    const token = localStorage.getItem('access_token');
    setDeleting(id);
    try {
      await apiFetch(`/merchant/staff/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      await fetchStaff();
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
          <h1 className="text-2xl font-bold text-gray-900">Staff</h1>
          <p className="text-sm text-gray-500 mt-0.5">{staffList.length} team member{staffList.length !== 1 ? 's' : ''}</p>
        </div>
        <button
          onClick={() => { setEditing(null); setModalOpen(true); }}
          className="flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 transition-colors shadow-sm flex-shrink-0"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          Add Staff
        </button>
      </div>

      {loading && <Spinner />}

      {!loading && error && (
        <div className="rounded-xl bg-red-50 border border-red-200 p-6 text-center">
          <p className="text-red-600 font-medium mb-3">{error}</p>
          <button
            onClick={() => { setError(''); setLoading(true); fetchStaff().finally(() => setLoading(false)); }}
            className="px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700 transition-colors"
          >
            Retry
          </button>
        </div>
      )}

      {!loading && !error && staffList.length === 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <div className="text-4xl mb-3">👥</div>
          <h3 className="text-lg font-semibold text-gray-900 mb-1">No staff yet</h3>
          <p className="text-sm text-gray-500 mb-4">Add your first staff member to start managing bookings.</p>
          <button onClick={() => { setEditing(null); setModalOpen(true); }} className="px-4 py-2 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 transition-colors">
            Add Staff
          </button>
        </div>
      )}

      {!loading && !error && staffList.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {staffList.map((member) => (
            <StaffCard
              key={member.id}
              member={member}
              services={services}
              onEdit={() => { setEditing(member); setModalOpen(true); }}
              onDelete={() => handleDelete(member.id)}
              deleting={deleting === member.id}
            />
          ))}
        </div>
      )}

      {modalOpen && (
        <StaffModal
          initial={editing}
          services={services}
          onClose={() => setModalOpen(false)}
          onSave={() => {
            setModalOpen(false);
            void fetchStaff();
          }}
        />
      )}
    </>
  );
}
