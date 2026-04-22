'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { apiFetch } from '../lib/api';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!email.trim() || !password) {
      setError('Please enter your email and password');
      return;
    }
    setLoading(true);
    try {
      const data = await apiFetch('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });

      // Clear any stale impersonation state from previous sessions.
      localStorage.removeItem('impersonating');
      localStorage.removeItem('impersonatingMerchant');
      localStorage.removeItem('actorEmail');

      if (data.userType === 'group_admin') {
        localStorage.setItem('access_token', data.access_token);
        localStorage.setItem('user', JSON.stringify(data.user));
        localStorage.setItem('group', JSON.stringify(data.group));
        router.push('/dashboard/group/overview');
      } else if (data.userType === 'staff') {
        localStorage.setItem('access_token', data.access_token);
        localStorage.setItem('refresh_token', data.refresh_token);
        localStorage.setItem('user', JSON.stringify(data.user));
        localStorage.setItem('merchant', JSON.stringify(data.merchant));
        if (data.superAdmin) localStorage.setItem('superAdmin', 'true');
        else localStorage.removeItem('superAdmin');
        router.push(data.superAdmin ? '/super' : '/staff/dashboard');
      } else {
        localStorage.setItem('access_token', data.access_token);
        localStorage.setItem('refresh_token', data.refresh_token);
        localStorage.setItem('user', JSON.stringify(data.user));
        localStorage.setItem('merchant', JSON.stringify(data.merchant));
        if (data.superAdmin) localStorage.setItem('superAdmin', 'true');
        else localStorage.removeItem('superAdmin');
        router.push(data.superAdmin ? '/super' : '/dashboard');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-tone-surface-warm flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <Link href="/" className="font-serif text-3xl font-semibold tracking-tight text-tone-ink">GlowOS</Link>
          <h1 className="text-xl font-semibold text-tone-ink mt-2">Welcome back</h1>
        </div>

        <div className="bg-tone-surface rounded-2xl shadow-xl shadow-gray-100 border border-grey-5 p-8">
          {error && (
            <div className="mb-4 rounded-lg bg-semantic-danger/5 border border-semantic-danger/30 px-4 py-3 text-sm text-semantic-danger">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-grey-75 mb-1">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-lg border border-grey-30 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-tone-sage"
                placeholder="jane@mybusiness.com"
                autoComplete="email"
              />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-sm font-medium text-grey-75">Password</label>
                <Link href="/forgot-password" className="text-xs text-tone-ink font-medium hover:underline hover:text-tone-sage">
                  Forgot password?
                </Link>
              </div>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-lg border border-grey-30 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-tone-sage"
                placeholder="Min 8 characters"
                autoComplete="current-password"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-xl bg-tone-ink py-3 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? 'Signing in...' : 'Sign in'}
            </button>
          </form>

          <p className="text-center text-sm text-grey-60 mt-6">
            Don&apos;t have an account?{' '}
            <Link href="/signup" className="text-tone-ink font-medium hover:underline hover:text-tone-sage">
              Sign up free
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
