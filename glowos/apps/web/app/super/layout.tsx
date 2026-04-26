'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';

interface User {
  id: string;
  name: string;
  email: string;
  role: string;
}

const NAV: Array<{ href: string; label: string }> = [
  { href: '/super', label: 'Overview' },
  { href: '/super/merchants', label: 'Merchants' },
  { href: '/super/users', label: 'Users' },
  { href: '/super/whatsapp-funnel', label: 'WhatsApp Funnel' },
  { href: '/super/audit-log', label: 'Audit Log' },
];

export default function SuperLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    const token = localStorage.getItem('access_token');
    if (!token) { router.push('/login'); return; }

    const rawUser = localStorage.getItem('user');
    const isSuper = localStorage.getItem('superAdmin') === 'true';
    const isImpersonating = localStorage.getItem('impersonating') === 'true';

    if (!isSuper) { router.push('/dashboard'); return; }
    if (isImpersonating) { router.push('/dashboard'); return; }

    try {
      setUser(JSON.parse(rawUser ?? '{}'));
    } catch {
      router.push('/login');
    }
  }, [router]);

  function handleLogout() {
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
    localStorage.removeItem('user');
    localStorage.removeItem('merchant');
    localStorage.removeItem('superAdmin');
    localStorage.removeItem('impersonating');
    localStorage.removeItem('impersonatingMerchant');
    localStorage.removeItem('actorEmail');
    router.push('/login');
  }

  return (
    <div className="min-h-screen bg-tone-surface-warm flex font-manrope">
      <aside className="hidden lg:flex flex-col w-60 bg-tone-ink text-tone-surface fixed inset-y-0 left-0 z-30">
        <div className="px-5 py-5 border-b border-white/10">
          <Link href="/" className="font-serif text-xl font-semibold tracking-tight">GlowOS</Link>
          <p className="text-[11px] text-white/50 mt-1 uppercase tracking-wider">Superadmin</p>
          {user && (
            <p className="text-xs font-medium text-white/80 mt-0.5 truncate">{user.email}</p>
          )}
        </div>
        <nav className="flex-1 px-3 py-4 space-y-0.5">
          {NAV.map((item) => {
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`block px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  active ? 'bg-white/10 text-tone-surface' : 'text-white/60 hover:bg-white/5 hover:text-tone-surface'
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="px-3 py-4 border-t border-white/10 space-y-1">
          <Link href="/dashboard" className="block px-3 py-2 rounded-lg text-xs font-medium text-white/60 hover:bg-white/5 hover:text-tone-surface">
            ← Back to my dashboard
          </Link>
          <button onClick={handleLogout} className="w-full text-left px-3 py-2 rounded-lg text-xs font-medium text-white/60 hover:bg-white/5 hover:text-tone-surface">
            Sign out
          </button>
        </div>
      </aside>
      <main className="flex-1 lg:ml-60 p-6 lg:p-8 min-w-0">
        {children}
      </main>
    </div>
  );
}
