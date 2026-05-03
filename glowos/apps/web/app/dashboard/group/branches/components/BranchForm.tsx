'use client';

import { useEffect, useState } from 'react';
import { apiFetch, ApiError } from '../../../../lib/api';

// Mirrors signup + settings categories. Clinical categories
// (aesthetic_clinic, dermatology_clinic, dental_clinic, medical_gp) imply a
// `vertical` server-side at /group/branches POST. Legacy values
// (beauty_centre, beauty_clinic, medical_clinic) kept for backward compat
// with existing branches; new branches should pick the specific replacement.
const CATEGORY_OPTIONS: Array<{ value: string; label: string; group: 'service' | 'clinical' | 'other' }> = [
  { value: 'hair_salon', label: 'Hair Salon / Barbershop', group: 'service' },
  { value: 'nail_studio', label: 'Nail Studio', group: 'service' },
  { value: 'beauty_salon', label: 'Beauty / Facial Salon', group: 'service' },
  { value: 'massage', label: 'Massage / Physiotherapy', group: 'service' },
  { value: 'spa', label: 'Spa / Wellness Centre', group: 'service' },
  { value: 'restaurant', label: 'Restaurant / F&B', group: 'service' },
  { value: 'aesthetic_clinic', label: 'Aesthetic Clinic', group: 'clinical' },
  { value: 'dermatology_clinic', label: 'Dermatology Clinic', group: 'clinical' },
  { value: 'dental_clinic', label: 'Dental Clinic', group: 'clinical' },
  { value: 'medical_gp', label: 'Medical / GP Clinic', group: 'clinical' },
  { value: 'other', label: 'Other', group: 'other' },
];
type Category =
  | 'hair_salon'
  | 'nail_studio'
  | 'spa'
  | 'massage'
  | 'beauty_centre'
  | 'restaurant'
  | 'beauty_clinic'
  | 'beauty_salon'
  | 'medical_clinic'
  | 'aesthetic_clinic'
  | 'dermatology_clinic'
  | 'dental_clinic'
  | 'medical_gp'
  | 'other';

export interface BranchFormProps {
  mode: 'create' | 'edit';
  /** When edit, the merchantId of the branch to update. */
  merchantId?: string;
  onClose: () => void;
  onSaved: () => void;
}

interface State {
  name: string;
  slug: string;
  country: 'SG' | 'MY' | 'HK';
  category: Category | '';
  addressLine1: string;
  addressLine2: string;
  postalCode: string;
  phone: string;
  email: string;
  description: string;
}

const EMPTY: State = {
  name: '', slug: '', country: 'MY', category: '',
  addressLine1: '', addressLine2: '', postalCode: '',
  phone: '', email: '', description: '',
};

export function BranchForm({ mode, merchantId, onClose, onSaved }: BranchFormProps) {
  const [state, setState] = useState<State>(EMPTY);
  const [loading, setLoading] = useState(mode === 'edit');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (mode !== 'edit' || !merchantId) return;
    setLoading(true);
    apiFetch(`/group/branches/${merchantId}`)
      .then((data) => {
        const m = data.merchant;
        setState({
          name: m.name ?? '',
          slug: m.slug ?? '',
          country: (m.country ?? 'MY') as 'SG' | 'MY' | 'HK',
          category: (m.category ?? '') as Category | '',
          addressLine1: m.addressLine1 ?? '',
          addressLine2: m.addressLine2 ?? '',
          postalCode: m.postalCode ?? '',
          phone: m.phone ?? '',
          email: m.email ?? '',
          description: m.description ?? '',
        });
      })
      .catch(() => setError('Failed to load branch'))
      .finally(() => setLoading(false));
  }, [mode, merchantId]);

  function set<K extends keyof State>(k: K, v: State[K]) {
    setState((s) => ({ ...s, [k]: v }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      if (mode === 'create') {
        const body: Record<string, unknown> = {
          name: state.name.trim(),
          slug: state.slug.trim(),
          country: state.country,
        };
        if (state.category) body.category = state.category;
        for (const k of ['addressLine1','addressLine2','postalCode','phone','email','description'] as const) {
          if (state[k]) body[k] = state[k];
        }
        await apiFetch('/group/branches', { method: 'POST', body: JSON.stringify(body) });
      } else {
        const body: Record<string, unknown> = {};
        for (const k of ['name','category','addressLine1','addressLine2','postalCode','phone','email','description'] as const) {
          // PATCH allows null to clear an optional field; empty string also clears
          body[k] = state[k] === '' ? null : state[k];
        }
        await apiFetch(`/group/branches/${merchantId}`, { method: 'PATCH', body: JSON.stringify(body) });
      }
      onSaved();
    } catch (err) {
      if (err instanceof ApiError) setError(err.message ?? 'Save failed');
      else setError('Save failed');
      setSubmitting(false);
    }
  }

  const tz =
    state.country === 'MY' ? 'Asia/Kuala_Lumpur'
    : state.country === 'HK' ? 'Asia/Hong_Kong'
    : 'Asia/Singapore';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-tone-ink/30 px-4" role="dialog">
      <div className="bg-tone-surface rounded-lg w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6 border border-grey-20">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-tone-ink">
            {mode === 'create' ? 'New branch' : 'Edit branch'}
          </h2>
          <button onClick={onClose} className="text-grey-50 hover:text-tone-ink">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {loading ? (
          <p className="text-sm text-grey-60 py-12 text-center">Loading…</p>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <Field label="Branch name" required>
              <input
                type="text" required maxLength={255}
                value={state.name}
                onChange={(e) => set('name', e.target.value)}
                className={inputCls}
              />
            </Field>

            <Field label="URL slug" required={mode === 'create'} hint={mode === 'create' ? 'Public booking URL: /booking/<slug>' : 'Slug cannot be changed after create'}>
              <input
                type="text"
                required={mode === 'create'}
                disabled={mode === 'edit'}
                pattern="[a-z0-9](?:[-a-z0-9]*[a-z0-9])?"
                minLength={3} maxLength={100}
                value={state.slug}
                onChange={(e) => set('slug', e.target.value.toLowerCase())}
                className={`${inputCls} ${mode === 'edit' ? 'bg-grey-10 text-grey-50' : ''}`}
              />
            </Field>

            <Field label="Country" required={mode === 'create'} hint={`This branch will operate on ${tz} time`}>
              <select
                required={mode === 'create'}
                disabled={mode === 'edit'}
                value={state.country}
                onChange={(e) => set('country', e.target.value as 'SG' | 'MY' | 'HK')}
                className={`${inputCls} ${mode === 'edit' ? 'bg-grey-10 text-grey-50' : ''}`}
              >
                <option value="MY">Malaysia</option>
                <option value="SG">Singapore</option>
                <option value="HK">Hong Kong</option>
              </select>
            </Field>

            <Field label="Category">
              <select
                value={state.category}
                onChange={(e) => set('category', e.target.value as Category | '')}
                className={inputCls}
              >
                <option value="">—</option>
                <optgroup label="Service businesses">
                  {CATEGORY_OPTIONS.filter((c) => c.group === 'service').map((c) => (
                    <option key={c.value} value={c.value}>{c.label}</option>
                  ))}
                </optgroup>
                <optgroup label="Clinical">
                  {CATEGORY_OPTIONS.filter((c) => c.group === 'clinical').map((c) => (
                    <option key={c.value} value={c.value}>{c.label}</option>
                  ))}
                </optgroup>
                {CATEGORY_OPTIONS.filter((c) => c.group === 'other').map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </Field>

            <Field label="Address line 1">
              <input type="text" maxLength={255} value={state.addressLine1} onChange={(e) => set('addressLine1', e.target.value)} className={inputCls} />
            </Field>
            <Field label="Address line 2">
              <input type="text" maxLength={255} value={state.addressLine2} onChange={(e) => set('addressLine2', e.target.value)} className={inputCls} />
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Postal code">
                <input type="text" maxLength={10} value={state.postalCode} onChange={(e) => set('postalCode', e.target.value)} className={inputCls} />
              </Field>
              <Field label="Phone">
                <input type="text" maxLength={20} value={state.phone} onChange={(e) => set('phone', e.target.value)} className={inputCls} />
              </Field>
            </div>
            <Field label="Email">
              <input type="email" maxLength={255} value={state.email} onChange={(e) => set('email', e.target.value)} className={inputCls} />
            </Field>
            <Field label="Description">
              <textarea rows={3} value={state.description} onChange={(e) => set('description', e.target.value)} className={inputCls} />
            </Field>

            {error && <p className="text-sm text-semantic-danger">{error}</p>}

            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-grey-70 hover:text-tone-ink">Cancel</button>
              <button type="submit" disabled={submitting} className="bg-tone-ink text-tone-surface px-4 py-2 text-sm font-medium rounded-md hover:opacity-90 disabled:opacity-50">
                {submitting ? 'Saving…' : (mode === 'create' ? 'Create branch' : 'Save changes')}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

const inputCls =
  'w-full border border-grey-20 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-tone-sage focus:border-tone-sage';

function Field({
  label, required, hint, children,
}: {
  label: string; required?: boolean; hint?: string; children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="block text-xs uppercase tracking-wide text-grey-60 mb-1">
        {label}{required && <span className="text-semantic-danger ml-0.5">*</span>}
      </span>
      {children}
      {hint && <span className="block text-xs text-grey-50 mt-1">{hint}</span>}
    </label>
  );
}
