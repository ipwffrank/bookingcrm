'use client';
import { useState, useEffect } from 'react';
import { apiFetch, ApiError } from '../../lib/api';

function formatMMSS(total: number): string {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

interface VerifiedClient {
  id: string;
  name: string | null;
  email: string | null;
  google_id: string | null;
}

interface Props {
  slug: string;
  phone: string;
  email?: string;
  purpose: 'login' | 'first_timer_verify';
  title: string;
  subtitle?: string;
  // When true, fire sendCode('whatsapp') on mount so the returning-customer
  // flow doesn't require an extra click (the "Welcome back" card's button
  // already implied the code was being sent).
  autoSend?: boolean;
  onVerified: (token: string, client?: VerifiedClient) => void;
  onSkip?: () => void;
  onSwitchToGoogle?: () => void;
}

export function OTPVerificationCard({
  slug,
  phone,
  email,
  purpose,
  title,
  subtitle,
  autoSend,
  onVerified,
  onSkip,
  onSwitchToGoogle,
}: Props) {
  const [stage, setStage] = useState<'send' | 'enter'>('send');
  const [maskedDestination, setMaskedDestination] = useState<string>('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [cooldownUntil, setCooldownUntil] = useState<number | null>(null);
  const [secondsLeft, setSecondsLeft] = useState<number>(0);

  // Auto-send on mount if the caller opted in (e.g. returning-customer flow
  // where the user already clicked "Send WhatsApp code to continue"). Runs
  // exactly once. Deliberately bare deps — we don't want re-fire if the
  // parent re-renders with new closures over sendCode.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (autoSend && stage === 'send' && !loading) {
      void sendCode('whatsapp');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!cooldownUntil) return;
    const tick = () => {
      const remaining = Math.max(0, Math.ceil((cooldownUntil - Date.now()) / 1000));
      setSecondsLeft(remaining);
      if (remaining === 0) {
        setCooldownUntil(null);
        setError(null);
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [cooldownUntil]);

  async function sendCode(useChannel: 'whatsapp' | 'email') {
    setLoading(true);
    setError(null);
    try {
      const res = (await apiFetch(`/booking/${slug}/otp/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone,
          email,
          channel: useChannel,
          purpose,
        }),
      })) as { sent: boolean; channel: string; masked_destination: string };
      setMaskedDestination(res.masked_destination);
      setStage('enter');
    } catch (err: unknown) {
      if (err instanceof ApiError && err.status === 429) {
        const body = err.body as { retry_after_seconds?: number } | null;
        const retry = body?.retry_after_seconds ?? 60;
        setCooldownUntil(Date.now() + retry * 1000);
        setError(err.message);
      } else {
        const msg = err instanceof Error ? err.message : 'Failed to send code';
        if (useChannel === 'whatsapp' && email) {
          setError("WhatsApp send failed — try email instead?");
        } else {
          setError(msg);
        }
      }
    } finally {
      setLoading(false);
    }
  }

  async function verify() {
    if (code.length !== 6) return;
    setLoading(true);
    setError(null);
    try {
      const res = (await apiFetch(`/booking/${slug}/otp/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, code, purpose }),
      })) as {
        verified: boolean;
        verification_token: string;
        client?: VerifiedClient;
      };
      onVerified(res.verification_token, res.client);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Incorrect code';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-lg border border-grey-15 bg-grey-5 p-4">
      <div className="font-medium">{title}</div>
      {subtitle && <div className="text-sm text-grey-75 mt-1">{subtitle}</div>}
      {stage === 'send' ? (
        <div className="mt-3 space-y-2">
          <button
            type="button"
            onClick={() => sendCode('whatsapp')}
            disabled={loading || secondsLeft > 0}
            className="w-full rounded bg-tone-sage text-white py-2 text-sm font-medium disabled:opacity-50"
          >
            {loading
              ? 'Sending…'
              : secondsLeft > 0
                ? `Try again in ${formatMMSS(secondsLeft)}`
                : 'Send WhatsApp code'}
          </button>
          {email && (
            <button
              type="button"
              onClick={() => sendCode('email')}
              disabled={loading || secondsLeft > 0}
              className="w-full rounded border border-grey-30 py-2 text-sm disabled:opacity-50"
            >
              {secondsLeft > 0 ? `Try again in ${formatMMSS(secondsLeft)}` : 'Use email instead'}
            </button>
          )}
          {onSwitchToGoogle && (
            <button
              type="button"
              onClick={onSwitchToGoogle}
              className="w-full text-xs text-grey-60 underline"
            >
              Use Google instead
            </button>
          )}
          {onSkip && (
            <button type="button" onClick={onSkip} className="w-full text-xs text-grey-60 underline">
              Skip discount and continue
            </button>
          )}
        </div>
      ) : (
        <div className="mt-3 space-y-2">
          <div className="text-xs text-grey-75">Code sent to {maskedDestination}</div>
          <input
            inputMode="numeric"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            placeholder="6-digit code"
            className="w-full rounded border-grey-30 py-2 px-3 text-center tracking-widest"
          />
          <button
            type="button"
            onClick={verify}
            disabled={loading || code.length !== 6}
            className="w-full rounded bg-tone-ink text-white py-2 text-sm font-medium disabled:opacity-50"
          >
            {loading ? 'Verifying…' : 'Verify'}
          </button>
          <button
            type="button"
            onClick={() => {
              setStage('send');
              setCode('');
            }}
            className="w-full text-xs text-grey-60 underline"
          >
            Didn&apos;t receive it? Send again
          </button>
          {onSwitchToGoogle && (
            <button
              type="button"
              onClick={onSwitchToGoogle}
              className="w-full text-xs text-grey-60 underline"
            >
              Use Google instead
            </button>
          )}
          {onSkip && (
            <button type="button" onClick={onSkip} className="w-full text-xs text-grey-60 underline">
              Skip discount and continue
            </button>
          )}
        </div>
      )}
      {error && <div className="mt-2 text-sm text-semantic-danger">{error}</div>}
    </div>
  );
}
