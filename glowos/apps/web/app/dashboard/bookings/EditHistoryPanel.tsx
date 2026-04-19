'use client';

import { useState } from 'react';
import { apiFetch } from '../../lib/api';

type EditRow = {
  id: string;
  createdAt: string;
  fieldName: string;
  oldValue: unknown;
  newValue: unknown;
  editedByRole: string;
};

export function EditHistoryPanel({ bookingId }: { bookingId: string }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<EditRow[] | null>(null);

  async function toggle() {
    if (open) { setOpen(false); return; }
    if (!rows) {
      const token = localStorage.getItem('access_token');
      const res = (await apiFetch(`/merchant/bookings/${bookingId}/edits`, {
        headers: { Authorization: `Bearer ${token}` },
      })) as { edits: EditRow[] };
      setRows(res.edits ?? []);
    }
    setOpen(true);
  }

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={toggle}
        className="text-xs font-medium text-indigo-600 hover:text-indigo-700"
      >
        {open ? 'Hide history' : 'View history'}
      </button>
      {open && rows && (
        <div className="mt-2 max-h-40 overflow-y-auto rounded-lg border border-gray-200 bg-gray-50 p-2 text-xs space-y-1">
          {rows.length === 0 ? (
            <p className="text-gray-500">No edits yet.</p>
          ) : (
            rows.map((e) => (
              <div key={e.id} className="flex items-baseline gap-2">
                <span className="text-gray-400">
                  {new Date(e.createdAt).toLocaleString('en-SG')}
                </span>
                <span className="font-medium">{e.editedByRole}</span>
                <span>changed <code>{e.fieldName}</code></span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
