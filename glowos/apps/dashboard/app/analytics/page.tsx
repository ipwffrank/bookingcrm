'use client';

import DashboardShell from '../components/DashboardShell';

export default function AnalyticsPage() {
  return (
    <DashboardShell>
      <div className="max-w-5xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Analytics</h1>
          <p className="text-gray-500 text-sm mt-0.5">Insights into your salon&apos;s performance</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[
            { label: 'Revenue This Month', value: '—', icon: '💰' },
            { label: 'Bookings This Month', value: '—', icon: '📅' },
            { label: 'New Clients', value: '—', icon: '👥' },
          ].map((stat) => (
            <div
              key={stat.label}
              className="bg-white rounded-xl border border-gray-100 shadow-sm px-5 py-5"
            >
              <div className="text-2xl mb-2">{stat.icon}</div>
              <div className="text-2xl font-bold text-gray-900">{stat.value}</div>
              <div className="text-sm text-gray-500 mt-1">{stat.label}</div>
            </div>
          ))}
        </div>

        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-8 text-center">
          <div className="text-5xl mb-4">📊</div>
          <h2 className="text-lg font-semibold text-gray-900 mb-2">Full analytics coming soon</h2>
          <p className="text-gray-500 text-sm max-w-sm mx-auto">
            Revenue charts, retention rates, VIP trends, and more — launching in the next release.
          </p>
        </div>
      </div>
    </DashboardShell>
  );
}
