'use client';

import { useState } from 'react';
import { apiFetch, ApiError } from '../../lib/api';

interface Props {
  slug: string;
  serviceId: string;
  staffId: string;
  staffName: string;
  targetDate: string;     // 'YYYY-MM-DD'
  defaultWindowStart: string; // 'HH:MM'
  defaultWindowEnd: string;   // 'HH:MM'
  defaultName?: string;
  defaultPhone?: string;
  defaultEmail?: string;
}

export function JoinWaitlistCard(props: Props) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(props.defaultName ?? '');
  const [phone, setPhone] = useState(props.defaultPhone ?? '');
  const [email, setEmail] = useState(props.defaultEmail ?? '');
  const [windowStart, setWindowStart] = useState(props.defaultWindowStart);
  const [windowEnd, setWindowEnd] = useState(props.defaultWindowEnd);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);

  async function submit() {
    if (!name.trim() || !phone.trim()) {
      setResult({ ok: false, msg: 'Name and phone are required' });
      return;
    }
    setSubmitting(true);
    try {
      await apiFetch('/waitlist', {
        method: 'POST',
        body: JSON.stringify({
          merchant_slug: props.slug,
          client_name: name,
          client_phone: phone,
          client_email: email || undefined,
          service_id: props.serviceId,
          staff_id: props.staffId,
          target_date: props.targetDate,
          window_start: windowStart,
          window_end: windowEnd,
        }),
      });
      setResult({ ok: true, msg: "You're on the waitlist! We'll WhatsApp you if a slot opens." });
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Failed to join waitlist';
      setResult({ ok: false, msg });
    } finally {
      setSubmitting(false);
    }
  }

  if (result?.ok) {
    return (
      <div className="mt-4 rounded-xl bg-tone-sage/5 border border-tone-sage/30 px-4 py-3 text-sm text-tone-sage">
        {result.msg}
      </div>
    );
  }

  if (!open) {
    // Secondary CTA — the primary action above is "jump to next available date".
    // Waitlist is the fallback when the customer would rather wait for THIS day.
    // Outline style + full width + lighter weight makes the hierarchy obvious
    // and keeps both buttons visually anchored to the same vertical column.
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-3 w-full px-4 py-2 bg-tone-surface border border-grey-30 text-tone-ink text-xs font-medium rounded-lg hover:bg-grey-5 transition-colors"
      >
        Or join the waitlist for this day
      </button>
    );
  }

  return (
    <div className="mt-4 bg-tone-surface border border-grey-15 rounded-xl px-4 py-3 text-left">
      <p className="text-xs font-semibold text-tone-ink mb-2">
        Notify me if {props.staffName} has an opening on {props.targetDate}
      </p>
      <div className="grid grid-cols-2 gap-2 mb-2">
        <input
          type="time"
          value={windowStart}
          onChange={(e) => setWindowStart(e.target.value)}
          className="rounded-lg border border-grey-30 px-3 py-2 text-sm"
          aria-label="Window start"
        />
        <input
          type="time"
          value={windowEnd}
          onChange={(e) => setWindowEnd(e.target.value)}
          className="rounded-lg border border-grey-30 px-3 py-2 text-sm"
          aria-label="Window end"
        />
      </div>
      <input
        type="text"
        placeholder="Your name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="w-full mb-2 rounded-lg border border-grey-30 px-3 py-2 text-sm"
      />
      <input
        type="tel"
        placeholder="Phone (WhatsApp)"
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
        className="w-full mb-2 rounded-lg border border-grey-30 px-3 py-2 text-sm"
      />
      <input
        type="email"
        placeholder="Email (optional)"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="w-full mb-2 rounded-lg border border-grey-30 px-3 py-2 text-sm"
      />
      {result && !result.ok && (
        <p className="text-xs text-semantic-danger mb-2">{result.msg}</p>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="flex-1 px-3 py-2 border border-grey-30 text-xs font-semibold rounded-lg hover:bg-grey-5"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={submitting}
          className="flex-1 px-3 py-2 bg-tone-ink text-white text-xs font-semibold rounded-lg hover:opacity-90 disabled:opacity-60"
        >
          {submitting ? 'Submitting…' : 'Join waitlist'}
        </button>
      </div>
    </div>
  );
}
