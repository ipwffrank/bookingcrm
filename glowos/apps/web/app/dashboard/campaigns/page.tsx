'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch, ApiError } from '../../lib/api';

// ─── Types ─────────────────────────────────────────────────────────────────────

type CampaignType = 'winback' | 'birthday' | 'seasonal' | 'vip' | 'new_service' | 'custom';
type CampaignStatus = 'draft' | 'scheduled' | 'sent' | 'completed';
type VipTier = 'bronze' | 'silver' | 'gold' | 'platinum';

interface AudienceFilter {
  vip_tiers?: VipTier[];
  overdue_days?: number;
}

interface Campaign {
  id: string;
  name: string;
  type: CampaignType;
  status: CampaignStatus;
  audienceFilter: AudienceFilter | null;
  messageTemplate: string | null;
  promoCode: string | null;
  scheduledAt: string | null;
  sentAt: string | null;
  recipientsCount: number | null;
  deliveredCount: number | null;
  clickedCount: number | null;
  convertedCount: number | null;
  revenueAttributedSgd: string | null;
  createdAt: string;
}

interface CampaignMessage {
  message: {
    id: string;
    status: string;
    sentAt: string | null;
    deliveredAt: string | null;
    clickedAt: string | null;
    convertedAt: string | null;
    messageBody: string;
  };
  client: {
    id: string;
    name: string | null;
    phone: string;
  };
}

interface ResultsStats {
  sent: number;
  delivered: number;
  clicked: number;
  converted: number;
  revenueAttributed: number;
}

type View = 'list' | 'results';

interface CreateForm {
  name: string;
  type: CampaignType;
  vip_tiers: VipTier[];
  overdue_days: string;
  message_template: string;
  promo_code: string;
  schedule_type: 'now' | 'later';
  scheduled_at: string;
}

// ─── Constants ─────────────────────────────────────────────────────────────────

const CAMPAIGN_TYPES: {
  value: CampaignType;
  label: string;
  emoji: string;
  description: string;
  defaultTemplate: string;
}[] = [
  {
    value: 'winback',
    label: 'Win-back',
    emoji: '💖',
    description: 'Re-engage clients overdue 2+ weeks',
    defaultTemplate:
      'Hi {first_name}! We miss you at {merchant_name}. It\'s been a while since your last visit — book now and enjoy a special welcome back treat! {promo_code}',
  },
  {
    value: 'birthday',
    label: 'Birthday',
    emoji: '🎂',
    description: 'Celebrate clients with birthdays this month',
    defaultTemplate:
      'Happy Birthday {first_name}! 🎉 As a special gift from {merchant_name}, enjoy a complimentary add-on on your next visit. Book now and let us celebrate with you!',
  },
  {
    value: 'seasonal',
    label: 'Seasonal Promo',
    emoji: '🌸',
    description: 'Run a time-limited seasonal promotion',
    defaultTemplate:
      'Hi {first_name}! {merchant_name} is running a special seasonal promotion just for you. Book now and treat yourself — you deserve it!',
  },
  {
    value: 'vip',
    label: 'VIP Appreciation',
    emoji: '👑',
    description: 'Reward your Gold & Platinum members',
    defaultTemplate:
      'Hi {first_name}, as one of our most valued {merchant_name} clients, you deserve something special. Enjoy exclusive VIP perks on your next visit. Thank you for your loyalty!',
  },
  {
    value: 'new_service',
    label: 'New Service',
    emoji: '✨',
    description: 'Announce a new service offering',
    defaultTemplate:
      'Hi {first_name}! Exciting news from {merchant_name} — we\'ve just launched {last_service}! Be among the first to try it. Book your session today.',
  },
  {
    value: 'custom',
    label: 'Custom',
    emoji: '📝',
    description: 'Create a fully custom message',
    defaultTemplate: 'Hi {first_name}! ',
  },
];

const STATUS_CONFIG: Record<CampaignStatus, { label: string; className: string }> = {
  draft:     { label: 'Draft',     className: 'bg-gray-100 text-gray-600 border-gray-200' },
  scheduled: { label: 'Scheduled', className: 'bg-blue-100 text-blue-700 border-blue-200' },
  sent:      { label: 'Sent',      className: 'bg-green-100 text-green-700 border-green-200' },
  completed: { label: 'Completed', className: 'bg-purple-100 text-purple-700 border-purple-200' },
};

const TYPE_LABELS: Record<CampaignType, string> = {
  winback:     'Win-back',
  birthday:    'Birthday',
  seasonal:    'Seasonal',
  vip:         'VIP',
  new_service: 'New Service',
  custom:      'Custom',
};

const VIP_TIERS: VipTier[] = ['bronze', 'silver', 'gold', 'platinum'];

// ─── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-SG', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function formatDateTime(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-SG', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

function pct(numerator: number, denominator: number): string {
  if (denominator === 0) return '0%';
  return `${Math.round((numerator / denominator) * 100)}%`;
}

// ─── Sub-components ────────────────────────────────────────────────────────────

function Spinner() {
  return (
    <div className="flex items-center justify-center py-16">
      <div className="w-8 h-8 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin" />
    </div>
  );
}

function StatusBadge({ status }: { status: CampaignStatus }) {
  const cfg = STATUS_CONFIG[status] ?? { label: status, className: 'bg-gray-100 text-gray-600 border-gray-200' };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${cfg.className}`}>
      {cfg.label}
    </span>
  );
}

function TypeBadge({ type }: { type: CampaignType }) {
  const typeInfo = CAMPAIGN_TYPES.find((t) => t.value === type);
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-50 text-indigo-700 border border-indigo-200">
      {typeInfo?.emoji} {TYPE_LABELS[type]}
    </span>
  );
}

// ─── Create Campaign Modal ─────────────────────────────────────────────────────

function CreateCampaignModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const router = useRouter();
  const [step, setStep] = useState<'type' | 'details'>('type');
  const [saving, setSaving] = useState(false);
  const [apiError, setApiError] = useState('');

  const nowLocal = (() => {
    const d = new Date();
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 16);
  })();

  const [form, setForm] = useState<CreateForm>({
    name: '',
    type: 'winback',
    vip_tiers: [],
    overdue_days: '14',
    message_template: CAMPAIGN_TYPES[0]!.defaultTemplate,
    promo_code: '',
    schedule_type: 'now',
    scheduled_at: nowLocal,
  });

  function handleTypeSelect(type: CampaignType) {
    const info = CAMPAIGN_TYPES.find((t) => t.value === type)!;
    setForm((f) => ({
      ...f,
      type,
      message_template: f.message_template === CAMPAIGN_TYPES.find((t) => t.value === f.type)?.defaultTemplate
        ? info.defaultTemplate
        : f.message_template,
    }));
  }

  function toggleVipTier(tier: VipTier) {
    setForm((f) => ({
      ...f,
      vip_tiers: f.vip_tiers.includes(tier)
        ? f.vip_tiers.filter((t) => t !== tier)
        : [...f.vip_tiers, tier],
    }));
  }

  function generateTemplate() {
    const info = CAMPAIGN_TYPES.find((t) => t.value === form.type);
    if (info) {
      setForm((f) => ({ ...f, message_template: info.defaultTemplate }));
    }
  }

  async function handleSend(sendNow: boolean) {
    if (!form.name.trim()) {
      setApiError('Campaign name is required');
      return;
    }
    if (!form.message_template.trim()) {
      setApiError('Message template is required');
      return;
    }

    setSaving(true);
    setApiError('');
    const token = localStorage.getItem('access_token');

    try {
      const audienceFilter: AudienceFilter = {};
      if (form.vip_tiers.length > 0) audienceFilter.vip_tiers = form.vip_tiers;
      if (form.overdue_days && parseInt(form.overdue_days) > 0) {
        audienceFilter.overdue_days = parseInt(form.overdue_days);
      }

      const payload: Record<string, unknown> = {
        name: form.name,
        type: form.type,
        audience_filter: Object.keys(audienceFilter).length > 0 ? audienceFilter : undefined,
        message_template: form.message_template,
        promo_code: form.promo_code || undefined,
      };

      if (!sendNow && form.schedule_type === 'later') {
        payload.scheduled_at = new Date(form.scheduled_at).toISOString();
      }

      const created = await apiFetch('/merchant/campaigns', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
      }) as { campaign: Campaign };

      if (sendNow) {
        await apiFetch(`/merchant/campaigns/${created.campaign.id}/send`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        });
      }

      onCreated();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to create campaign';
      if (err instanceof ApiError && err.status === 401) {
        router.push('/login');
      } else {
        setApiError(msg);
      }
    } finally {
      setSaving(false);
    }
  }

  const selectedTypeInfo = CAMPAIGN_TYPES.find((t) => t.value === form.type);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <div className="fixed inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto z-10">
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-gray-100 px-6 py-4 flex items-center justify-between rounded-t-2xl z-10">
          <h2 className="text-lg font-bold text-gray-900">Create Campaign</h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-6 space-y-6">
          {apiError && (
            <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-600">
              {apiError}
            </div>
          )}

          {/* Campaign Name */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Campaign Name</label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="e.g. April Win-back Campaign"
            />
          </div>

          {/* Campaign Type */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Campaign Type</label>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {CAMPAIGN_TYPES.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => handleTypeSelect(t.value)}
                  className={`p-3 rounded-xl border text-left transition-all ${
                    form.type === t.value
                      ? 'border-indigo-500 bg-indigo-50 ring-1 ring-indigo-500'
                      : 'border-gray-200 hover:border-indigo-300 hover:bg-gray-50'
                  }`}
                >
                  <div className="text-xl mb-1">{t.emoji}</div>
                  <div className="text-sm font-medium text-gray-900">{t.label}</div>
                  <div className="text-xs text-gray-500 mt-0.5 leading-tight">{t.description}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Audience Filter */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Audience Filter</label>
            <div className="rounded-xl border border-gray-200 p-4 space-y-4 bg-gray-50">
              {/* VIP Tiers */}
              <div>
                <p className="text-xs font-medium text-gray-600 mb-2">VIP Tier</p>
                <div className="flex flex-wrap gap-2">
                  {VIP_TIERS.map((tier) => (
                    <button
                      key={tier}
                      type="button"
                      onClick={() => toggleVipTier(tier)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                        form.vip_tiers.includes(tier)
                          ? 'bg-indigo-600 text-white border-indigo-600'
                          : 'bg-white text-gray-600 border-gray-300 hover:border-indigo-400'
                      }`}
                    >
                      {tier.charAt(0).toUpperCase() + tier.slice(1)}
                    </button>
                  ))}
                </div>
                {form.vip_tiers.length === 0 && (
                  <p className="text-xs text-gray-400 mt-1">No filter — all tiers included</p>
                )}
              </div>

              {/* Overdue Days */}
              <div>
                <p className="text-xs font-medium text-gray-600 mb-1">
                  Overdue (days since last visit)
                </p>
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min="7"
                    max="180"
                    step="7"
                    value={form.overdue_days}
                    onChange={(e) => setForm({ ...form, overdue_days: e.target.value })}
                    className="flex-1 h-2 accent-indigo-600"
                  />
                  <div className="w-16 text-center">
                    <input
                      type="number"
                      min="1"
                      value={form.overdue_days}
                      onChange={(e) => setForm({ ...form, overdue_days: e.target.value })}
                      className="w-full rounded-lg border border-gray-300 px-2 py-1 text-sm text-center outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                  <span className="text-xs text-gray-500">days</span>
                </div>
                <p className="text-xs text-gray-400 mt-1">
                  Set to 0 to disable overdue filter
                </p>
              </div>
            </div>
          </div>

          {/* Message Template */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-sm font-medium text-gray-700">Message Template</label>
              <button
                type="button"
                onClick={generateTemplate}
                className="text-xs text-indigo-600 hover:text-indigo-700 font-medium"
              >
                Generate from type
              </button>
            </div>
            <textarea
              value={form.message_template}
              onChange={(e) => setForm({ ...form, message_template: e.target.value })}
              rows={4}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
              placeholder="Write your message..."
            />
            <p className="text-xs text-gray-400 mt-1">
              Variables: <code className="bg-gray-100 px-1 rounded">{'{first_name}'}</code>{' '}
              <code className="bg-gray-100 px-1 rounded">{'{last_service}'}</code>{' '}
              <code className="bg-gray-100 px-1 rounded">{'{merchant_name}'}</code>
            </p>

            {/* Preview */}
            {form.message_template && (
              <div className="mt-3 rounded-xl bg-green-50 border border-green-200 p-3">
                <p className="text-xs font-medium text-green-700 mb-1">Preview</p>
                <div className="bg-white rounded-lg p-3 shadow-sm">
                  <p className="text-sm text-gray-800 leading-relaxed">
                    {form.message_template
                      .replace('{first_name}', 'Sarah')
                      .replace('{last_service}', 'Gel Manicure')
                      .replace('{merchant_name}', 'Glow Studio')
                      .replace('{promo_code}', form.promo_code || 'WELCOME10')}
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Promo Code */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Promo Code <span className="text-gray-400 font-normal">(optional)</span>
            </label>
            <input
              type="text"
              value={form.promo_code}
              onChange={(e) => setForm({ ...form, promo_code: e.target.value.toUpperCase() })}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500 font-mono"
              placeholder="e.g. WELCOME10"
            />
          </div>

          {/* Schedule */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Schedule</label>
            <div className="flex gap-3 mb-3">
              <button
                type="button"
                onClick={() => setForm({ ...form, schedule_type: 'now' })}
                className={`flex-1 py-2.5 rounded-xl text-sm font-medium border transition-colors ${
                  form.schedule_type === 'now'
                    ? 'bg-indigo-600 text-white border-indigo-600'
                    : 'bg-white text-gray-600 border-gray-300 hover:border-indigo-400'
                }`}
              >
                Send Now
              </button>
              <button
                type="button"
                onClick={() => setForm({ ...form, schedule_type: 'later' })}
                className={`flex-1 py-2.5 rounded-xl text-sm font-medium border transition-colors ${
                  form.schedule_type === 'later'
                    ? 'bg-indigo-600 text-white border-indigo-600'
                    : 'bg-white text-gray-600 border-gray-300 hover:border-indigo-400'
                }`}
              >
                Schedule
              </button>
            </div>
            {form.schedule_type === 'later' && (
              <input
                type="datetime-local"
                value={form.scheduled_at}
                onChange={(e) => setForm({ ...form, scheduled_at: e.target.value })}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
              />
            )}
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-xl border border-gray-300 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
            {form.schedule_type === 'later' ? (
              <button
                type="button"
                onClick={() => handleSend(false)}
                disabled={saving}
                className="flex-1 rounded-xl bg-indigo-600 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60 transition-colors"
              >
                {saving ? 'Scheduling...' : 'Schedule Campaign'}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => handleSend(true)}
                disabled={saving}
                className="flex-1 rounded-xl bg-indigo-600 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60 transition-colors"
              >
                {saving ? 'Sending...' : 'Send Campaign'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Campaign Results View ─────────────────────────────────────────────────────

function CampaignResults({
  campaign,
  onBack,
}: {
  campaign: Campaign;
  onBack: () => void;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [messages, setMessages] = useState<CampaignMessage[]>([]);
  const [stats, setStats] = useState<ResultsStats>({
    sent: 0,
    delivered: 0,
    clicked: 0,
    converted: 0,
    revenueAttributed: 0,
  });
  const [error, setError] = useState('');

  useEffect(() => {
    const token = localStorage.getItem('access_token');
    if (!token) { router.push('/login'); return; }

    async function fetchResults() {
      setLoading(true);
      setError('');
      try {
        const data = await apiFetch(`/merchant/campaigns/${campaign.id}/results`, {
          headers: { Authorization: `Bearer ${token}` },
        }) as { campaign: Campaign; messages: CampaignMessage[]; stats: ResultsStats };
        setMessages(data.messages ?? []);
        setStats(data.stats);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to load results';
        if (err instanceof ApiError && err.status === 401) {
          router.push('/login');
        } else {
          setError(msg);
        }
      } finally {
        setLoading(false);
      }
    }

    void fetchResults();
  }, [campaign.id, router]);

  const funnelSteps = [
    { label: 'Sent', value: stats.sent, color: 'bg-indigo-500' },
    { label: 'Delivered', value: stats.delivered, color: 'bg-blue-500' },
    { label: 'Clicked', value: stats.clicked, color: 'bg-green-500' },
    { label: 'Converted', value: stats.converted, color: 'bg-purple-500' },
  ];
  const maxVal = Math.max(stats.sent, 1);

  return (
    <div>
      {/* Back button + heading */}
      <div className="mb-6 flex items-center gap-3">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
          </svg>
          Back to Campaigns
        </button>
      </div>

      <div className="mb-6">
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-2xl font-bold text-gray-900">{campaign.name}</h1>
          <TypeBadge type={campaign.type} />
          <StatusBadge status={campaign.status} />
        </div>
        <p className="text-sm text-gray-500 mt-1">Sent {formatDateTime(campaign.sentAt)}</p>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-6">
        {[
          { label: 'Sent',       value: stats.sent,              color: 'text-indigo-600 bg-indigo-50 border-indigo-200' },
          { label: 'Delivered',  value: stats.delivered,         color: 'text-blue-600 bg-blue-50 border-blue-200' },
          { label: 'Clicked',    value: stats.clicked,           color: 'text-green-600 bg-green-50 border-green-200' },
          { label: 'Converted',  value: stats.converted,         color: 'text-purple-600 bg-purple-50 border-purple-200' },
          { label: 'Revenue',    value: `S$${stats.revenueAttributed.toFixed(2)}`, color: 'text-amber-600 bg-amber-50 border-amber-200' },
        ].map((s) => (
          <div key={s.label} className={`rounded-xl border p-4 ${s.color}`}>
            <p className="text-2xl font-bold">{s.value}</p>
            <p className="text-xs font-medium mt-0.5 opacity-80">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Conversion Funnel */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
        <h3 className="text-sm font-semibold text-gray-700 mb-4">Conversion Funnel</h3>
        <div className="space-y-3">
          {funnelSteps.map((step) => (
            <div key={step.label}>
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="font-medium text-gray-600">{step.label}</span>
                <span className="text-gray-500">
                  {step.value} ({pct(step.value, stats.sent)})
                </span>
              </div>
              <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className={`h-full ${step.color} rounded-full transition-all duration-700`}
                  style={{ width: `${(step.value / maxVal) * 100}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Message list */}
      {loading && <Spinner />}

      {!loading && error && (
        <div className="rounded-xl bg-red-50 border border-red-200 p-6 text-center">
          <p className="text-red-600 font-medium">{error}</p>
        </div>
      )}

      {!loading && !error && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100">
            <h3 className="text-sm font-semibold text-gray-700">Recipients</h3>
          </div>
          {messages.length === 0 ? (
            <div className="p-8 text-center text-gray-400 text-sm">No messages sent yet</div>
          ) : (
            <div className="divide-y divide-gray-100">
              {messages.map((m) => (
                <div key={m.message.id} className="px-5 py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">
                      {m.client.name ?? 'Unknown'}
                    </p>
                    <p className="text-xs text-gray-400">{m.client.phone}</p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {m.message.convertedAt && (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-700 border border-purple-200">
                        Converted
                      </span>
                    )}
                    {!m.message.convertedAt && m.message.clickedAt && (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700 border border-green-200">
                        Clicked
                      </span>
                    )}
                    {!m.message.clickedAt && m.message.deliveredAt && (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700 border border-blue-200">
                        Delivered
                      </span>
                    )}
                    {!m.message.deliveredAt && (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600 border border-gray-200">
                        {m.message.status}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Campaign List Row ─────────────────────────────────────────────────────────

function CampaignRow({
  campaign,
  onView,
}: {
  campaign: Campaign;
  onView: (campaign: Campaign) => void;
}) {
  const canView = campaign.status === 'sent' || campaign.status === 'completed';

  return (
    <div
      className={`bg-white rounded-xl border border-gray-200 p-4 shadow-sm transition-shadow ${
        canView ? 'hover:shadow-md cursor-pointer' : ''
      }`}
      onClick={canView ? () => onView(campaign) : undefined}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1.5">
            <span className="text-base font-semibold text-gray-900 truncate">{campaign.name}</span>
            <TypeBadge type={campaign.type} />
            <StatusBadge status={campaign.status} />
          </div>
          <p className="text-xs text-gray-400">
            {campaign.sentAt
              ? `Sent ${formatDate(campaign.sentAt)}`
              : campaign.scheduledAt
              ? `Scheduled ${formatDateTime(campaign.scheduledAt)}`
              : `Created ${formatDate(campaign.createdAt)}`}
          </p>
        </div>

        {/* Stats */}
        {(campaign.status === 'sent' || campaign.status === 'completed') && (
          <div className="flex gap-4 flex-shrink-0 text-right">
            {[
              { label: 'Sent',       value: campaign.recipientsCount ?? 0 },
              { label: 'Delivered',  value: campaign.deliveredCount ?? 0 },
              { label: 'Clicked',    value: campaign.clickedCount ?? 0 },
              { label: 'Converted',  value: campaign.convertedCount ?? 0 },
            ].map((s) => (
              <div key={s.label} className="hidden sm:block">
                <p className="text-sm font-semibold text-gray-900">{s.value}</p>
                <p className="text-xs text-gray-400">{s.label}</p>
              </div>
            ))}
            <div className="flex items-center">
              <svg className="w-4 h-4 text-gray-300" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
              </svg>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

export default function CampaignsPage() {
  const router = useRouter();
  const [view, setView] = useState<View>('list');
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [selectedCampaign, setSelectedCampaign] = useState<Campaign | null>(null);

  const fetchCampaigns = useCallback(async () => {
    const token = localStorage.getItem('access_token');
    if (!token) { router.push('/login'); return; }
    try {
      const data = await apiFetch('/merchant/campaigns', {
        headers: { Authorization: `Bearer ${token}` },
      }) as { campaigns: Campaign[] };
      setCampaigns(data.campaigns ?? []);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load campaigns';
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

    async function init() {
      setLoading(true);
      setError('');
      await fetchCampaigns();
      setLoading(false);
    }

    void init();
  }, [fetchCampaigns, router]);

  function handleViewResults(campaign: Campaign) {
    setSelectedCampaign(campaign);
    setView('results');
  }

  function handleBack() {
    setSelectedCampaign(null);
    setView('list');
  }

  // Results view
  if (view === 'results' && selectedCampaign) {
    return <CampaignResults campaign={selectedCampaign} onBack={handleBack} />;
  }

  // Stats summary
  const totalSent = campaigns.filter((c) => c.status === 'sent' || c.status === 'completed').length;
  const totalRecipients = campaigns.reduce((sum, c) => sum + (c.recipientsCount ?? 0), 0);
  const totalConverted = campaigns.reduce((sum, c) => sum + (c.convertedCount ?? 0), 0);

  return (
    <>
      {/* Header */}
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Campaigns</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Reach your clients with targeted WhatsApp messages
          </p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 transition-colors shadow-sm flex-shrink-0"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          Create Campaign
        </button>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        {[
          { label: 'Campaigns Sent', value: totalSent,       color: 'text-indigo-600 bg-indigo-50 border-indigo-200' },
          { label: 'Total Reached',  value: totalRecipients, color: 'text-green-600 bg-green-50 border-green-200' },
          { label: 'Conversions',    value: totalConverted,  color: 'text-purple-600 bg-purple-50 border-purple-200' },
        ].map((s) => (
          <div key={s.label} className={`rounded-xl border p-4 ${s.color}`}>
            <p className="text-2xl font-bold">{s.value}</p>
            <p className="text-xs font-medium mt-0.5 opacity-80">{s.label}</p>
          </div>
        ))}
      </div>

      {loading && <Spinner />}

      {!loading && error && (
        <div className="rounded-xl bg-red-50 border border-red-200 p-6 text-center">
          <p className="text-red-600 font-medium mb-3">{error}</p>
          <button
            onClick={() => { setError(''); void fetchCampaigns(); }}
            className="px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700 transition-colors"
          >
            Retry
          </button>
        </div>
      )}

      {!loading && !error && campaigns.length === 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <div className="text-4xl mb-3">📣</div>
          <h3 className="text-lg font-semibold text-gray-900 mb-1">No campaigns yet</h3>
          <p className="text-sm text-gray-500 mb-4">
            Create your first campaign to re-engage clients and drive bookings.
          </p>
          <button
            onClick={() => setShowCreate(true)}
            className="px-4 py-2 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 transition-colors"
          >
            Create Campaign
          </button>
        </div>
      )}

      {!loading && !error && campaigns.length > 0 && (
        <div className="space-y-3">
          {campaigns.map((campaign) => (
            <CampaignRow
              key={campaign.id}
              campaign={campaign}
              onView={handleViewResults}
            />
          ))}
        </div>
      )}

      {showCreate && (
        <CreateCampaignModal
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            void fetchCampaigns();
          }}
        />
      )}
    </>
  );
}
