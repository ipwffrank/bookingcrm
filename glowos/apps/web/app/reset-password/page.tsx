'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { apiFetch } from '../lib/api';

function ResetPasswordInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token') ?? '';

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (!token) {
      setError('Missing reset token. Request a new link.');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match');
      return;
    }

    setLoading(true);
    try {
      await apiFetch('/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({ token, new_password: password }),
      });
      setDone(true);
      setTimeout(() => router.push('/login'), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reset failed. Try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-tone-surface-warm flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <Link href="/" className="font-serif text-3xl font-semibold tracking-tight text-tone-ink">GlowOS</Link>
          <h1 className="text-xl font-semibold text-tone-ink mt-2">Set a new password</h1>
        </div>

        <div className="bg-tone-surface rounded-2xl shadow-xl shadow-gray-100 border border-grey-5 p-8">
          {done ? (
            <div className="space-y-4 text-center">
              <div className="w-12 h-12 bg-tone-sage/5 text-tone-sage rounded-full mx-auto flex items-center justify-center text-2xl">✓</div>
              <p className="text-sm text-grey-75">Password updated. Redirecting you to sign in…</p>
            </div>
          ) : !token ? (
            <div className="space-y-4 text-center">
              <p className="text-sm text-grey-75">This link is missing a token. Request a new reset email.</p>
              <Link href="/forgot-password" className="inline-block text-sm text-tone-ink font-medium hover:underline hover:text-tone-sage">
                Request new link
              </Link>
            </div>
          ) : (
            <>
              {error && (
                <div className="mb-4 rounded-lg bg-semantic-danger/5 border border-semantic-danger/30 px-4 py-3 text-sm text-semantic-danger">
                  {error}
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-grey-75 mb-1">New password</label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full rounded-lg border border-grey-30 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-tone-sage"
                    placeholder="Min 8 characters"
                    autoComplete="new-password"
                    autoFocus
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-grey-75 mb-1">Confirm password</label>
                  <input
                    type="password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    className="w-full rounded-lg border border-grey-30 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-tone-sage"
                    placeholder="Re-enter password"
                    autoComplete="new-password"
                  />
                </div>
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full rounded-xl bg-tone-ink py-3 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
                >
                  {loading ? 'Updating...' : 'Update password'}
                </button>
              </form>

              <p className="text-center text-sm text-grey-60 mt-6">
                <Link href="/login" className="text-tone-ink font-medium hover:underline hover:text-tone-sage">
                  Back to sign in
                </Link>
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-grey-5" />}>
      <ResetPasswordInner />
    </Suspense>
  );
}
