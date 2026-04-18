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
  const [clientPackagesData, setClientPackagesData] = useState<any[]>([]);
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

  // Fetch client packages once client data is available
  useEffect(() => {
    const cId = client?.client?.id;
    if (!cId) return;
    apiFetch(`/merchant/packages/client/${cId}`)
      .then((d: any) => setClientPackagesData(d.packages ?? []))
      .catch(() => {});
  }, [client?.client?.id]);

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
      {/* Package Progress */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h2 className="text-sm font-semibold text-gray-900 mb-4">Packages</h2>
        {clientPackagesData.length === 0 ? (
          <p className="text-xs text-gray-400 italic">No packages assigned.</p>
        ) : (
          <div className="space-y-4">
            {clientPackagesData.map((pkg: any) => (
              <div key={pkg.id} className="border border-gray-100 rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-semibold text-gray-900">{pkg.packageName}</h3>
                  <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${
                    pkg.status === 'active' ? 'bg-green-50 text-green-700' :
                    pkg.status === 'completed' ? 'bg-gray-100 text-gray-500' :
                    'bg-red-50 text-red-600'
                  }`}>{pkg.status}</span>
                </div>
                {/* Progress bar */}
                <div className="flex items-center gap-3 mb-3">
                  <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full bg-indigo-500 rounded-full transition-all" style={{ width: `${(pkg.sessionsUsed / pkg.sessionsTotal) * 100}%` }} />
                  </div>
                  <span className="text-xs font-medium text-gray-600">{pkg.sessionsUsed}/{pkg.sessionsTotal}</span>
                </div>
                {/* Session list */}
                <div className="space-y-1.5">
                  {pkg.sessions?.map((s: any) => (
                    <div key={s.id} className="flex items-center justify-between text-xs py-1 border-b border-gray-50 last:border-0">
                      <div className="flex items-center gap-2">
                        <span className={`w-2 h-2 rounded-full ${
                          s.status === 'completed' ? 'bg-green-400' :
                          s.status === 'booked' ? 'bg-blue-400' :
                          'bg-gray-300'
                        }`} />
                        <span className="text-gray-700">Session {s.sessionNumber}</span>
                      </div>
                      <span className="text-gray-400 capitalize">{s.status}{s.completedAt ? ` \u00B7 ${new Date(s.completedAt).toLocaleDateString('en-SG', { day: 'numeric', month: 'short' })}` : ''}</span>
                    </div>
                  ))}
                </div>
                <p className="text-[10px] text-gray-400 mt-2">Expires {new Date(pkg.expiresAt).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' })}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
