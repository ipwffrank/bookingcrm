'use client';

import { useState } from 'react';
import { apiFetch } from '../../lib/api';

export interface WaitlistEntry {
  id: string;
  clientName: string | null;
  clientPhone: string | null;
  serviceName: string;
  staffName: string;
  targetDate: string;
  windowStart: string;
  windowEnd: string;
  status: 'pending' | 'notified' | 'booked' | 'expired' | 'cancelled';
  holdExpiresAt: string | null;
}

interface Props {
  entries: WaitlistEntry[];
  onEntriesChange: (entries: WaitlistEntry[]) => void;
}

export function WaitlistCard({ entries, onEntriesChange }: Props) {
  const [expanded, setExpanded] = useState(false);

  async function remove(id: string) {
    const token = localStorage.getItem('access_token');
    await apiFetch(`/merchant/waitlist/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    }).catch(() => {});
    onEntriesChange(entries.filter((e) => e.id !== id));
  }

  if (entries.length === 0) {
    return (
      <div className="mb-4 bg-tone-surface rounded-xl border border-grey-15 p-4">
        <h2 className="text-sm font-semibold text-tone-ink mb-1">📋 Waitlist</h2>
        <p className="text-xs text-grey-45 italic">No one on the waitlist right now.</p>
      </div>
    );
  }

  const shown = expanded ? entries : entries.slice(0, 5);
  const more = entries.length - shown.length;

  return (
    <div className="mb-4 bg-tone-surface rounded-xl border border-grey-15 p-4">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-semibold text-tone-ink">📋 Waitlist ({entries.length} active)</h2>
        {more > 0 && !expanded && (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="text-xs font-medium text-tone-sage hover:text-tone-sage"
          >
            + view all
          </button>
        )}
        {expanded && entries.length > 5 && (
          <button
            type="button"
            onClick={() => setExpanded(false)}
            className="text-xs font-medium text-grey-60 hover:text-grey-75"
          >
            − collapse
          </button>
        )}
      </div>
      <ul className="divide-y divide-grey-5">
        {shown.map((e) => (
          <li key={e.id} className="flex items-center gap-2 py-2 text-xs">
            <span className="flex-1 min-w-0">
              <span className="font-medium text-tone-ink">{e.clientName ?? 'Unknown'}</span>
              {e.clientPhone && (
                <>
                  {' · '}
                  <a href={`tel:${e.clientPhone}`} className="text-tone-sage hover:underline">{e.clientPhone}</a>
                </>
              )}
              {' · '}
              <span className="text-grey-75">{e.serviceName}</span>
              {' · '}
              <span className="text-grey-75">{e.staffName}</span>
              {' · '}
              <span className="text-grey-60">{e.targetDate} {e.windowStart}–{e.windowEnd}</span>
            </span>
            <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${
              e.status === 'notified' ? 'bg-semantic-warn/5 text-semantic-warn' :
              e.status === 'pending'  ? 'bg-grey-15 text-grey-75' :
              'bg-grey-15 text-grey-60'
            }`}>
              {e.status === 'notified' && e.holdExpiresAt
                ? `notified · ${Math.max(0, Math.round((new Date(e.holdExpiresAt).getTime() - Date.now()) / 60000))}m left`
                : e.status}
            </span>
            <button
              type="button"
              onClick={() => remove(e.id)}
              className="text-semantic-danger hover:text-semantic-danger text-xs"
              aria-label="Remove from waitlist"
            >
              ×
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
