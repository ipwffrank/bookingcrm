'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiFetch, ApiError } from '../../../lib/api';

// ─── Types ─────────────────────────────────────────────────────────────────────

type Frequency = 'weekly' | 'monthly' | 'yearly';
type Role = 'owner' | 'manager' | 'clinician' | 'staff';

interface DigestConfig {
  id: string;
  frequency: Frequency;
  sendHourLocal: number;
  weekday: number | null;
  dayOfMonth: number | null;
  isActive: boolean;
  lastFiredAt: string | null;
}

interface ConfigResponse {
  feature_locked: boolean;
  tier: string;
  config: DigestConfig | null;
}

interface Recipient {
  id: string;
  merchantUserId: string;
  addedAt: string;
  name: string;
  email: string;
  role: Role;
}

interface EligibleUser {
  id: string;
  name: string;
  email: string;
  role: Role;
}

interface Run {
  id: string;
  periodStart: string;
  periodEnd: string;
  scheduledFor: string;
  frequencySnapshot: Frequency;
  status: 'queued' | 'generating' | 'sent' | 'partial' | 'failed' | 'skipped';
  errorMessage: string | null;
  completedAt: string | null;
}

interface Props {
  onSaved: (msg: string) => void;
  onError: (msg: string) => void;
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

const WEEKDAYS = [
  { v: 1, label: 'Monday' },
  { v: 2, label: 'Tuesday' },
  { v: 3, label: 'Wednesday' },
  { v: 4, label: 'Thursday' },
  { v: 5, label: 'Friday' },
  { v: 6, label: 'Saturday' },
  { v: 0, label: 'Sunday' },
];

const HOURS = Array.from({ length: 24 }, (_, h) => ({
  v: h,
  label: `${String(h).padStart(2, '0')}:00`,
}));

function roleLabel(r: Role): string {
  if (r === 'owner') return 'Owner';
  if (r === 'manager') return 'Manager';
  if (r === 'clinician') return 'Clinician';
  return 'Staff';
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' });
}

function fmtDateTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${d.toLocaleDateString('en-SG', { day: 'numeric', month: 'short' })} · ${d.toLocaleTimeString('en-SG', { hour: '2-digit', minute: '2-digit' })}`;
}

function statusLabel(r: Run): { text: string; cls: string } {
  if (r.errorMessage === 'TEST_SEND') {
    return { text: 'Test send', cls: 'state-default' };
  }
  switch (r.status) {
    case 'sent':
      return { text: 'Delivered', cls: 'state-completed' };
    case 'partial':
      return { text: 'Partial — some bounced', cls: 'state-notified' };
    case 'failed':
      return { text: 'Failed', cls: 'state-cancelled' };
    case 'skipped':
      return { text: r.errorMessage === 'no_active_recipients' ? 'Skipped — no recipients' : 'Skipped', cls: 'state-default' };
    case 'queued':
    case 'generating':
      return { text: 'Sending…', cls: 'state-active' };
    default:
      return { text: r.status, cls: 'state-default' };
  }
}

// ─── Component ─────────────────────────────────────────────────────────────────

export function AnalyticsDigestTab({ onSaved, onError }: Props) {
  const [userRole, setUserRole] = useState<Role | null>(null);
  const isOwner = userRole === 'owner';

  useEffect(() => {
    try {
      const token = localStorage.getItem('access_token');
      if (!token) return;
      const payload = JSON.parse(atob(token.split('.')[1] ?? ''));
      const r = (payload as { role?: string }).role;
      if (r === 'owner' || r === 'manager' || r === 'clinician' || r === 'staff') {
        setUserRole(r);
      }
    } catch {
      setUserRole(null);
    }
  }, []);

  const [loading, setLoading] = useState(true);
  const [tier, setTier] = useState<string>('starter');
  const [featureLocked, setFeatureLocked] = useState(true);
  const [config, setConfig] = useState<DigestConfig | null>(null);

  // Schedule form draft (only used by owner edit view).
  const [draft, setDraft] = useState<{
    frequency: Frequency;
    sendHourLocal: number;
    weekday: number;
    dayOfMonth: number;
    isActive: boolean;
  }>({
    frequency: 'weekly',
    sendHourLocal: 9,
    weekday: 1,
    dayOfMonth: 1,
    isActive: true,
  });
  const [saving, setSaving] = useState(false);

  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [eligible, setEligible] = useState<EligibleUser[]>([]);
  const [showPicker, setShowPicker] = useState(false);
  const [pickerSelection, setPickerSelection] = useState<string>('');
  const [adding, setAdding] = useState(false);

  const [runs, setRuns] = useState<Run[]>([]);
  const [testing, setTesting] = useState(false);

  const reload = useCallback(async () => {
    try {
      const [cfgRes, recRes, runRes, elRes] = await Promise.all([
        apiFetch('/merchant/analytics-digest/config') as Promise<ConfigResponse>,
        apiFetch('/merchant/analytics-digest/recipients') as Promise<{ recipients: Recipient[] }>,
        apiFetch('/merchant/analytics-digest/runs') as Promise<{ runs: Run[] }>,
        apiFetch('/merchant/analytics-digest/eligible-users') as Promise<{ users: EligibleUser[] }>,
      ]);
      setTier(cfgRes.tier);
      setFeatureLocked(cfgRes.feature_locked);
      setConfig(cfgRes.config);
      if (cfgRes.config) {
        setDraft({
          frequency: cfgRes.config.frequency,
          sendHourLocal: cfgRes.config.sendHourLocal,
          weekday: cfgRes.config.weekday ?? 1,
          dayOfMonth: cfgRes.config.dayOfMonth ?? 1,
          isActive: cfgRes.config.isActive,
        });
      }
      setRecipients(recRes.recipients);
      setRuns(runRes.runs);
      setEligible(elRes.users);
    } catch (err) {
      if (err instanceof ApiError && err.status !== 401 && err.status !== 403) {
        onError(err.message);
      }
    } finally {
      setLoading(false);
    }
  }, [onError]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function handleSaveSchedule() {
    setSaving(true);
    try {
      await apiFetch('/merchant/analytics-digest/config', {
        method: 'PUT',
        body: JSON.stringify({
          frequency: draft.frequency,
          send_hour_local: draft.sendHourLocal,
          weekday: draft.frequency === 'weekly' ? draft.weekday : undefined,
          day_of_month: draft.frequency === 'monthly' ? draft.dayOfMonth : undefined,
          is_active: draft.isActive,
        }),
      });
      onSaved('Schedule saved');
      await reload();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to save schedule');
    } finally {
      setSaving(false);
    }
  }

  async function handleAddRecipient() {
    if (!pickerSelection) return;
    setAdding(true);
    try {
      await apiFetch('/merchant/analytics-digest/recipients', {
        method: 'POST',
        body: JSON.stringify({ merchant_user_id: pickerSelection }),
      });
      setPickerSelection('');
      setShowPicker(false);
      onSaved('Recipient added');
      await reload();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to add recipient');
    } finally {
      setAdding(false);
    }
  }

  async function handleRemove(recipientId: string, name: string) {
    if (!confirm(`Remove ${name} from the recipient list?`)) return;
    try {
      await apiFetch(`/merchant/analytics-digest/recipients/${recipientId}`, {
        method: 'DELETE',
      });
      onSaved(`${name} removed`);
      await reload();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to remove recipient');
    }
  }

  async function handleTestSend() {
    if (recipients.length === 0) {
      onError('Add at least one recipient before sending a test');
      return;
    }
    setTesting(true);
    try {
      const res = await apiFetch('/merchant/analytics-digest/test-send', {
        method: 'POST',
      });
      onSaved(`Test sent to ${res.sent}/${res.recipients_count} recipients`);
      await reload();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to send test');
    } finally {
      setTesting(false);
    }
  }

  if (loading) {
    return (
      <div className="bg-tone-surface rounded-xl border border-grey-15 p-12 text-center">
        <p className="text-sm text-grey-60">Loading…</p>
      </div>
    );
  }

  // ─── Tier-locked view ───────────────────────────────────────────────────────
  if (featureLocked) {
    return (
      <div className="bg-tone-surface rounded-xl border border-grey-15 p-8 text-center max-w-xl mx-auto">
        <div className="text-4xl mb-2">📈</div>
        <h2 className="text-base font-semibold text-tone-ink">Analytics Digest</h2>
        <p className="text-sm text-grey-60 mt-2 leading-relaxed">
          Email your owners and managers a weekly, monthly, or yearly snapshot of
          your business performance — revenue, bookings, no-shows, first-timer
          retention, and reviews — automatically.
        </p>
        <p className="text-xs text-grey-45 mt-4">
          Available on the <strong>Multibranch</strong> plan or for any branch in a group. Currently on <strong>{tier}</strong>.
        </p>
      </div>
    );
  }

  // ─── Read-only view (non-owners) ────────────────────────────────────────────
  if (!isOwner) {
    const meEntry = recipients.find((r) => r.role === userRole);
    return (
      <div className="bg-tone-surface rounded-xl border border-grey-15 p-6 max-w-xl">
        <h2 className="text-base font-semibold text-tone-ink">Analytics Digest</h2>
        {!config || !config.isActive ? (
          <p className="text-sm text-grey-60 mt-2">
            Your owner has not enabled scheduled reports yet.
          </p>
        ) : meEntry ? (
          <>
            <p className="text-sm text-grey-75 mt-2 leading-relaxed">
              You receive an analytics summary <strong>{config.frequency}</strong>
              {config.frequency === 'weekly' && config.weekday !== null
                ? ` on ${WEEKDAYS.find((w) => w.v === config.weekday)!.label}s`
                : config.frequency === 'monthly' && config.dayOfMonth !== null
                  ? ` on day ${config.dayOfMonth} of each month`
                  : config.frequency === 'yearly'
                    ? ' on 1 January'
                    : ''}{' '}
              at <strong>{String(config.sendHourLocal).padStart(2, '0')}:00</strong>.
            </p>
            <p className="text-xs text-grey-45 mt-3">
              Delivered to: {meEntry.email}
            </p>
            <p className="text-xs text-grey-45 mt-1">
              Last sent: {fmtDate(config.lastFiredAt)}
            </p>
          </>
        ) : (
          <p className="text-sm text-grey-60 mt-2">
            You don&apos;t currently receive the digest. Ask an owner to add you.
          </p>
        )}
        <p className="text-xs text-grey-45 mt-4 italic">
          Only owners can change the schedule or recipient list.
        </p>
      </div>
    );
  }

  // ─── Owner edit view ────────────────────────────────────────────────────────
  return (
    <div className="space-y-5 max-w-2xl">
      {/* Schedule card */}
      <div className="bg-tone-surface rounded-xl border border-grey-15 p-5">
        <div className="flex items-start justify-between mb-3">
          <div>
            <h2 className="text-base font-semibold text-tone-ink">Schedule</h2>
            <p className="text-xs text-grey-60 mt-0.5">
              Recipients get the digest on this cadence in the merchant&apos;s local timezone.
            </p>
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={draft.isActive}
              onChange={(e) => setDraft((d) => ({ ...d, isActive: e.target.checked }))}
              className="rounded border-grey-30"
            />
            <span className="text-xs font-medium text-grey-75">Active</span>
          </label>
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-grey-60 uppercase tracking-wide mb-1">Frequency</label>
            <div className="flex gap-2">
              {(['weekly', 'monthly', 'yearly'] as Frequency[]).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setDraft((d) => ({ ...d, frequency: f }))}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                    draft.frequency === f
                      ? 'bg-tone-ink text-tone-surface border-tone-ink'
                      : 'bg-tone-surface text-grey-75 border-grey-15 hover:bg-grey-5'
                  }`}
                >
                  {f.charAt(0).toUpperCase() + f.slice(1)}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-grey-60 uppercase tracking-wide mb-1">Send at</label>
              <select
                value={draft.sendHourLocal}
                onChange={(e) => setDraft((d) => ({ ...d, sendHourLocal: parseInt(e.target.value, 10) }))}
                className="w-full px-3 py-2 text-sm rounded-lg border border-grey-30 bg-tone-surface focus:outline-none focus:ring-2 focus:ring-tone-sage"
              >
                {HOURS.map((h) => (
                  <option key={h.v} value={h.v}>{h.label}</option>
                ))}
              </select>
            </div>

            {draft.frequency === 'weekly' && (
              <div>
                <label className="block text-xs font-medium text-grey-60 uppercase tracking-wide mb-1">On</label>
                <select
                  value={draft.weekday}
                  onChange={(e) => setDraft((d) => ({ ...d, weekday: parseInt(e.target.value, 10) }))}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-grey-30 bg-tone-surface focus:outline-none focus:ring-2 focus:ring-tone-sage"
                >
                  {WEEKDAYS.map((w) => (
                    <option key={w.v} value={w.v}>{w.label}</option>
                  ))}
                </select>
              </div>
            )}

            {draft.frequency === 'monthly' && (
              <div>
                <label className="block text-xs font-medium text-grey-60 uppercase tracking-wide mb-1">Day of month</label>
                <select
                  value={draft.dayOfMonth}
                  onChange={(e) => setDraft((d) => ({ ...d, dayOfMonth: parseInt(e.target.value, 10) }))}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-grey-30 bg-tone-surface focus:outline-none focus:ring-2 focus:ring-tone-sage"
                >
                  {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </select>
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={handleSaveSchedule}
            disabled={saving}
            className="rounded-lg bg-tone-ink px-4 py-2 text-sm font-semibold text-tone-surface hover:opacity-90 disabled:opacity-60 transition-opacity"
          >
            {saving ? 'Saving…' : config ? 'Save schedule' : 'Save & enable'}
          </button>

          {config && (
            <p className="text-xs text-grey-45 mt-2">
              Last sent: {fmtDate(config.lastFiredAt)}
            </p>
          )}
        </div>
      </div>

      {/* Recipients card — only shown after a config exists */}
      {config && (
        <div className="bg-tone-surface rounded-xl border border-grey-15 p-5">
          <div className="flex items-start justify-between mb-3">
            <div>
              <h2 className="text-base font-semibold text-tone-ink">Recipients ({recipients.length})</h2>
              <p className="text-xs text-grey-60 mt-0.5">
                Pick from registered users at this branch. Email-only — no WhatsApp.
              </p>
            </div>
            {!showPicker && eligible.length > 0 && (
              <button
                type="button"
                onClick={() => setShowPicker(true)}
                className="rounded-lg border border-tone-sage/30 text-tone-sage px-3 py-1.5 text-xs font-medium hover:bg-tone-sage/5 transition-colors"
              >
                + Add recipient
              </button>
            )}
          </div>

          {recipients.length === 0 ? (
            <p className="text-sm text-grey-60">
              No recipients yet. Add at least one to start receiving the digest.
            </p>
          ) : (
            <div className="space-y-2">
              {recipients.map((r) => (
                <div key={r.id} className="flex items-center justify-between py-2 border-b border-grey-5 last:border-0">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-tone-ink truncate">
                      {r.name} <span className="text-xs text-grey-45 font-normal">· {roleLabel(r.role)}</span>
                    </p>
                    <p className="text-xs text-grey-60 truncate">{r.email}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRemove(r.id, r.name)}
                    className="text-xs font-medium text-semantic-danger hover:underline shrink-0 ml-3"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}

          {showPicker && (
            <div className="mt-3 p-3 rounded-lg border border-grey-15 bg-grey-5">
              {eligible.length === 0 ? (
                <p className="text-xs text-grey-60">No eligible users to add. Invite more staff via Account.</p>
              ) : (
                <div className="flex gap-2">
                  <select
                    value={pickerSelection}
                    onChange={(e) => setPickerSelection(e.target.value)}
                    className="flex-1 px-3 py-2 text-sm rounded-lg border border-grey-30 bg-tone-surface focus:outline-none focus:ring-2 focus:ring-tone-sage"
                  >
                    <option value="">Choose a user…</option>
                    {eligible.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name} ({roleLabel(u.role)}) — {u.email}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={handleAddRecipient}
                    disabled={!pickerSelection || adding}
                    className="rounded-lg bg-tone-ink px-3 py-2 text-xs font-semibold text-tone-surface hover:opacity-90 disabled:opacity-60 transition-opacity"
                  >
                    {adding ? 'Adding…' : 'Add'}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setShowPicker(false); setPickerSelection(''); }}
                    className="rounded-lg bg-grey-15 px-3 py-2 text-xs font-medium text-grey-75 hover:bg-grey-30 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>
          )}

          {recipients.length > 0 && (
            <button
              type="button"
              onClick={handleTestSend}
              disabled={testing}
              className="mt-4 w-full rounded-lg border border-tone-sage/40 text-tone-ink bg-tone-sage/15 hover:bg-tone-sage/30 px-4 py-2 text-sm font-semibold disabled:opacity-60 transition-colors"
            >
              {testing ? 'Sending test…' : 'Send test report now'}
            </button>
          )}
        </div>
      )}

      {/* Recent sends */}
      {config && runs.length > 0 && (
        <div className="bg-tone-surface rounded-xl border border-grey-15 p-5">
          <h2 className="text-base font-semibold text-tone-ink mb-3">Recent sends</h2>
          <div className="space-y-1">
            {runs.map((r) => {
              const status = statusLabel(r);
              return (
                <div key={r.id} className="flex items-center justify-between py-1.5 text-xs">
                  <span className="text-grey-75">
                    {fmtDateTime(r.completedAt ?? r.scheduledFor)} · {r.frequencySnapshot}
                  </span>
                  <span className={status.cls}>{status.text}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
