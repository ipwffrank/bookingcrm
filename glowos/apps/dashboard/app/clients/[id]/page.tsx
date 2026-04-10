'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { apiFetch } from '../../lib/api';
import DashboardShell from '../../components/DashboardShell';

type VipTier = 'bronze' | 'silver' | 'gold' | 'platinum';
type BookingStatus = 'confirmed' | 'in_progress' | 'completed' | 'cancelled' | 'no_show';

interface ClientProfile {
  client: {
    id: string;
    name: string | null;
    phone: string;
    email: string | null;
  };
  profile: {
    vipTier: VipTier | null;
    totalSpend: string | null;
    visitCount: number | null;
    avgSpendPerVisit: string | null;
    visitCadenceDays: number | null;
    predictedNextVisit: string | null;
    preferredStaffId: string | null;
    notes: string | null;
    churnRisk: string | null;
  } | null;
  recentBookings: Array<{
    booking: { id: string; startTime: string; status: BookingStatus; priceSgd: string };
    service: { name: string };
    staffMember: { name: string };
  }>;
  preferredStaff: { name: string } | null;
}

const VIP_BADGES: Record<VipTier, string> = {
  platinum: '💎 Platinum',
  gold: '🥇 Gold',
  silver: '🥈 Silver',
  bronze: '🥉 Bronze',
};

const STATUS_STYLES: Record<BookingStatus, string> = {
  confirmed: 'bg-green-100 text-green-700',
  in_progress: 'bg-blue-100 text-blue-700',
  completed: 'bg-gray-100 text-gray-600',
  cancelled: 'bg-red-100 text-red-600',
  no_show: 'bg-orange-100 text-orange-700',
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-SG', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export default function ClientProfilePage() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<ClientProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [addingNote, setAddingNote] = useState(false);
  const [note, setNote] = useState('');

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const res = (await apiFetch(`/merchant/clients/${id}`)) as ClientProfile;
        setData(res);
        setNote(res.profile?.notes ?? '');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load client');
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, [id]);

  async function saveNote() {
    try {
      await apiFetch(`/merchant/clients/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ notes: note }),
      });
      setAddingNote(false);
    } catch {
      alert('Failed to save note');
    }
  }

  return (
    <DashboardShell>
      <div className="max-w-3xl mx-auto space-y-6">
        <div className="flex items-center gap-3">
          <Link href="/clients" className="text-sm text-gray-500 hover:text-indigo-600">
            ← Clients
          </Link>
        </div>

        {loading && (
          <div className="flex justify-center py-16">
            <div className="w-8 h-8 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin" />
          </div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-600">
            {error}
          </div>
        )}

        {data && (
          <>
            {/* Client header */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-6 py-6">
              <div className="flex items-start gap-4">
                <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-300 to-purple-400 flex items-center justify-center text-white text-2xl font-bold shrink-0">
                  {(data.client.name ?? data.client.phone).charAt(0).toUpperCase()}
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-3 flex-wrap">
                    <h1 className="text-2xl font-bold text-gray-900">
                      {data.client.name ?? data.client.phone}
                    </h1>
                    {data.profile?.vipTier && (
                      <span className="text-sm font-medium text-indigo-600 bg-indigo-50 rounded-full px-3 py-1">
                        {VIP_BADGES[data.profile.vipTier]}
                      </span>
                    )}
                  </div>
                  <div className="text-sm text-gray-500 mt-1 space-x-3">
                    <span>{data.client.phone}</span>
                    {data.client.email && <span>{data.client.email}</span>}
                  </div>
                  {data.profile?.churnRisk === 'high' && (
                    <div className="mt-2 inline-flex items-center gap-1 rounded-full bg-red-50 border border-red-200 px-3 py-1 text-xs font-medium text-red-600">
                      ⚠️ High churn risk
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Stats */}
            {data.profile && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  {
                    label: 'Total Spend',
                    value: data.profile.totalSpend
                      ? `SGD ${parseFloat(data.profile.totalSpend).toFixed(0)}`
                      : '—',
                  },
                  {
                    label: 'Visits',
                    value: data.profile.visitCount ?? '—',
                  },
                  {
                    label: 'Avg / Visit',
                    value: data.profile.avgSpendPerVisit
                      ? `SGD ${parseFloat(data.profile.avgSpendPerVisit).toFixed(0)}`
                      : '—',
                  },
                  {
                    label: 'Cadence',
                    value: data.profile.visitCadenceDays
                      ? `Every ${data.profile.visitCadenceDays}d`
                      : '—',
                  },
                ].map((stat) => (
                  <div
                    key={stat.label}
                    className="bg-white rounded-xl border border-gray-100 px-4 py-3"
                  >
                    <div className="text-xs text-gray-500 mb-1">{stat.label}</div>
                    <div className="text-lg font-bold text-gray-900">{stat.value}</div>
                  </div>
                ))}
              </div>
            )}

            {/* Preferences */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-6 py-5">
              <h2 className="text-sm font-semibold text-gray-700 mb-4">Preferences</h2>
              <div className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-500">Preferred stylist</span>
                  <span className="font-medium text-gray-900">
                    {data.preferredStaff?.name ?? '—'}
                  </span>
                </div>
                {data.profile?.predictedNextVisit && (
                  <div className="flex justify-between">
                    <span className="text-gray-500">Predicted next visit</span>
                    <span className="font-medium text-gray-900">
                      {formatDate(data.profile.predictedNextVisit)}
                    </span>
                  </div>
                )}
              </div>

              {/* Notes */}
              <div className="mt-4 pt-4 border-t border-gray-100">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-gray-700">Notes</span>
                  <button
                    onClick={() => setAddingNote(!addingNote)}
                    className="text-xs text-indigo-600 hover:underline"
                  >
                    {addingNote ? 'Cancel' : 'Edit'}
                  </button>
                </div>
                {addingNote ? (
                  <div className="space-y-2">
                    <textarea
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      rows={3}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
                      placeholder="Add notes about this client…"
                    />
                    <button
                      onClick={saveNote}
                      className="rounded-lg bg-indigo-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 transition-colors"
                    >
                      Save Note
                    </button>
                  </div>
                ) : (
                  <p className="text-sm text-gray-500">
                    {data.profile?.notes || 'No notes yet.'}
                  </p>
                )}
              </div>
            </div>

            {/* Visit history */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-50">
                <h2 className="text-sm font-semibold text-gray-700">Visit History</h2>
              </div>
              {data.recentBookings.length === 0 && (
                <div className="text-center py-8 text-gray-400 text-sm">No visits yet</div>
              )}
              {data.recentBookings.map((row, idx) => (
                <div
                  key={row.booking.id}
                  className={`flex items-center gap-4 px-6 py-4 ${idx > 0 ? 'border-t border-gray-50' : ''}`}
                >
                  <div className="flex-1">
                    <div className="text-sm font-medium text-gray-900">{row.service.name}</div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      {formatDate(row.booking.startTime)} · {row.staffMember.name}
                    </div>
                  </div>
                  <div className="text-right shrink-0 space-y-1">
                    <div className="text-sm font-medium text-gray-900">
                      SGD {parseFloat(row.booking.priceSgd).toFixed(2)}
                    </div>
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[row.booking.status]}`}
                    >
                      {row.booking.status.replace('_', ' ')}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </DashboardShell>
  );
}
