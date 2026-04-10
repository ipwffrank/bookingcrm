'use client';

import DashboardShell from '../components/DashboardShell';

export default function MarketingPage() {
  return (
    <DashboardShell>
      <div className="max-w-5xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Marketing</h1>
          <p className="text-gray-500 text-sm mt-0.5">AI-powered campaigns to re-engage clients</p>
        </div>

        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-8 text-center">
          <div className="text-5xl mb-4">📣</div>
          <h2 className="text-lg font-semibold text-gray-900 mb-2">Campaigns coming soon</h2>
          <p className="text-gray-500 text-sm max-w-sm mx-auto">
            AI-powered WhatsApp campaigns to win back lapsed clients and drive rebookings —
            launching in the next release.
          </p>
        </div>
      </div>
    </DashboardShell>
  );
}
