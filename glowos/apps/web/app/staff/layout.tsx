'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { apiFetch } from '../lib/api';

interface StaffInfo {
  name: string;
  merchantName: string;
}

export default function StaffLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [info, setInfo] = useState<StaffInfo | null>(null);

  useEffect(() => {
    const token = localStorage.getItem('access_token');
    if (!token) { router.push('/login'); return; }
    const user = JSON.parse(localStorage.getItem('user') ?? '{}');
    if (user.role !== 'staff') { router.push('/dashboard'); return; }

    apiFetch('/staff/me')
      .then((data: { staff: { name: string }; merchant: { name: string } }) => {
        setInfo({ name: data.staff?.name ?? user.name, merchantName: data.merchant?.name ?? '' });
      })
      .catch(() => router.push('/login'));
  }, [router]);

  function handleLogout() {
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
    localStorage.removeItem('user');
    localStorage.removeItem('merchant');
    router.push('/login');
  }

  const NAV = [
    { href: '/staff/dashboard', label: 'My Schedule' },
    { href: '/staff/bookings', label: 'All Bookings' },
    { href: '/staff/my-bookings', label: 'My Bookings' },
  ];

  return (
    <div className="min-h-screen bg-gray-50 flex">
      <aside className="hidden lg:flex flex-col w-56 bg-white border-r border-gray-200 fixed inset-y-0 left-0 z-30">
        <div className="px-5 py-5 border-b border-gray-100">
          <Link href="/" className="text-xl font-bold text-indigo-600">GlowOS</Link>
          {info && (
            <>
              <p className="text-xs text-gray-500 mt-0.5 truncate">{info.merchantName}</p>
              <p className="text-xs font-medium text-gray-700 mt-0.5 truncate">{info.name}</p>
            </>
          )}
        </div>
        <nav className="flex-1 px-3 py-4 space-y-1">
          {NAV.map(item => (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                pathname === item.href ? 'bg-indigo-50 text-indigo-700' : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="px-3 py-4 border-t border-gray-100">
          <button onClick={handleLogout} className="flex items-center gap-2 px-3 py-2.5 w-full rounded-lg text-sm font-medium text-gray-500 hover:bg-gray-50">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0 0 13.5 3h-6a2.25 2.25 0 0 0-2.25 2.25v13.5A2.25 2.25 0 0 0 7.5 21h6a2.25 2.25 0 0 0 2.25-2.25V15M12 9l-3 3m0 0 3 3m-3-3h12.75" />
            </svg>
            Logout
          </button>
        </div>
      </aside>
      <div className="flex-1 lg:ml-56 p-6">
        {children}
      </div>
    </div>
  );
}
