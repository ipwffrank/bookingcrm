'use client';

import { useState, useEffect, useCallback } from 'react';

interface Testimonial {
  quote: string;
  name: string;
  role: string;
  initial: string;
}

export default function TestimonialCarousel({
  testimonials,
}: {
  testimonials: Testimonial[];
}) {
  const [active, setActive] = useState(0);
  const [direction, setDirection] = useState<'next' | 'prev'>('next');
  const [isAnimating, setIsAnimating] = useState(false);

  const count = testimonials.length;

  const goTo = useCallback(
    (index: number, dir: 'next' | 'prev') => {
      if (isAnimating) return;
      setDirection(dir);
      setIsAnimating(true);
      setTimeout(() => {
        setActive(index);
        setIsAnimating(false);
      }, 400);
    },
    [isAnimating]
  );

  const next = useCallback(() => {
    goTo((active + 1) % count, 'next');
  }, [active, count, goTo]);

  const prev = useCallback(() => {
    goTo((active - 1 + count) % count, 'prev');
  }, [active, count, goTo]);

  // Auto-advance every 6 seconds
  useEffect(() => {
    const interval = setInterval(next, 6000);
    return () => clearInterval(interval);
  }, [next]);

  const t = testimonials[active];

  return (
    <div className="relative">
      {/* Quote content */}
      <div className="relative min-h-[280px] sm:min-h-[220px] flex items-center justify-center">
        <div
          className={`transition-all duration-500 ${
            isAnimating
              ? direction === 'next'
                ? 'opacity-0 -translate-x-8'
                : 'opacity-0 translate-x-8'
              : 'opacity-100 translate-x-0'
          }`}
        >
          <div className="text-6xl sm:text-8xl text-[var(--gold)]/[0.08] font-[family-name:var(--font-display)] leading-none select-none mb-4 text-center">
            &ldquo;
          </div>
          <blockquote className="text-xl sm:text-[22px] lg:text-[28px] font-[family-name:var(--font-display)] font-light text-white/90 leading-[1.5] mb-12 italic text-center max-w-2xl mx-auto">
            {t.quote}
          </blockquote>
          <div className="flex items-center justify-center gap-4">
            <div className="w-11 h-11 rounded-full bg-gradient-to-br from-[var(--gold)] to-[var(--gold-dark)] flex items-center justify-center text-white font-medium text-sm shadow-lg shadow-[var(--gold)]/10">
              {t.initial}
            </div>
            <div className="text-left">
              <div className="text-[14px] font-medium text-white">{t.name}</div>
              <div className="text-[12px] text-neutral-600">{t.role}</div>
            </div>
          </div>
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center justify-center gap-6 mt-12">
        <button
          onClick={prev}
          className="w-10 h-10 rounded-xl border border-white/[0.06] hover:border-[var(--gold)]/20 bg-white/[0.02] hover:bg-white/[0.04] flex items-center justify-center text-neutral-600 hover:text-white transition-all duration-300"
          aria-label="Previous testimonial"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
          </svg>
        </button>

        {/* Dots */}
        <div className="flex items-center gap-2" role="tablist" aria-label="Testimonial navigation">
          {testimonials.map((_, i) => (
            <button
              key={i}
              role="tab"
              aria-selected={i === active}
              aria-label={`Testimonial ${i + 1}`}
              onClick={() => goTo(i, i > active ? 'next' : 'prev')}
              className={`rounded-full transition-all duration-500 min-w-[24px] min-h-[24px] flex items-center justify-center ${
                i === active
                  ? 'w-6 h-2 bg-[var(--gold)]'
                  : 'w-2 h-2 bg-white/10 hover:bg-white/20'
              }`}
            />
          ))}
        </div>

        <button
          onClick={next}
          className="w-10 h-10 rounded-xl border border-white/[0.06] hover:border-[var(--gold)]/20 bg-white/[0.02] hover:bg-white/[0.04] flex items-center justify-center text-neutral-600 hover:text-white transition-all duration-300"
          aria-label="Next testimonial"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
          </svg>
        </button>
      </div>
    </div>
  );
}
