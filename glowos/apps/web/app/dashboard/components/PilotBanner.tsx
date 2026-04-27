'use client';

import { useEffect, useState } from 'react';

interface MerchantSnapshot {
  isPilot?: boolean;
  name?: string;
}

export function PilotBanner() {
  const [merchant, setMerchant] = useState<MerchantSnapshot | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      setMerchant(JSON.parse(localStorage.getItem('merchant') ?? '{}'));
    } catch { /* ignore */ }
  }, []);

  if (!merchant?.isPilot) return null;

  return (
    <div className="bg-tone-sage/10 border-b border-tone-sage/30 px-4 py-2 text-center text-xs font-medium text-tone-sage">
      You&apos;re on the GlowOS pilot programme — all features are unlocked. Feedback to your account manager helps shape what ships next.
    </div>
  );
}
