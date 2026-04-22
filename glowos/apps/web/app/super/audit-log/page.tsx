'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '../../lib/api';

interface AuditEntry {
  id: string;
  actorUserId: string | null;
  actorEmail: string;
  action: 'impersonate_start' | 'impersonate_end' | 'write' | 'read';
  targetMerchantId: string | null;
  targetMerchantName: string | null;
  method: string | null;
  path: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

const ACTION_LABEL: Record<AuditEntry['action'], string> = {
  impersonate_start: 'Impersonation started',
  impersonate_end: 'Impersonation ended',
  write: 'Write',
  read: 'Read',
};

function formatTs(iso: string): string {
  return new Date(iso).toLocaleString('en-SG', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

export default function SuperAuditLogPage() {
  const [rows, setRows] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    apiFetch('/super/audit-log?limit=200')
      .then((d) => setRows(d.entries as AuditEntry[]))
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-tone-ink">Audit log</h1>
        <p className="text-sm text-grey-60 mt-0.5">Every superadmin action, most recent first.</p>
      </div>

      {error && (
        <div className="mb-4 rounded-lg bg-semantic-danger/5 border border-semantic-danger/30 px-4 py-3 text-sm text-semantic-danger">
          {error}
        </div>
      )}

      <div className="bg-tone-surface rounded-xl border border-grey-15 overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-grey-45 text-sm">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="p-8 text-center text-grey-45 text-sm">No audit entries yet.</div>
        ) : (
          <ul className="divide-y divide-grey-5">
            {rows.map((r) => (
              <li key={r.id} className="px-4 py-3">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-tone-ink">
                      <span className="font-semibold">{ACTION_LABEL[r.action]}</span>
                      {r.targetMerchantName && (
                        <span className="text-grey-75"> · {r.targetMerchantName}</span>
                      )}
                    </p>
                    <p className="text-xs text-grey-60 mt-0.5">
                      <span className="font-mono">{r.actorEmail}</span>
                      {r.method && r.path && (
                        <span className="text-grey-45"> · {r.method} {r.path}</span>
                      )}
                    </p>
                  </div>
                  <p className="text-xs text-grey-45 shrink-0 tabular-nums">{formatTs(r.createdAt)}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
