'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

export default function FloatingCTA() {
  const [visible, setVisible] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    function onScroll() {
      // Show after scrolling past 80% of viewport height
      const threshold = window.innerHeight * 0.8;
      setVisible(window.scrollY > threshold);
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  if (dismissed) return null;

  return (
    <div
      className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-40 transition-all duration-500 ${
        visible
          ? 'opacity-100 translate-y-0'
          : 'opacity-0 translate-y-4 pointer-events-none'
      }`}
      role="complementary"
      aria-label="Quick action"
    >
      <div className="flex items-center gap-3 bg-[var(--surface-raised)]/95 backdrop-blur-2xl border border-white/[0.06] rounded-2xl px-5 py-3 shadow-2xl shadow-black/40">
        <Link
          href="/signup"
          className="btn-glow inline-flex items-center gap-2.5 bg-[var(--gold)] hover:bg-[var(--gold-light)] px-6 py-2.5 rounded-xl text-[13px] font-medium text-[#0a0a0a] transition-all duration-500 hover:shadow-lg hover:shadow-[var(--gold)]/20"
        >
          Start Free Trial
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
          </svg>
        </Link>
        <button
          onClick={() => setDismissed(true)}
          className="p-2 text-neutral-600 hover:text-neutral-400 transition-colors duration-300 min-w-[36px] min-h-[36px] flex items-center justify-center"
          aria-label="Dismiss"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}
