'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch } from '../lib/api';

export default function DashboardPage() {
  const router = useRouter();
  const [merchant, setMerchant] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('access_token');
    if (!token) {
      router.push('/login');
      return;
    }
    apiFetch('/merchant/me', {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((data) => setMerchant(data))
      .catch(() => router.push('/login'))
      .finally(() => setLoading(false));
  }, [router]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-gray-500">Loading dashboard...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
        <div className="text-xl font-bold text-indigo-600">GlowOS</div>
        <div className="flex items-center gap-4">
          <span className="text-sm text-gray-600">{merchant?.name}</span>
          <button
            onClick={() => {
              localStorage.clear();
              router.push('/login');
            }}
            className="text-sm text-gray-500 hover:text-gray-700"
          >
            Logout
          </button>
        </div>
      </header>
      <main className="max-w-4xl mx-auto px-6 py-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Welcome to your dashboard</h1>
        <p className="text-gray-500 mb-8">Manage your salon, bookings, and clients.</p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h2 className="font-semibold text-gray-900 mb-1">Your booking page</h2>
            <p className="text-sm text-gray-500 mb-3">Share this link with clients</p>
            <a
              href={`/${merchant?.slug}`}
              className="text-indigo-600 text-sm font-medium hover:underline"
              target="_blank"
            >
              glowos.vercel.app/{merchant?.slug}
            </a>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h2 className="font-semibold text-gray-900 mb-1">Next steps</h2>
            <ul className="text-sm text-gray-600 space-y-1 mt-2">
              <li>1. Add your services</li>
              <li>2. Add your staff</li>
              <li>3. Set up payments (Stripe)</li>
              <li>4. Share your booking link</li>
            </ul>
          </div>
        </div>
      </main>
    </div>
  );
}
