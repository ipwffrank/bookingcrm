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
  isPubliclyVisible: boolean;
  bio: string | null;
  specialtyTags: string[] | null;
  credentials: string | null;
}

interface StaffForm {
  name: string;
  title: string;
  photo_url: string;
  is_any_available: boolean;
  service_ids: string[];
  working_hours: WorkingHour[];
  is_publicly_visible: boolean;
  bio: string;
  specialty_tags: string;
  credentials: string;
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
      <div className="w-8 h-8 border-4 border-tone-sage/30 border-t-tone-ink rounded-full animate-spin" />
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
    is_publicly_visible: true,
    bio: '',
    specialty_tags: '',
    credentials: '',
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
      is_publicly_visible: initial.isPubliclyVisible ?? true,
      bio: initial.bio ?? '',
      specialty_tags: (initial.specialtyTags ?? []).join(', '),
      credentials: initial.credentials ?? '',
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
      let savedStaffId: string;
      if (initial) {
        await apiFetch(`/merchant/staff/${initial.id}`, {
          method: 'PUT',
          headers: { Authorization: `Bearer ${token}` },
          body: JSON.stringify(payload),
        });
        savedStaffId = initial.id;
      } else {
        const created = await apiFetch('/merchant/staff', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          body: JSON.stringify(payload),
        }) as { staff: { id: string } };
        savedStaffId = created.staff.id;
      }

      // Save profile fields
      const profileBody: Record<string, unknown> = {
        is_publicly_visible: form.is_publicly_visible,
      };
      profileBody.bio = form.bio || undefined;
      profileBody.credentials = form.credentials || undefined;
      profileBody.specialty_tags = form.specialty_tags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
      // specialty_tags: empty array = clear all tags

      await apiFetch(`/merchant/staff/${savedStaffId}/profile`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}` },
        body: JSON.stringify(profileBody),
      });

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
      <div className="relative bg-tone-surface rounded-2xl shadow-2xl w-full max-w-xl p-6 z-10 max-h-[90vh] overflow-y-auto">
        <h2 className="text-lg font-bold text-tone-ink mb-4">
          {initial ? 'Edit Staff Member' : 'Add Staff Member'}
        </h2>

        {apiError && (
          <div className="mb-4 rounded-lg bg-semantic-danger/5 border border-semantic-danger/30 px-4 py-3 text-sm text-semantic-danger">
            {apiError}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Basic info */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-grey-75 mb-1">Name</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full rounded-lg border border-grey-30 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-tone-sage"
                placeholder="Jane"
              />
              {errors.name && <p className="text-xs text-semantic-danger mt-1">{errors.name}</p>}
            </div>
            <div>
              <label className="block text-sm font-medium text-grey-75 mb-1">Title</label>
              <input
                type="text"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                className="w-full rounded-lg border border-grey-30 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-tone-sage"
                placeholder="e.g. Senior Therapist, Head Chef"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-grey-75 mb-1">Photo URL (optional)</label>
            <input
              type="url"
              value={form.photo_url}
              onChange={(e) => setForm({ ...form, photo_url: e.target.value })}
              className="w-full rounded-lg border border-grey-30 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-tone-sage"
              placeholder="https://..."
            />
          </div>

          {/* Bio */}
          <div>
            <label className="block text-sm font-medium text-grey-75 mb-1">Bio</label>
            <textarea
              value={form.bio}
              onChange={(e) => setForm({ ...form, bio: e.target.value })}
              rows={3}
              className="w-full rounded-lg border border-grey-30 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-tone-sage"
              placeholder="Brief introduction for clients..."
              maxLength={1000}
            />
          </div>

          {/* Specialty Tags */}
          <div>
            <label className="block text-sm font-medium text-grey-75 mb-1">
              Specialty Tags <span className="text-grey-45 font-normal">(comma-separated)</span>
            </label>
            <input
              type="text"
              value={form.specialty_tags}
              onChange={(e) => setForm({ ...form, specialty_tags: e.target.value })}
              className="w-full rounded-lg border border-grey-30 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-tone-sage"
              placeholder="e.g. Laser, Acne Treatment, Anti-ageing"
            />
          </div>

          {/* Credentials */}
          <div>
            <label className="block text-sm font-medium text-grey-75 mb-1">Credentials</label>
            <input
              type="text"
              value={form.credentials}
              onChange={(e) => setForm({ ...form, credentials: e.target.value })}
              className="w-full rounded-lg border border-grey-30 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-tone-sage"
              placeholder="e.g. MBBS, NUS Dermatology Cert"
              maxLength={500}
            />
          </div>

          {/* Publicly Visible */}
          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id="is_publicly_visible"
              checked={form.is_publicly_visible}
              onChange={(e) => setForm({ ...form, is_publicly_visible: e.target.checked })}
              className="w-4 h-4 text-tone-sage rounded border-grey-30 focus:ring-tone-sage"
            />
            <label htmlFor="is_publicly_visible" className="text-sm text-grey-75">
              Show profile on public booking page
            </label>
          </div>

          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id="any-available"
              checked={form.is_any_available}
              onChange={(e) => setForm({ ...form, is_any_available: e.target.checked })}
              className="w-4 h-4 text-tone-sage rounded border-grey-30 focus:ring-tone-sage"
            />
            <label htmlFor="any-available" className="text-sm text-grey-75">
              Available as &ldquo;Any available staff&rdquo;
            </label>
          </div>

          {/* Services multi-select */}
          <div>
            <label className="block text-sm font-medium text-grey-75 mb-2">Assigned Services</label>
            {services.length === 0 ? (
              <p className="text-sm text-grey-45 italic">No services available. Add services first.</p>
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
                          ? 'bg-tone-ink text-white border-tone-ink'
                          : 'bg-tone-surface text-grey-75 border-grey-30 hover:border-tone-sage'
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
            <label className="block text-sm font-medium text-grey-75 mb-2">Working Hours</label>
            <div className="space-y-2">
              {form.working_hours.map((wh) => (
                <div key={wh.day_of_week} className="flex items-center gap-3">
                  <div className="w-24 flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={wh.is_working}
                      onChange={(e) => updateHour(wh.day_of_week, 'is_working', e.target.checked)}
                      className="w-4 h-4 text-tone-sage rounded border-grey-30 focus:ring-tone-sage flex-shrink-0"
                    />
                    <span className={`text-xs font-medium ${wh.is_working ? 'text-tone-ink' : 'text-grey-45'}`}>
                      {DAYS[wh.day_of_week]?.slice(0, 3)}
                    </span>
                  </div>
                  <input
                    type="time"
                    value={wh.start_time}
                    disabled={!wh.is_working}
                    onChange={(e) => updateHour(wh.day_of_week, 'start_time', e.target.value)}
                    className="rounded-lg border border-grey-30 px-2 py-1 text-xs outline-none focus:ring-2 focus:ring-tone-sage disabled:opacity-40 disabled:bg-grey-5"
                  />
                  <span className="text-xs text-grey-45">to</span>
                  <input
                    type="time"
                    value={wh.end_time}
                    disabled={!wh.is_working}
                    onChange={(e) => updateHour(wh.day_of_week, 'end_time', e.target.value)}
                    className="rounded-lg border border-grey-30 px-2 py-1 text-xs outline-none focus:ring-2 focus:ring-tone-sage disabled:opacity-40 disabled:bg-grey-5"
                  />
                </div>
              ))}
            </div>
          </div>

          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose} className="flex-1 rounded-xl border border-grey-30 py-2.5 text-sm font-medium text-grey-75 hover:bg-grey-5 transition-colors">
              Cancel
            </button>
            <button type="submit" disabled={saving} className="flex-1 rounded-xl bg-tone-ink py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-60 transition-colors">
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
  loginEmail,
  loginRole,
  loginSecondaryRole,
  callerIsOwner,
  onCreateLogin,
  onResetPassword,
  onChangeRole,
  onChangeSecondaryRole,
}: {
  member: StaffMember;
  services: ServiceOption[];
  onEdit: () => void;
  onDelete: () => void;
  deleting: boolean;
  loginEmail?: string;
  loginRole?: 'staff' | 'manager' | 'clinician' | 'owner';
  loginSecondaryRole?: 'staff' | 'manager' | 'clinician' | 'owner' | null;
  callerIsOwner: boolean;
  onCreateLogin: () => void;
  onResetPassword: () => void;
  onChangeRole: (role: 'staff' | 'manager' | 'clinician') => void;
  onChangeSecondaryRole: (role: 'staff' | 'manager' | 'clinician' | 'owner' | null) => void;
}) {
  const assignedServices = services.filter((s) => member.service_ids.includes(s.id));

  return (
    <div className="bg-tone-surface rounded-xl border border-grey-15 p-5 shadow-sm hover:shadow-md transition-shadow">
      <div className="flex items-start gap-4 mb-3">
        {member.photoUrl ? (
          <img src={member.photoUrl} alt={member.name} className="w-14 h-14 rounded-xl object-cover flex-shrink-0" />
        ) : (
          <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-indigo-100 to-purple-100 flex items-center justify-center flex-shrink-0">
            <span className="text-xl font-bold text-tone-sage">{member.name.charAt(0).toUpperCase()}</span>
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-tone-ink truncate">{member.name}</h3>
            <span className={`px-1.5 py-0.5 rounded-full text-xs font-medium border flex-shrink-0 ${member.isActive ? 'bg-tone-sage/5 text-tone-sage border-tone-sage/30' : 'bg-grey-15 text-grey-45 border-grey-15'}`}>
              {member.isActive ? 'Active' : 'Inactive'}
            </span>
          </div>
          {member.title && (
            <p className="text-sm text-grey-60 mt-0.5">{member.title}</p>
          )}
          {member.isAnyAvailable && (
            <p className="text-xs text-tone-sage mt-1">Available as &ldquo;Any staff&rdquo;</p>
          )}
          {/* Login badge / Create Login button + role */}
          {loginEmail ? (
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <span className="text-xs text-tone-sage bg-tone-sage/5 px-2 py-0.5 rounded-full border border-tone-sage/30">
                Login: {loginEmail}
              </span>
              {loginRole === 'manager' && (
                <span className="text-xs text-tone-ink bg-tone-ink/5 px-2 py-0.5 rounded-full border border-tone-ink/30">
                  Manager
                </span>
              )}
              {loginRole === 'clinician' && (
                <span className="text-xs text-tone-sage bg-tone-sage/10 px-2 py-0.5 rounded-full border border-tone-sage/30">
                  Clinician
                </span>
              )}
              {loginRole === 'owner' && (
                <span className="text-xs text-tone-ink bg-tone-ink/10 px-2 py-0.5 rounded-full border border-tone-ink/40 font-medium">
                  Owner
                </span>
              )}
              {loginSecondaryRole && (
                <span className="text-xs text-grey-75 bg-grey-5 px-2 py-0.5 rounded-full border border-grey-15">
                  + {loginSecondaryRole.charAt(0).toUpperCase() + loginSecondaryRole.slice(1)}
                </span>
              )}
              <button
                onClick={onResetPassword}
                className="text-xs text-grey-60 hover:text-grey-75 underline"
              >
                Reset Password
              </button>
              {callerIsOwner && loginRole !== 'owner' && (
                <select
                  value={loginRole ?? 'staff'}
                  onChange={(e) => onChangeRole(e.target.value as 'staff' | 'manager' | 'clinician')}
                  className="text-xs border border-grey-15 rounded px-1.5 py-0.5"
                  title="Primary role"
                >
                  <option value="staff">Staff</option>
                  <option value="manager">Manager</option>
                  <option value="clinician">Clinician</option>
                </select>
              )}
              {/* Secondary role — owner can grant a second authority on top
                  of the primary role. Most common case: a clinician who
                  also manages or owns the firm. Disabled options are the
                  one matching the primary role (the DB CHECK constraint
                  rejects same-as-primary anyway). */}
              {callerIsOwner && (
                <select
                  value={loginSecondaryRole ?? ''}
                  onChange={(e) => {
                    const v = e.target.value;
                    onChangeSecondaryRole(v === '' ? null : (v as 'staff' | 'manager' | 'clinician' | 'owner'));
                  }}
                  className="text-xs border border-grey-15 rounded px-1.5 py-0.5"
                  title="Secondary role (optional) — adds permissions on top of the primary role"
                >
                  <option value="">+ Secondary…</option>
                  <option value="owner" disabled={loginRole === 'owner'}>Owner</option>
                  <option value="manager" disabled={loginRole === 'manager'}>Manager</option>
                  <option value="clinician" disabled={loginRole === 'clinician'}>Clinician</option>
                  <option value="staff" disabled={loginRole === 'staff'}>Staff</option>
                </select>
              )}
            </div>
          ) : (
            <button
              onClick={onCreateLogin}
              className="mt-1 text-xs text-tone-sage hover:text-tone-sage underline"
            >
              + Create Login
            </button>
          )}
        </div>
      </div>

      {assignedServices.length > 0 && (
        <div className="mb-3">
          <p className="text-xs text-grey-60 mb-1.5">Services</p>
          <div className="flex flex-wrap gap-1.5">
            {assignedServices.map((s) => (
              <span key={s.id} className="px-2 py-0.5 rounded-full bg-tone-sage/10 text-tone-sage text-xs border border-tone-sage/30">
                {s.name}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="flex gap-2">
        <button onClick={onEdit} className="flex-1 py-2 rounded-lg border border-grey-30 text-xs font-medium text-grey-75 hover:bg-grey-5 transition-colors">
          Edit
        </button>
        <button
          onClick={onDelete}
          disabled={deleting || !member.isActive}
          className="flex-1 py-2 rounded-lg border border-semantic-danger/30 text-xs font-medium text-semantic-danger hover:bg-semantic-danger/5 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
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
  const [staffLogins, setStaffLogins] = useState<Record<string, { email: string; role: 'staff' | 'manager' | 'clinician' | 'owner'; secondaryRole?: 'staff' | 'manager' | 'clinician' | 'owner' | null }>>({});
  const [callerRole, setCallerRole] = useState<'staff' | 'manager' | 'clinician' | 'owner' | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const u = JSON.parse(localStorage.getItem('user') ?? '{}');
      if (u.role === 'staff' || u.role === 'manager' || u.role === 'clinician' || u.role === 'owner') {
        setCallerRole(u.role);
      }
    } catch { /* ignore */ }
  }, []);

  async function changeRole(staffId: string, newRole: 'staff' | 'manager' | 'clinician') {
    const current = staffLogins[staffId];
    if (!current) return;
    // If the new primary role equals the existing secondary role, clear
    // the secondary — same value on both is meaningless and the DB CHECK
    // constraint would reject it on the next save anyway.
    const nextSecondary = current.secondaryRole === newRole ? null : current.secondaryRole;
    setStaffLogins((prev) => ({ ...prev, [staffId]: { ...current, role: newRole, secondaryRole: nextSecondary } }));
    try {
      await apiFetch(`/merchant/staff/${staffId}/role`, {
        method: 'PATCH',
        body: JSON.stringify({ role: newRole }),
      });
    } catch (err) {
      // Revert optimistic update
      setStaffLogins((prev) => ({ ...prev, [staffId]: current }));
      const msg = err instanceof ApiError ? err.message ?? 'Failed to change role' : 'Failed to change role';
      alert(msg);
    }
  }

  async function changeSecondaryRole(
    staffId: string,
    newSecondary: 'staff' | 'manager' | 'clinician' | 'owner' | null,
  ) {
    const current = staffLogins[staffId];
    if (!current) return;
    setStaffLogins((prev) => ({ ...prev, [staffId]: { ...current, secondaryRole: newSecondary } }));
    try {
      await apiFetch(`/merchant/staff/${staffId}/secondary-role`, {
        method: 'PATCH',
        body: JSON.stringify({ secondary_role: newSecondary }),
      });
    } catch (err) {
      setStaffLogins((prev) => ({ ...prev, [staffId]: current }));
      const msg = err instanceof ApiError ? err.message ?? 'Failed to change secondary role' : 'Failed to change secondary role';
      alert(msg);
    }
  }
  const [loginModal, setLoginModal] = useState<{ staffId: string; name: string } | null>(null);
  const [loginForm, setLoginForm] = useState({ email: '', password: '' });
  const [loginError, setLoginError] = useState('');

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
        // Fetch which staff have logins
        apiFetch('/merchant/staff/logins').then((d: { logins: Array<{ staffId: string; email: string; role: 'staff' | 'manager' | 'clinician' | 'owner'; secondaryRole?: 'staff' | 'manager' | 'clinician' | 'owner' | null }> }) => {
          const map: Record<string, { email: string; role: 'staff' | 'manager' | 'clinician' | 'owner'; secondaryRole?: 'staff' | 'manager' | 'clinician' | 'owner' | null }> = {};
          (d.logins ?? []).forEach((l) => { if (l.staffId) map[l.staffId] = { email: l.email, role: l.role, secondaryRole: l.secondaryRole ?? null }; });
          setStaffLogins(map);
        }).catch(() => {});
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
          <h1 className="text-2xl font-bold text-tone-ink">Staff</h1>
          <p className="text-sm text-grey-60 mt-0.5">{staffList.length} team member{staffList.length !== 1 ? 's' : ''}</p>
        </div>
        <button
          onClick={() => { setEditing(null); setModalOpen(true); }}
          className="flex items-center gap-2 rounded-xl bg-tone-ink px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90 transition-colors shadow-sm flex-shrink-0"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          Add Staff
        </button>
      </div>

      {loading && <Spinner />}

      {!loading && error && (
        <div className="rounded-xl bg-semantic-danger/5 border border-semantic-danger/30 p-6 text-center">
          <p className="text-semantic-danger font-medium mb-3">{error}</p>
          <button
            onClick={() => { setError(''); setLoading(true); fetchStaff().finally(() => setLoading(false)); }}
            className="px-4 py-2 rounded-lg bg-semantic-danger text-white text-sm font-medium hover:bg-semantic-danger transition-colors"
          >
            Retry
          </button>
        </div>
      )}

      {!loading && !error && staffList.length === 0 && (
        <div className="bg-tone-surface rounded-xl border border-grey-15 p-12 text-center">
          <div className="text-4xl mb-3">👥</div>
          <h3 className="text-lg font-semibold text-tone-ink mb-1">No staff yet</h3>
          <p className="text-sm text-grey-60 mb-4">Add your first staff member to start managing bookings.</p>
          <button onClick={() => { setEditing(null); setModalOpen(true); }} className="px-4 py-2 rounded-xl bg-tone-ink text-white text-sm font-semibold hover:opacity-90 transition-colors">
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
              loginEmail={staffLogins[member.id]?.email}
              loginRole={staffLogins[member.id]?.role}
              loginSecondaryRole={staffLogins[member.id]?.secondaryRole ?? null}
              callerIsOwner={callerRole === 'owner'}
              onCreateLogin={() => { setLoginModal({ staffId: member.id, name: member.name }); setLoginForm({ email: '', password: '' }); setLoginError(''); }}
              onResetPassword={() => { setLoginModal({ staffId: member.id, name: member.name }); setLoginForm({ email: staffLogins[member.id]?.email ?? '', password: '' }); setLoginError(''); }}
              onChangeRole={(newRole) => changeRole(member.id, newRole)}
              onChangeSecondaryRole={(newSecondary) => changeSecondaryRole(member.id, newSecondary)}
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

      {loginModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-tone-surface rounded-xl shadow-xl w-full max-w-sm p-6 space-y-4">
            <h2 className="text-lg font-semibold">
              {staffLogins[loginModal.staffId]?.email ? 'Reset Password' : 'Create Login'} — {loginModal.name}
            </h2>
            {!staffLogins[loginModal.staffId]?.email && (
              <div>
                <label className="block text-xs font-medium text-grey-75 mb-1">Email</label>
                <input
                  type="email"
                  value={loginForm.email}
                  onChange={e => setLoginForm(f => ({ ...f, email: e.target.value }))}
                  className="w-full border border-grey-30 rounded-lg px-3 py-2 text-sm"
                  placeholder="staff@example.com"
                />
              </div>
            )}
            <div>
              <label className="block text-xs font-medium text-grey-75 mb-1">
                {staffLogins[loginModal.staffId]?.email ? 'New Password' : 'Temporary Password'}
              </label>
              <input
                type="password"
                value={loginForm.password}
                onChange={e => setLoginForm(f => ({ ...f, password: e.target.value }))}
                className="w-full border border-grey-30 rounded-lg px-3 py-2 text-sm"
                placeholder="Minimum 8 characters"
              />
            </div>
            {loginError && <p className="text-xs text-semantic-danger">{loginError}</p>}
            <div className="flex gap-2">
              <button
                onClick={async () => {
                  setLoginError('');
                  try {
                    if (staffLogins[loginModal.staffId]?.email) {
                      await apiFetch(`/merchant/staff/${loginModal.staffId}/reset-password`, {
                        method: 'POST',
                        body: JSON.stringify({ password: loginForm.password }),
                      });
                    } else {
                      await apiFetch(`/merchant/staff/${loginModal.staffId}/create-login`, {
                        method: 'POST',
                        body: JSON.stringify({ email: loginForm.email, password: loginForm.password }),
                      });
                      setStaffLogins((prev) => ({ ...prev, [loginModal.staffId]: { email: loginForm.email, role: 'staff' } }));
                    }
                    setLoginModal(null);
                  } catch (err) {
                    setLoginError(err instanceof Error ? err.message : 'Failed');
                  }
                }}
                className="flex-1 py-2 bg-tone-ink text-white text-sm font-semibold rounded-lg hover:opacity-90"
              >
                Save
              </button>
              <button onClick={() => setLoginModal(null)} className="py-2 px-4 bg-grey-15 text-grey-75 text-sm font-semibold rounded-lg">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
