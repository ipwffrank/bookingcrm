'use client';

import { useEffect, useState, useCallback } from 'react';
import { apiFetch } from '../../../lib/api';

// ─── Types ─────────────────────────────────────────────────────────────────────

type AutomationKind = 'birthday' | 'winback' | 'rebook';

interface BirthdayConfig {
  sendDaysBefore?: number;
}

interface WinbackConfig {
  afterDays?: number;
}

interface RebookConfig {
  defaultAfterDays?: number;
}

type AutomationConfig = BirthdayConfig | WinbackConfig | RebookConfig;

interface Automation {
  id: string | null;
  merchantId: string;
  kind: AutomationKind;
  enabled: boolean;
  messageTemplate: string;
  promoCode: string | null;
  config: AutomationConfig;
  lastRunAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

// ─── Metadata per kind ─────────────────────────────────────────────────────────

const KIND_META: Record<
  AutomationKind,
  { label: string; description: string; icon: string }
> = {
  birthday: {
    label: 'Birthday',
    description: 'Send a message to clients on their birthday.',
    icon: '🎂',
  },
  winback: {
    label: 'Win-back',
    description: 'Re-engage clients who have not visited in a while.',
    icon: '💌',
  },
  rebook: {
    label: 'Re-booking reminder',
    description: 'Remind clients to rebook after their last appointment.',
    icon: '📅',
  },
};

const PLACEHOLDER_HINT = '{{name}}, {{merchantName}}, {{promoCode}}';

// ─── AutomationCard ────────────────────────────────────────────────────────────

interface CardState {
  enabled: boolean;
  messageTemplate: string;
  promoCode: string;
  afterDays: string;       // winback
  defaultAfterDays: string; // rebook
}

function AutomationCard({
  automation,
  onSave,
}: {
  automation: Automation;
  onSave: (kind: AutomationKind, patch: CardState) => Promise<void>;
}) {
  const meta = KIND_META[automation.kind];
  const [state, setState] = useState<CardState>({
    enabled: automation.enabled,
    messageTemplate: automation.messageTemplate,
    promoCode: automation.promoCode ?? '',
    afterDays: String((automation.config as WinbackConfig).afterDays ?? 90),
    defaultAfterDays: String((automation.config as RebookConfig).defaultAfterDays ?? 30),
  });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function handleSave() {
    setSaving(true);
    setSaveError(null);
    try {
      await onSave(automation.kind, state);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  const lastRunLabel = automation.lastRunAt
    ? new Date(automation.lastRunAt).toLocaleString('en-SG', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : 'Never';

  return (
    <div className="bg-tone-surface border border-grey-15 rounded-xl p-6 space-y-5">
      {/* Header row */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="text-2xl" role="img" aria-label={meta.label}>{meta.icon}</span>
          <div>
            <h2 className="text-base font-semibold text-tone-ink">{meta.label}</h2>
            <p className="text-sm text-grey-60 mt-0.5">{meta.description}</p>
          </div>
        </div>
        {/* Toggle */}
        <button
          type="button"
          role="switch"
          aria-checked={state.enabled}
          onClick={() => setState((s) => ({ ...s, enabled: !s.enabled }))}
          className={`relative inline-flex h-6 w-11 flex-shrink-0 rounded-full border-2 border-transparent transition-colors focus:outline-none ${
            state.enabled ? 'bg-tone-ink' : 'bg-grey-20'
          }`}
        >
          <span
            className={`inline-block h-5 w-5 rounded-full bg-white shadow transform transition-transform ${
              state.enabled ? 'translate-x-5' : 'translate-x-0'
            }`}
          />
        </button>
      </div>

      {/* Config inputs per kind */}
      {automation.kind === 'winback' && (
        <div className="flex items-center gap-3">
          <label className="text-sm text-grey-70 flex-shrink-0 w-56">
            Trigger after days since last visit
          </label>
          <input
            type="number"
            min={1}
            max={730}
            value={state.afterDays}
            onChange={(e) => setState((s) => ({ ...s, afterDays: e.target.value }))}
            className="w-24 px-3 py-1.5 border border-grey-20 rounded-lg text-sm text-tone-ink bg-tone-surface focus:outline-none focus:border-tone-ink"
          />
          <span className="text-sm text-grey-50">days</span>
        </div>
      )}

      {automation.kind === 'rebook' && (
        <div className="flex items-center gap-3">
          <label className="text-sm text-grey-70 flex-shrink-0 w-56">
            Default reminder after last visit
          </label>
          <input
            type="number"
            min={1}
            max={365}
            value={state.defaultAfterDays}
            onChange={(e) => setState((s) => ({ ...s, defaultAfterDays: e.target.value }))}
            className="w-24 px-3 py-1.5 border border-grey-20 rounded-lg text-sm text-tone-ink bg-tone-surface focus:outline-none focus:border-tone-ink"
          />
          <span className="text-sm text-grey-50">days</span>
        </div>
      )}

      {/* Message template */}
      <div className="space-y-1.5">
        <label className="block text-sm font-medium text-grey-75">
          Message template
        </label>
        <p className="text-xs text-grey-45">
          Placeholders: <code className="font-mono bg-grey-5 px-1 py-0.5 rounded">{PLACEHOLDER_HINT}</code>
        </p>
        <textarea
          rows={4}
          value={state.messageTemplate}
          onChange={(e) => setState((s) => ({ ...s, messageTemplate: e.target.value }))}
          maxLength={2000}
          className="w-full px-3 py-2.5 border border-grey-20 rounded-lg text-sm text-tone-ink bg-tone-surface focus:outline-none focus:border-tone-ink resize-y font-mono"
          placeholder="Hi {{name}}, ..."
        />
        <p className="text-xs text-grey-40 text-right">
          {state.messageTemplate.length}/2000
        </p>
      </div>

      {/* Promo code */}
      <div className="space-y-1.5">
        <label className="block text-sm font-medium text-grey-75">
          Promo code <span className="font-normal text-grey-45">(optional)</span>
        </label>
        <input
          type="text"
          maxLength={50}
          value={state.promoCode}
          onChange={(e) => setState((s) => ({ ...s, promoCode: e.target.value }))}
          placeholder="e.g. WELCOME10"
          className="w-48 px-3 py-1.5 border border-grey-20 rounded-lg text-sm text-tone-ink bg-tone-surface focus:outline-none focus:border-tone-ink font-mono uppercase"
        />
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between pt-2 border-t border-grey-10">
        <p className="text-xs text-grey-45">
          Last run: <span className="text-grey-60">{lastRunLabel}</span>
        </p>
        <div className="flex items-center gap-3">
          {saveError && (
            <p className="text-xs state-danger">{saveError}</p>
          )}
          {saved && (
            <p className="text-xs text-grey-60">Saved</p>
          )}
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-1.5 bg-tone-ink text-tone-surface text-sm font-medium rounded-lg hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function MarketingAutomationPage() {
  const [automationList, setAutomationList] = useState<Automation[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    const token = localStorage.getItem('access_token');
    apiFetch('/merchant/automations', {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then((data: { automations?: Automation[] }) => {
        setAutomationList(data.automations ?? []);
      })
      .catch((err: Error) => {
        setLoadError(err.message);
      })
      .finally(() => setLoading(false));
  }, []);

  const handleSave = useCallback(
    async (kind: AutomationKind, patch: CardState) => {
      const token = localStorage.getItem('access_token');

      // Build config object per kind
      let config: AutomationConfig = {};
      if (kind === 'winback') {
        config = { afterDays: parseInt(patch.afterDays, 10) || 90 };
      } else if (kind === 'rebook') {
        config = { defaultAfterDays: parseInt(patch.defaultAfterDays, 10) || 30 };
      } else {
        config = { sendDaysBefore: 0 };
      }

      const result = (await apiFetch(`/merchant/automations/${kind}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          enabled: patch.enabled,
          messageTemplate: patch.messageTemplate,
          promoCode: patch.promoCode.trim() || null,
          config,
        }),
      })) as { automation?: Automation };

      // Update local state with the persisted row
      if (result.automation) {
        setAutomationList((prev) =>
          prev.map((a) => (a.kind === kind ? { ...a, ...result.automation } : a))
        );
      }
    },
    []
  );

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-tone-ink">Marketing automation</h1>
        <p className="text-sm text-grey-60 mt-1">
          Set up recurring rules that fire automatically each day. Each rule sends
          once per client per cadence.
        </p>
      </div>

      {loading && (
        <p className="text-sm text-grey-50">Loading…</p>
      )}

      {loadError && (
        <p className="text-sm state-danger">{loadError}</p>
      )}

      {!loading && !loadError && automationList.map((automation) => (
        <AutomationCard
          key={automation.kind}
          automation={automation}
          onSave={handleSave}
        />
      ))}
    </div>
  );
}
