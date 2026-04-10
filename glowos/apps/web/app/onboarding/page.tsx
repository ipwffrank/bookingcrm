'use client';

import { useRouter } from 'next/navigation';

export default function OnboardingPage() {
  const router = useRouter();

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-purple-50 flex items-center justify-center px-4">
      <div className="w-full max-w-md text-center">
        <div className="text-5xl mb-4">🎉</div>
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Account created!</h1>
        <p className="text-gray-500 mb-8">
          Your salon is ready. Head to the dashboard to add services, staff, and start accepting bookings.
        </p>
        <button
          onClick={() => router.push('/dashboard')}
          className="rounded-xl bg-indigo-600 px-8 py-3 text-sm font-semibold text-white hover:bg-indigo-700 transition-colors"
        >
          Go to Dashboard
        </button>
      </div>
    </div>
  );
}
