'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { apiFetch, ApiError } from '../../lib/api';

interface InviteValid {
  valid: true;
  reason: null;
  groupName: string;
  inviterName: string | null;
  inviterEmail: string | null;
  inviteeEmail: string;
  hasAccount: boolean;
}

interface InviteInvalid {
  valid: false;
  reason: 'expired' | 'used' | 'canceled' | 'not_found';
}

type InviteResponse = InviteValid | InviteInvalid;

export default function BrandInviteAcceptPage() {
  const params = useParams<{ token: string }>();
  const router = useRouter();
  const token = params.token;

  const [data, setData] = useState<InviteResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [signedInEmail, setSignedInEmail] = useState<string | null>(null);
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        const u = JSON.parse(localStorage.getItem('user') ?? 'null');
        if (u?.email) setSignedInEmail(u.email.toLowerCase());
      } catch { /* ignore */ }
    }
    apiFetch(`/brand-invite/${token}`)
      .then((d: InviteResponse) => setData(d))
      .catch(() => setData({ valid: false, reason: 'not_found' }))
      .finally(() => setLoading(false));
  }, [token]);

  async function handleAccept() {
    setAccepting(true);
    setError(null);
    try {
      const res = (await apiFetch(`/brand-invite/${token}/accept`, { method: 'POST' })) as {
        access_token: string;
        refresh_token: string;
        user: unknown;
        merchant: unknown;
        group: unknown;
      };
      localStorage.setItem('access_token', res.access_token);
      localStorage.setItem('refresh_token', res.refresh_token);
      localStorage.setItem('user', JSON.stringify(res.user));
      localStorage.setItem('merchant', JSON.stringify(res.merchant));
      localStorage.setItem('group', JSON.stringify(res.group));
      // Hard reload so layouts re-read localStorage and the Group sidebar item
      // appears immediately.
      window.location.assign('/dashboard/group/overview');
    } catch (e) {
      setError(e instanceof ApiError ? e.message ?? 'Failed to accept invite' : 'Failed to accept invite');
      setAccepting(false);
    }
  }

  return (
    <div className="min-h-screen bg-tone-surface-warm flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <Link href="/" className="font-serif text-3xl font-semibold tracking-tight text-tone-ink">GlowOS</Link>
        </div>

        <div className="bg-tone-surface rounded-2xl shadow-xl shadow-gray-100 border border-grey-5 p-8">
          {loading ? (
            <p className="text-sm text-grey-60 text-center py-4">Loading invite…</p>
          ) : !data ? null : !data.valid ? (
            <Invalid reason={data.reason} />
          ) : (
            <Valid
              data={data}
              token={token}
              signedInEmail={signedInEmail}
              accepting={accepting}
              error={error}
              onAccept={handleAccept}
              onSignIn={() => router.push(`/login?return_to=${encodeURIComponent(`/brand-invite/${token}`)}`)}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function Invalid({ reason }: { reason: 'expired' | 'used' | 'canceled' | 'not_found' }) {
  const message = {
    expired: 'This invite has expired.',
    used: 'This invite has already been used.',
    canceled: 'This invite was canceled by the inviter.',
    not_found: 'Invite not found. Double-check the link or ask the inviter to send a new one.',
  }[reason];
  return (
    <div className="text-center">
      <p className="text-tone-ink font-semibold mb-2">Cannot accept</p>
      <p className="text-sm text-grey-70 mb-6">{message}</p>
      <Link href="/login" className="text-sm text-tone-sage hover:text-tone-ink underline underline-offset-2">
        Sign in to GlowOS
      </Link>
    </div>
  );
}

function Valid({
  data,
  token,
  signedInEmail,
  accepting,
  error,
  onAccept,
  onSignIn,
}: {
  data: InviteValid;
  token: string;
  signedInEmail: string | null;
  accepting: boolean;
  error: string | null;
  onAccept: () => void;
  onSignIn: () => void;
}) {
  const emailMatches = signedInEmail && signedInEmail === data.inviteeEmail.toLowerCase();
  const isNewAccountPath = !signedInEmail && !data.hasAccount;

  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-grey-60 mb-1">You&apos;ve been invited to join</p>
      <h1 className="text-2xl font-semibold text-tone-ink mb-4">{data.groupName}</h1>

      <p className="text-sm text-grey-70 mb-2">
        Invited by{' '}
        <span className="text-tone-ink">{data.inviterName ?? data.inviterEmail ?? 'a brand admin'}</span>
        {data.inviterEmail && data.inviterName && (
          <span className="text-grey-50"> · {data.inviterEmail}</span>
        )}
      </p>
      <p className="text-sm text-grey-70 mb-6">
        This invite is for <span className="text-tone-ink">{data.inviteeEmail}</span>.
      </p>

      <div className="bg-tone-surface-warm border border-grey-10 rounded-md p-4 mb-6">
        <p className="text-xs uppercase tracking-wide text-grey-60 mb-2">Accepting will</p>
        <ul className="text-sm text-tone-ink space-y-1">
          {isNewAccountPath ? (
            <>
              <li>• Create your GlowOS account</li>
              <li>• Make you a co-brand-admin of {data.groupName}</li>
              <li>• Sign you in</li>
            </>
          ) : (
            <>
              <li>• Move your branch into this brand</li>
              <li>• Make you a co-brand-admin</li>
              <li>• Re-issue your session</li>
            </>
          )}
        </ul>
      </div>

      {error && <p className="text-sm text-semantic-danger mb-4">{error}</p>}

      {isNewAccountPath ? (
        <SignupForm token={token} email={data.inviteeEmail} />
      ) : !signedInEmail ? (
        <button
          onClick={onSignIn}
          className="w-full bg-tone-ink text-tone-surface px-4 py-2.5 rounded-md text-sm font-medium hover:opacity-90"
        >
          Sign in to accept
        </button>
      ) : !emailMatches ? (
        <div className="space-y-3">
          <p className="text-sm text-grey-70">
            You&apos;re signed in as <span className="text-tone-ink">{signedInEmail}</span>, but this invite is for{' '}
            <span className="text-tone-ink">{data.inviteeEmail}</span>.
          </p>
          <button
            onClick={onSignIn}
            className="w-full bg-tone-ink text-tone-surface px-4 py-2.5 rounded-md text-sm font-medium hover:opacity-90"
          >
            Switch account
          </button>
        </div>
      ) : (
        <div className="flex flex-col sm:flex-row gap-2">
          <button
            onClick={onAccept}
            disabled={accepting}
            className="flex-1 bg-tone-ink text-tone-surface px-4 py-2.5 rounded-md text-sm font-medium hover:opacity-90 disabled:opacity-50"
          >
            {accepting ? 'Accepting…' : 'Accept invite'}
          </button>
          <Link
            href="/dashboard"
            className="flex-1 text-center bg-tone-surface text-tone-ink border border-grey-20 px-4 py-2.5 rounded-md text-sm font-medium hover:bg-tone-surface-warm"
          >
            Decline
          </Link>
        </div>
      )}
    </div>
  );
}

function SignupForm({ token, email }: { token: string; email: string }) {
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || password.length < 8) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = (await apiFetch(`/brand-invite/${token}/signup-and-accept`, {
        method: 'POST',
        body: JSON.stringify({ name: name.trim(), password }),
      })) as {
        access_token: string;
        refresh_token: string;
        user: unknown;
        merchant: unknown;
        group: unknown;
      };
      localStorage.setItem('access_token', res.access_token);
      localStorage.setItem('refresh_token', res.refresh_token);
      localStorage.setItem('user', JSON.stringify(res.user));
      localStorage.setItem('merchant', JSON.stringify(res.merchant));
      localStorage.setItem('group', JSON.stringify(res.group));
      window.location.assign('/dashboard/group/overview');
    } catch (e) {
      setError(e instanceof ApiError ? e.message ?? 'Signup failed' : 'Signup failed');
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <label className="block">
        <span className="block text-xs uppercase tracking-wide text-grey-60 mb-1">Email</span>
        <input
          type="email"
          value={email}
          disabled
          className="w-full border border-grey-20 rounded-md px-3 py-2 text-sm bg-grey-10 text-grey-50"
        />
      </label>
      <label className="block">
        <span className="block text-xs uppercase tracking-wide text-grey-60 mb-1">Your name</span>
        <input
          type="text"
          value={name}
          onChange={(ev) => setName(ev.target.value)}
          required
          maxLength={100}
          autoFocus
          className="w-full border border-grey-20 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-tone-sage focus:border-tone-sage"
        />
      </label>
      <label className="block">
        <span className="block text-xs uppercase tracking-wide text-grey-60 mb-1">Choose a password</span>
        <input
          type="password"
          value={password}
          onChange={(ev) => setPassword(ev.target.value)}
          required
          minLength={8}
          className="w-full border border-grey-20 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-tone-sage focus:border-tone-sage"
        />
        <span className="block text-xs text-grey-50 mt-1">Minimum 8 characters.</span>
      </label>
      {error && <p className="text-sm text-semantic-danger">{error}</p>}
      <button
        type="submit"
        disabled={submitting || !name.trim() || password.length < 8}
        className="w-full bg-tone-ink text-tone-surface px-4 py-2.5 rounded-md text-sm font-medium hover:opacity-90 disabled:opacity-50"
      >
        {submitting ? 'Creating account…' : 'Create account & accept'}
      </button>
      <p className="text-xs text-grey-50 text-center pt-1">
        Already have an account with this email?{' '}
        <Link href={`/login?return_to=${encodeURIComponent(`/brand-invite/${token}`)}`} className="text-tone-sage hover:text-tone-ink underline underline-offset-2">
          Sign in to accept
        </Link>
      </p>
    </form>
  );
}
