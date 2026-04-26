'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { apiFetch } from '../lib/api';
import { ImpersonationBanner } from './components/ImpersonationBanner';
import { BrandViewBanner } from './components/BrandViewBanner';

interface Merchant {
  id: string;
  name: string;
  slug: string;
}

const NAV_ITEMS = [
  { href: '/dashboard', label: 'Dashboard', icon: CalendarIcon },
  { href: '/dashboard/analytics', label: 'Analytics', icon: ChartBarIcon },
  { href: '/dashboard/services', label: 'Services', icon: ScissorsIcon },
  { href: '/dashboard/packages', label: 'Packages', icon: PackageIcon },
  { href: '/dashboard/staff', label: 'Staff', icon: UsersIcon },
  { href: '/dashboard/calendar', label: 'Calendar', icon: CalendarGridIcon },
  { href: '/dashboard/clients', label: 'Clients', icon: HeartIcon },
  { href: '/dashboard/reviews', label: 'Reviews', icon: StarIcon },
  { href: '/dashboard/import', label: 'Import Clients', icon: ImportIcon },
  { href: '/dashboard/campaigns', label: 'Campaigns', icon: MegaphoneIcon },
];

function CalendarIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5" />
    </svg>
  );
}

function ScissorsIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M7.848 8.25l1.536.887M7.848 8.25a3 3 0 1 1-5.196-3 3 3 0 0 1 5.196 3zm1.536.887a2.165 2.165 0 0 1 1.083 1.839c.005.351.054.695.14 1.024M9.384 9.137l2.077 1.199M7.848 15.75l1.536-.887m-1.536.887a3 3 0 1 1-5.196 3 3 3 0 0 1 5.196-3zm1.536-.887a2.165 2.165 0 0 0 1.083-1.839 8.057 8.057 0 0 0 .128-1.024M9.384 14.863l2.077-1.199m0-3.328 4.445 2.566M13.461 11.336l4.445-2.566m0 0a3 3 0 1 1 5.196-3 3 3 0 0 1-5.196 3zm0 0a3 3 0 1 1 5.196 3 3 3 0 0 1-5.196-3z" />
    </svg>
  );
}

function PackageIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M21 11.25v8.25a1.5 1.5 0 0 1-1.5 1.5H5.25a1.5 1.5 0 0 1-1.5-1.5v-8.25M12 4.875A2.625 2.625 0 1 0 9.375 7.5H12m0-2.625V7.5m0-2.625A2.625 2.625 0 1 1 14.625 7.5H12m0 0V21m-8.625-9.75h18c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125h-18c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125Z" />
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

function RosterIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.875 1.875 0 0 1 0 3.75H5.625a1.875 1.875 0 0 1 0-3.75Z" />
    </svg>
  );
}

function CalendarGridIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5m-9-6h.008v.008H12v-.008ZM12 15h.008v.008H12V15Zm0 2.25h.008v.008H12v-.008ZM9.75 15h.008v.008H9.75V15Zm0 2.25h.008v.008H9.75v-.008ZM7.5 15h.008v.008H7.5V15Zm0 2.25h.008v.008H7.5v-.008Zm6.75-4.5h.008v.008h-.008v-.008Zm0 2.25h.008v.008h-.008V15Zm0 2.25h.008v.008h-.008v-.008Zm2.25-4.5h.008v.008H16.5v-.008Zm0 2.25h.008v.008H16.5V15Z" />
    </svg>
  );
}

function ChartBarIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z" />
    </svg>
  );
}

function HeartIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12Z" />
    </svg>
  );
}

function StarIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M11.48 3.499a.562.562 0 0 1 1.04 0l2.125 5.111a.563.563 0 0 0 .475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 0 0-.182.557l1.285 5.385a.562.562 0 0 1-.84.61l-4.725-2.885a.562.562 0 0 0-.586 0L6.982 20.54a.562.562 0 0 1-.84-.61l1.285-5.386a.562.562 0 0 0-.182-.557l-4.204-3.602a.562.562 0 0 1 .321-.988l5.518-.442a.563.563 0 0 0 .475-.345L11.48 3.5Z" />
    </svg>
  );
}

function MegaphoneIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M10.34 15.84c-.688-.06-1.386-.09-2.09-.09H7.5a4.5 4.5 0 1 1 0-9h.75c.704 0 1.402-.03 2.09-.09m0 9.18c.253.962.584 1.892.985 2.783.247.55.06 1.21-.463 1.511l-.657.38c-.551.318-1.26.117-1.527-.461a20.845 20.845 0 0 1-1.44-4.282m3.102.069a18.03 18.03 0 0 1-.59-4.59c0-1.586.205-3.124.59-4.59m0 9.18a23.848 23.848 0 0 1 8.835 2.535M10.34 6.66a23.847 23.847 0 0 1 8.835-2.535m0 0A23.74 23.74 0 0 1 18.795 3c1.167 0 2.301.068 3.268.2M19.175 4.125c.027.406.044.813.05 1.221M19.175 4.125a23.704 23.704 0 0 0-.05 14.75m0 0c-.005.408-.022.815-.05 1.221" />
    </svg>
  );
}

function ImportIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
    </svg>
  );
}

function SettingsIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
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

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [merchant, setMerchant] = useState<Merchant | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem('sidebar_collapsed') === 'true';
  });
  // Show "Superadmin panel" link only when this session is elevated AND not
  // currently impersonating — mirrors the API's requireSuperAdmin rule so
  // the UI matches what the route will allow.
  const [showSuperLink, setShowSuperLink] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const isSuper = localStorage.getItem('superAdmin') === 'true';
    const impersonating = localStorage.getItem('impersonating') === 'true';
    setShowSuperLink(isSuper && !impersonating);
  }, [pathname]);

  function toggleCollapse() {
    setSidebarCollapsed(prev => {
      const next = !prev;
      localStorage.setItem('sidebar_collapsed', String(next));
      return next;
    });
  }

  useEffect(() => {
    // Group admin routes have their own layout and auth — don't interfere
    if (pathname.startsWith('/dashboard/group')) return;

    const token = localStorage.getItem('access_token');
    if (!token) {
      router.push('/login');
      return;
    }

    // Staff accounts are not allowed in the admin dashboard
    try {
      const user = JSON.parse(localStorage.getItem('user') ?? '{}') as { role?: string };
      if (user.role === 'staff') {
        router.push('/staff/dashboard');
        return;
      }
    } catch { /* ignore parse errors */ }
    const cached = localStorage.getItem('merchant');
    if (cached) {
      try {
        setMerchant(JSON.parse(cached) as Merchant);
      } catch {
        // ignore parse errors
      }
    }
    apiFetch('/merchant/me', {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((data: { merchant?: Merchant; name?: string; id?: string; slug?: string }) => {
        const m = (data as { merchant?: Merchant }).merchant ?? (data as Merchant);
        setMerchant(m);
        localStorage.setItem('merchant', JSON.stringify(m));
      })
      .catch(() => {
        router.push('/login');
      });
  }, [router]);

  function handleLogout() {
    localStorage.clear();
    router.push('/login');
  }

  const isActive = (href: string) => {
    if (href === '/dashboard') return pathname === '/dashboard';
    return pathname.startsWith(href);
  };

  const Sidebar = ({ collapsed = false }: { collapsed?: boolean }) => (
    <nav className="flex flex-col h-full font-manrope">
      <div className={`${collapsed ? 'px-3 py-5 flex justify-center' : 'px-6 py-5'} border-b border-grey-5`}>
        {collapsed ? (
          <Link href="/" className="font-newsreader text-lg font-semibold text-[#1a2313] hover:text-[#456466] transition-colors" title="GlowOS">G</Link>
        ) : (
          <>
            <Link href="/" className="font-newsreader text-xl font-semibold text-[#1a2313] hover:text-[#456466] transition-colors">GlowOS</Link>
            {merchant && (
              <p className="font-inter text-[11px] text-grey-45 mt-1 truncate uppercase tracking-wider">{merchant.name}</p>
            )}
          </>
        )}
      </div>
      <div className={`flex-1 ${collapsed ? 'px-2' : 'px-3'} py-4 space-y-0.5 overflow-y-auto`}>
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const active = isActive(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setSidebarOpen(false)}
              title={collapsed ? item.label : undefined}
              className={`flex items-center ${collapsed ? 'justify-center px-2' : 'gap-3 px-3'} py-2.5 rounded-lg text-sm font-medium transition-colors ${
                active
                  ? 'bg-tone-ink/8 text-[#1a2313]'
                  : 'text-grey-60 hover:bg-grey-5 hover:text-grey-90'
              }`}
            >
              <Icon className={`w-4.5 h-4.5 flex-shrink-0 ${active ? 'text-[#1a2313]' : 'text-grey-45'}`} />
              {!collapsed && item.label}
            </Link>
          );
        })}
      </div>
      <div className={`${collapsed ? 'px-2' : 'px-3'} py-4 border-t border-grey-5 space-y-0.5`}>
        {showSuperLink && (
          <Link
            href="/super"
            title={collapsed ? 'Superadmin panel' : undefined}
            className={`flex items-center ${collapsed ? 'justify-center px-2' : 'gap-3 px-3'} py-2.5 rounded-lg text-sm font-medium bg-tone-ink text-tone-surface hover:opacity-90 transition-opacity`}
          >
            <svg className="w-4.5 h-4.5 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 3l9 4-9 4-9-4 9-4zm0 8l9 4-9 4-9-4 9-4z" />
            </svg>
            {!collapsed && 'Superadmin panel'}
          </Link>
        )}
        {(() => {
          const settingsHref = '/dashboard/settings';
          const settingsActive = isActive(settingsHref);
          return (
            <Link
              href={settingsHref}
              onClick={() => setSidebarOpen(false)}
              title={collapsed ? 'Settings' : undefined}
              className={`flex items-center ${collapsed ? 'justify-center px-2' : 'gap-3 px-3'} py-2.5 rounded-lg text-sm font-medium transition-colors ${
                settingsActive
                  ? 'bg-tone-ink/8 text-[#1a2313]'
                  : 'text-grey-60 hover:bg-grey-5 hover:text-grey-90'
              }`}
            >
              <SettingsIcon className={`w-4.5 h-4.5 flex-shrink-0 ${settingsActive ? 'text-[#1a2313]' : 'text-grey-45'}`} />
              {!collapsed && 'Settings'}
            </Link>
          );
        })()}
        <button
          onClick={handleLogout}
          title={collapsed ? 'Logout' : undefined}
          className={`flex items-center ${collapsed ? 'justify-center px-2' : 'gap-3 px-3'} py-2.5 w-full rounded-lg text-sm font-medium text-grey-60 hover:bg-grey-5 hover:text-grey-75 transition-colors`}
        >
          <svg className="w-4.5 h-4.5 text-grey-45 flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0 0 13.5 3h-6a2.25 2.25 0 0 0-2.25 2.25v13.5A2.25 2.25 0 0 0 7.5 21h6a2.25 2.25 0 0 0 2.25-2.25V15M12 9l-3 3m0 0 3 3m-3-3h12.75" />
          </svg>
          {!collapsed && 'Logout'}
        </button>
        {/* Desktop collapse toggle */}
        <button
          onClick={toggleCollapse}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className={`hidden lg:flex items-center ${collapsed ? 'justify-center px-2' : 'gap-3 px-3'} py-2.5 w-full rounded-lg text-sm font-medium text-grey-45 hover:bg-grey-5 hover:text-grey-75 transition-colors`}
        >
          <svg className="w-4.5 h-4.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            {collapsed
              ? <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 4.5l7.5 7.5-7.5 7.5m-6-15l7.5 7.5-7.5 7.5" />
              : <path strokeLinecap="round" strokeLinejoin="round" d="M18.75 19.5l-7.5-7.5 7.5-7.5m-6 15L5.25 12l7.5-7.5" />
            }
          </svg>
          {!collapsed && <span className="text-xs">Collapse</span>}
        </button>
      </div>
    </nav>
  );

  // Group admin routes have their own layout — don't render branch admin chrome
  if (pathname.startsWith('/dashboard/group')) {
    return <>{children}</>;
  }

  return (
    <div className="min-h-screen bg-tone-surface-warm flex font-manrope">
      {/* Desktop sidebar — hidden when printing so PDF exports are clean */}
      <aside
        className={`hidden lg:flex flex-col bg-tone-surface border-r border-grey-15 fixed inset-y-0 left-0 z-30 transition-all duration-200 print:hidden ${
          sidebarCollapsed ? 'w-14' : 'w-60'
        }`}
      >
        <Sidebar collapsed={sidebarCollapsed} />
      </aside>

      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div className="lg:hidden fixed inset-0 z-40 flex">
          <div
            className="fixed inset-0 bg-black/30"
            onClick={() => setSidebarOpen(false)}
          />
          <aside className="relative z-50 flex flex-col w-64 bg-tone-surface shadow-xl">
            <div className="absolute top-4 right-4">
              <button
                onClick={() => setSidebarOpen(false)}
                className="p-1 rounded-md text-grey-45 hover:text-grey-75"
              >
                <XIcon className="w-5 h-5" />
              </button>
            </div>
            <Sidebar />
          </aside>
        </div>
      )}

      {/* Main content — left margin reset to 0 when printing so the page
          uses the full PDF width instead of leaving a sidebar gutter. */}
      <div
        className={`flex-1 flex flex-col min-h-screen transition-all duration-200 print:!ml-0 ${
          sidebarCollapsed ? 'lg:ml-14' : 'lg:ml-60'
        }`}
      >
        {/* Top bar (mobile only) — hidden when printing */}
        <header className="lg:hidden bg-tone-surface border-b border-grey-15 px-4 py-3 flex items-center justify-between sticky top-0 z-20 print:hidden">
          <button
            onClick={() => setSidebarOpen(true)}
            className="p-2 rounded-md text-grey-60 hover:bg-grey-15"
          >
            <MenuIcon className="w-5 h-5" />
          </button>
          <Link href="/" className="font-newsreader text-lg font-semibold text-[#1a2313] hover:text-[#456466] transition-colors">GlowOS</Link>
          <button
            onClick={handleLogout}
            className="text-sm text-grey-60 hover:text-grey-75"
          >
            Logout
          </button>
        </header>

        <ImpersonationBanner />
        <BrandViewBanner />
        <main className="flex-1 px-4 lg:px-6 py-6 min-w-0">
          {children}
        </main>
      </div>
    </div>
  );
}
