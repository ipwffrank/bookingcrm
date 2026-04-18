'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { apiFetch, ApiError } from '../../../lib/api';

interface NoteEntry {
  id: string;
  staffName: string | null;
  content: string;
  createdAt: string;
}

export default function StaffClientProfilePage() {
  const router = useRouter();
  const params = useParams();
  const profileId = params.id as string;

  const [client, setClient] = useState<any>(null);
  const [notes, setNotes] = useState<NoteEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [newNote, setNewNote] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem('access_token');
    if (!token) { router.push('/login'); return; }

    Promise.all([
      apiFetch(`/merchant/clients/${profileId}`).catch(() => null),
      apiFetch(`/merchant/clients/${profileId}/notes`).catch(() => ({ notes: [] })),
    ]).then(([clientData, notesData]) => {
      if (clientData) setClient(clientData);
      setNotes((notesData as any).notes ?? []);
    }).finally(() => setLoading(false));
  }, [profileId, router]);

  async function handleAddNote() {
    if (!newNote.trim()) return;
    setSaving(true);
    try {
      const result = await apiFetch(`/merchant/clients/${profileId}/notes`, {
        method: 'POST',
        body: JSON.stringify({ content: newNote.trim() }),
      }) as { note: NoteEntry };
      setNotes(prev => [result.note, ...prev]);
      setNewNote('');
    } catch { alert('Failed to save'); }
    finally { setSaving(false); }
  }

  if (loading) return <div className="p-8 text-gray-400 animate-pulse font-manrope">Loading...</div>;
  if (!client) return <div className="p-8 text-gray-500 font-manrope">Client not found</div>;

  const profile = client.profile;
  const clientInfo = client.client;

  return (
    <div className="max-w-2xl mx-auto space-y-4 font-manrope">
      {/* Back nav */}
      <Link href="/staff/clients" className="inline-flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-800 transition-colors">
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7"/></svg>
        All Clients
      </Link>

      {/* Header */}
      <div className="flex items-center gap-4">
        <div className="w-12 h-12 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-600 font-bold text-lg">
          {(clientInfo?.name ?? '?')[0].toUpperCase()}
        </div>
        <div>
          <h1 className="text-lg font-semibold text-gray-900">{clientInfo?.name ?? 'Client'}</h1>
          <p className="text-xs text-gray-500">{clientInfo?.phone} {clientInfo?.email ? `· ${clientInfo.email}` : ''}</p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-gray-50 rounded-xl p-3 text-center">
          <p className="text-lg font-bold text-gray-900">{profile?.totalVisits ?? 0}</p>
          <p className="text-[10px] text-gray-500">Visits</p>
        </div>
        <div className="bg-gray-50 rounded-xl p-3 text-center">
          <p className="text-lg font-bold text-gray-900">S${parseFloat(profile?.totalSpendSgd ?? '0').toFixed(0)}</p>
          <p className="text-[10px] text-gray-500">Revenue</p>
        </div>
        <div className="bg-gray-50 rounded-xl p-3 text-center">
          <p className="text-xs font-semibold text-gray-900">{profile?.lastVisitAt ? new Date(profile.lastVisitAt).toLocaleDateString('en-SG', { day: 'numeric', month: 'short' }) : '—'}</p>
          <p className="text-[10px] text-gray-500">Last Visit</p>
        </div>
      </div>

      {/* Treatment Log */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h2 className="text-sm font-semibold text-gray-900 mb-4">Treatment Log</h2>

        {/* Add entry */}
        <div className="mb-4 space-y-2">
          <textarea
            value={newNote}
            onChange={e => setNewNote(e.target.value)}
            rows={3}
            placeholder="Treatment details, client preferences, observations..."
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-1 focus:ring-indigo-500/30 resize-none"
          />
          <button
            onClick={handleAddNote}
            disabled={!newNote.trim() || saving}
            className="px-4 py-1.5 bg-[#1a2313] text-white text-xs font-medium rounded-lg hover:bg-[#2f3827] disabled:opacity-50 transition-colors"
          >
            {saving ? 'Saving...' : 'Add Entry'}
          </button>
        </div>

        {/* Log entries */}
        {notes.length === 0 ? (
          <p className="text-xs text-gray-400 italic">No entries yet.</p>
        ) : (
          <div className="space-y-3 max-h-[500px] overflow-y-auto">
            {notes.map(entry => (
              <div key={entry.id} className="border-l-2 border-indigo-200 pl-3 py-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-gray-700">{entry.staffName || 'Admin'}</span>
                  <span className="text-[10px] text-gray-400">
                    {new Date(entry.createdAt).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' })}
                    {' '}
                    {new Date(entry.createdAt).toLocaleTimeString('en-SG', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
                <p className="text-xs text-gray-600 mt-1 leading-relaxed whitespace-pre-wrap">{entry.content}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
