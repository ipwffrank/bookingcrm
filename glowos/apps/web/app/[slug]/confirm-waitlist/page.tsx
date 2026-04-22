'use client';

import { Suspense, useEffect, useState } from 'react';
import { useParams, useSearchParams, useRouter } from 'next/navigation';
import { apiFetch, ApiError } from '../../lib/api';

function Inner() {
  const params = useParams();
  const search = useSearchParams();
  const router = useRouter();
  const slug = params.slug as string;
  const waitlistId = search.get('waitlist') ?? '';
  const token = search.get('token') ?? '';
  const [state, setState] = useState<'idle' | 'confirming' | 'ok' | 'err'>('idle');
  const [errMsg, setErrMsg] = useState('');

  async function confirm() {
    setState('confirming');
    try {
      await apiFetch(`/waitlist/${waitlistId}/confirm?token=${encodeURIComponent(token)}`, { method: 'POST' });
      setState('ok');
      setTimeout(() => router.push(`/${slug}`), 1500);
    } catch (e) {
      setErrMsg(e instanceof ApiError ? e.message : 'This slot is no longer available.');
      setState('err');
    }
  }

  useEffect(() => {
    if (!waitlistId || !token) setState('err');
  }, [waitlistId, token]);

  if (state === 'err') {
    return (
      <div className="p-6 max-w-md mx-auto">
        <h1 className="text-lg font-semibold mb-2">Slot unavailable</h1>
        <p className="text-sm text-grey-75 mb-4">{errMsg || 'This link has expired or the slot was taken.'}</p>
        <a href={`/${slug}`} className="text-tone-sage underline text-sm">Book a different time →</a>
      </div>
    );
  }

  if (state === 'ok') {
    return (
      <div className="p-6 max-w-md mx-auto">
        <h1 className="text-lg font-semibold mb-2">You&apos;re booked!</h1>
        <p className="text-sm text-grey-75">Redirecting…</p>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-md mx-auto">
      <h1 className="text-lg font-semibold mb-2">Confirm your slot</h1>
      <p className="text-sm text-grey-75 mb-4">Tap Confirm to take the freed slot. You have 10 minutes from the time you were notified.</p>
      <button
        onClick={confirm}
        disabled={state === 'confirming'}
        className="px-4 py-2 bg-tone-ink text-white text-sm font-semibold rounded-lg disabled:opacity-60"
      >
        {state === 'confirming' ? 'Confirming…' : 'Confirm booking'}
      </button>
    </div>
  );
}

export default function ConfirmWaitlistPage() {
  return (
    <Suspense fallback={<div className="p-6">Loading…</div>}>
      <Inner />
    </Suspense>
  );
}
