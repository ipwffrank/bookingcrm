'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '../lib/auth';

const NAV = [
  { href: '/dashboard', label: 'Dashboard', icon: '🏠' },
  { href: '/bookings', label: 'Bookings', icon: '📅' },
  { href: '/clients', label: 'Clients', icon: '👥' },
  { href: '/marketing', label: 'Marketing', icon: '📣' },
  { href: '/analytics', label: 'Analytics', icon: '📊' },
  { href: '/settings', label: 'Settings', icon: '⚙️' },
];

export default function Sidebar({ onClose }: { onClose?: () => void }) {
  const pathname = usePathname();
  const { merchant, user, logout } = useAuth();

  return (
    <div className="flex flex-col h-full bg-white border-r border-gray-100">
      {/* Logo */}
      <div className="px-6 py-5 border-b border-gray-100">
        <div className="flex items-center justify-between">
          <span className="text-xl font-bold text-indigo-600">GlowOS</span>
          {onClose && (
            <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600 lg:hidden">
              ✕
            </button>
          )}
        </div>
        {merchant && (
          <div className="mt-2">
            <div className="text-sm font-medium text-gray-900 truncate">{merchant.name}</div>
            <div className="text-xs text-gray-400 capitalize">
              {merchant.category.replace('_', ' ')}
            </div>
          </div>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 px-4 py-4 space-y-1 overflow-y-auto">
        {NAV.map((item) => {
          const active = pathname === item.href || pathname.startsWith(item.href + '/');
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onClose}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                active
                  ? 'bg-indigo-50 text-indigo-700'
                  : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
              }`}
            >
              <span className="text-base">{item.icon}</span>
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* User */}
      <div className="px-4 py-4 border-t border-gray-100">
        <div className="flex items-center gap-3 px-3 py-2">
          <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-600 text-sm font-semibold flex-shrink-0">
            {user?.name?.charAt(0) ?? 'U'}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-gray-900 truncate">{user?.name}</div>
            <div className="text-xs text-gray-400 capitalize">{user?.role}</div>
          </div>
          <button
            onClick={logout}
            className="text-xs text-gray-400 hover:text-red-500 transition-colors"
            title="Logout"
          >
            ↩
          </button>
        </div>
      </div>
    </div>
  );
}
