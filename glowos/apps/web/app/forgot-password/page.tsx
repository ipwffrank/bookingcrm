'use client';

import { useState } from 'react';
import Link from 'next/link';
import { apiFetch } from '../lib/api';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!email.trim()) {
      setError('Please enter your email');
      return;
    }
    setLoading(true);
    try {
      await apiFetch('/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ email: email.trim() }),
      });
      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-tone-surface-warm flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <Link href="/" className="font-serif text-3xl font-semibold tracking-tight text-tone-ink">GlowOS</Link>
          <h1 className="text-xl font-semibold text-tone-ink mt-2">Reset your password</h1>
        </div>

        <div className="bg-tone-surface rounded-2xl shadow-xl shadow-gray-100 border border-grey-5 p-8">
          {submitted ? (
            <div className="space-y-4 text-center">
              <div className="w-12 h-12 bg-tone-sage/5 text-tone-sage rounded-full mx-auto flex items-center justify-center text-2xl">✓</div>
              <p className="text-sm text-grey-75">
                If an account exists for <strong>{email}</strong>, we&apos;ve sent a reset link. Check your inbox and spam folder — the link expires in 30 minutes.
              </p>
              <Link href="/login" className="inline-block text-sm text-tone-ink font-medium hover:underline hover:text-tone-sage">
                Back to sign in
              </Link>
            </div>
          ) : (
            <>
              {error && (
                <div className="mb-4 rounded-lg bg-semantic-danger/5 border border-semantic-danger/30 px-4 py-3 text-sm text-semantic-danger">
                  {error}
                </div>
              )}

              <p className="text-sm text-grey-75 mb-4">
                Enter the email you use to sign in and we&apos;ll send you a reset link.
              </p>

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
                    autoFocus
                  />
                </div>
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full rounded-xl bg-tone-ink py-3 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
                >
                  {loading ? 'Sending...' : 'Send reset link'}
                </button>
              </form>

              <p className="text-center text-sm text-grey-60 mt-6">
                Remembered your password?{' '}
                <Link href="/login" className="text-tone-ink font-medium hover:underline hover:text-tone-sage">
                  Sign in
                </Link>
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
