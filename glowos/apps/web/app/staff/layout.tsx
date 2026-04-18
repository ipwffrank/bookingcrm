'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { apiFetch } from '../lib/api';

function MenuIcon() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
    </svg>
  );
}
function XIcon() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
    </svg>
  );
}

interface StaffInfo {
  name: string;
  merchantName: string;
}

export default function StaffLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [info, setInfo] = useState<StaffInfo | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);

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
    { href: '/staff/bookings', label: 'All Bookings' },
    { href: '/staff/my-bookings', label: 'My Bookings' },
    { href: '/staff/clients', label: 'Clients' },
  ];

  const sidebarContent = (
    <>
      <div className="px-5 py-5 border-b border-gray-100">
        <Link href="/" className="font-newsreader text-xl font-semibold text-[#1a2313] hover:text-[#456466] transition-colors">GlowOS</Link>
        {info && (
          <>
            <p className="font-inter text-[11px] text-gray-400 mt-1 truncate uppercase tracking-wider">{info.merchantName}</p>
            <p className="text-xs font-medium text-gray-700 mt-0.5 truncate">{info.name}</p>
          </>
        )}
      </div>
      <nav className="flex-1 px-3 py-4 space-y-0.5">
        {NAV.map(item => (
          <Link
            key={item.href}
            href={item.href}
            onClick={() => setMobileOpen(false)}
            className={`flex items-center px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
              pathname === item.href ? 'bg-[#1a2313]/8 text-[#1a2313]' : 'text-gray-500 hover:bg-gray-50 hover:text-gray-800'
            }`}
          >
            {item.label}
          </Link>
        ))}
      </nav>
      <div className="px-3 py-4 border-t border-gray-100">
        <button onClick={handleLogout} className="flex items-center gap-2 px-3 py-2.5 w-full rounded-lg text-sm font-medium text-gray-500 hover:bg-gray-50 hover:text-gray-700 transition-colors">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0 0 13.5 3h-6a2.25 2.25 0 0 0-2.25 2.25v13.5A2.25 2.25 0 0 0 7.5 21h6a2.25 2.25 0 0 0 2.25-2.25V15M12 9l-3 3m0 0 3 3m-3-3h12.75" />
          </svg>
          Logout
        </button>
      </div>
    </>
  );

  return (
    <div className="min-h-screen bg-gray-50 flex font-manrope">
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex flex-col w-56 bg-white border-r border-gray-200 fixed inset-y-0 left-0 z-30">
        {sidebarContent}
      </aside>

      {/* Mobile sidebar overlay */}
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-40 flex">
          <div className="fixed inset-0 bg-black/30" onClick={() => setMobileOpen(false)} />
          <aside className="relative z-50 flex flex-col w-64 bg-white shadow-xl">
            <div className="absolute top-4 right-4">
              <button onClick={() => setMobileOpen(false)} className="p-1 rounded-md text-gray-400 hover:text-gray-600">
                <XIcon />
              </button>
            </div>
            {sidebarContent}
          </aside>
        </div>
      )}

      <div className="flex-1 lg:ml-56 flex flex-col min-h-screen">
        {/* Mobile top bar */}
        <header className="lg:hidden bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between sticky top-0 z-20">
          <button onClick={() => setMobileOpen(true)} className="p-2 rounded-md text-gray-500 hover:bg-gray-100">
            <MenuIcon />
          </button>
          <Link href="/" className="font-newsreader text-lg font-semibold text-[#1a2313] hover:text-[#456466] transition-colors">GlowOS</Link>
          <button onClick={handleLogout} className="text-sm text-gray-500 hover:text-gray-700">Logout</button>
        </header>

        <main className="flex-1 p-4 lg:p-6 min-w-0">
          {children}
        </main>
      </div>
    </div>
  );
}
