'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { BranchPicker } from './components/BranchPicker';

interface Group {
  id: string;
  name: string;
}

const GROUP_NAV = [
  { href: '/dashboard/group/overview', label: 'Overview', icon: ChartIcon },
  { href: '/dashboard/group/branches', label: 'Branches', icon: BuildingIcon },
  { href: '/dashboard/group/clients', label: 'Clients', icon: UsersIcon },
  { href: '/dashboard/group/admins', label: 'Admins', icon: ShieldIcon },
];

function ShieldIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12c0 1.268-.63 2.39-1.593 3.068a3.745 3.745 0 0 1-1.043 3.296 3.745 3.745 0 0 1-3.296 1.043A3.745 3.745 0 0 1 12 21c-1.268 0-2.39-.63-3.068-1.593a3.746 3.746 0 0 1-3.296-1.043 3.745 3.745 0 0 1-1.043-3.296A3.745 3.745 0 0 1 3 12c0-1.268.63-2.39 1.593-3.068a3.745 3.745 0 0 1 1.043-3.296 3.745 3.745 0 0 1 3.296-1.043A3.745 3.745 0 0 1 12 3c1.268 0 2.39.63 3.068 1.593a3.746 3.746 0 0 1 3.296 1.043 3.746 3.746 0 0 1 1.043 3.296A3.745 3.745 0 0 1 21 12Z" />
    </svg>
  );
}

function ChartIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z" />
    </svg>
  );
}

function BuildingIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 21h19.5m-18-18v18m10.5-18v18m6-13.5V21M6.75 6.75h.75m-.75 3h.75m-.75 3h.75m3-6h.75m-.75 3h.75m-.75 3h.75M6.75 21v-3.375c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21M3 3h12m-.75 4.5H21m-3.75 3.75h.008v.008h-.008v-.008Zm0 3h.008v.008h-.008v-.008Zm0 3h.008v.008h-.008v-.008Z" />
    </svg>
  );
}

function UsersIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z" />
    </svg>
  );
}

function MenuIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
    </svg>
  );
}

function XIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
    </svg>
  );
}

export default function GroupLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [group, setGroup] = useState<Group | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem('access_token');
    if (!token) {
      router.push('/login');
      return;
    }
    const cached = localStorage.getItem('group');
    if (cached) {
      try { setGroup(JSON.parse(cached) as Group); } catch { /* ignore */ }
    }
  }, [router]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const m = JSON.parse(localStorage.getItem('merchant') ?? '{}');
      const u = JSON.parse(localStorage.getItem('user') ?? '{}');
      // Group routes require BOTH conditions:
      //   1. Tier policy: `starter` blocks multi-branch features. Any other
      //      tier (multibranch, professional, future paid tiers) is allowed.
      //   2. Role: user must hold Group Admin authority (brandAdminGroupId).
      //      A Branch Admin without group authority gets redirected — they
      //      can't see cross-branch data even if their merchant's tier permits.
      // Missing tier or missing brandAdminGroupId → redirect (default-deny).
      if (!m.subscriptionTier || m.subscriptionTier === 'starter' || !u.brandAdminGroupId) {
        router.replace('/dashboard');
      }
    } catch {
      // If localStorage is corrupt, fall back to /dashboard rather than
      // letting the user sit on a page they may not be authorized for.
      router.replace('/dashboard');
    }
  }, [pathname, router]);

  function handleLogout() {
    localStorage.removeItem('access_token');
    localStorage.removeItem('user');
    localStorage.removeItem('group');
    router.push('/login');
  }

  const isActive = (href: string) => pathname.startsWith(href);

  const Sidebar = () => (
    <nav className="flex flex-col h-full">
      <div className="px-6 py-5 border-b border-grey-10">
        <Link href="/" className="text-xl font-bold text-tone-ink">GlowOS</Link>
        {group && <p className="text-xs text-grey-60 mt-0.5 truncate">{group.name} — Group Admin</p>}
      </div>
      <div className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        <BranchPicker />
        {GROUP_NAV.map((item) => {
          const Icon = item.icon;
          const active = isActive(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setSidebarOpen(false)}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                active ? 'bg-tone-sage/10 text-tone-sage' : 'text-grey-70 hover:bg-tone-surface-warm hover:text-tone-ink'
              }`}
            >
              <Icon className={`w-5 h-5 flex-shrink-0 ${active ? 'text-tone-sage' : 'text-grey-40'}`} />
              {item.label}
            </Link>
          );
        })}
      </div>
      <div className="px-3 py-4 border-t border-grey-10">
        <button
          onClick={handleLogout}
          className="flex items-center gap-3 px-3 py-2.5 w-full rounded-lg text-sm font-medium text-grey-60 hover:bg-tone-surface-warm hover:text-tone-ink transition-colors"
        >
          <svg className="w-5 h-5 text-grey-40" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0 0 13.5 3h-6a2.25 2.25 0 0 0-2.25 2.25v13.5A2.25 2.25 0 0 0 7.5 21h6a2.25 2.25 0 0 0 2.25-2.25V15M12 9l-3 3m0 0 3 3m-3-3h12.75" />
          </svg>
          Logout
        </button>
      </div>
    </nav>
  );

  return (
    <div className="min-h-screen bg-tone-surface-warm flex">
      <aside className="hidden lg:flex flex-col w-60 bg-white border-r border-grey-20 fixed inset-y-0 left-0 z-30">
        <Sidebar />
      </aside>

      {sidebarOpen && (
        <div className="lg:hidden fixed inset-0 z-40 flex">
          <div className="fixed inset-0 bg-tone-ink/30" onClick={() => setSidebarOpen(false)} />
          <aside className="relative z-50 flex flex-col w-64 bg-white shadow-xl">
            <div className="absolute top-4 right-4">
              <button onClick={() => setSidebarOpen(false)} className="p-1 rounded-md text-grey-40 hover:text-grey-70">
                <XIcon className="w-5 h-5" />
              </button>
            </div>
            <Sidebar />
          </aside>
        </div>
      )}

      <div className="flex-1 lg:ml-60 flex flex-col min-h-screen">
        <header className="lg:hidden bg-white border-b border-grey-20 px-4 py-3 flex items-center justify-between sticky top-0 z-20">
          <button onClick={() => setSidebarOpen(true)} className="p-2 rounded-md text-grey-60 hover:bg-grey-10">
            <MenuIcon className="w-5 h-5" />
          </button>
          <Link href="/" className="text-lg font-bold text-tone-ink">GlowOS</Link>
          <button onClick={handleLogout} className="text-sm text-grey-60 hover:text-tone-ink">Logout</button>
        </header>
        <main className="flex-1 px-4 lg:px-8 py-6">{children}</main>
      </div>
    </div>
  );
}
