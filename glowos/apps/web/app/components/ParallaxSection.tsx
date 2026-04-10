'use client';

import { useEffect, useRef, type ReactNode } from 'react';

/**
 * Lightweight parallax wrapper using IntersectionObserver + scroll listener.
 * Only applies transform while section is in viewport for performance.
 * `speed` controls parallax intensity: 0 = no parallax, 0.5 = half-speed, etc.
 */
export default function ParallaxSection({
  children,
  speed = 0.15,
  className = '',
}: {
  children: ReactNode;
  speed?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const isVisible = useRef(false);
  const rafId = useRef<number>(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // Check for reduced motion preference
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReducedMotion) return;

    // Only attach scroll listener when element is in viewport
    const observer = new IntersectionObserver(
      ([entry]) => {
        isVisible.current = entry.isIntersecting;
      },
      { rootMargin: '100px 0px' }
    );

    function onScroll() {
      if (!isVisible.current || !el) return;
      cancelAnimationFrame(rafId.current);
      rafId.current = requestAnimationFrame(() => {
        const rect = el.getBoundingClientRect();
        const windowHeight = window.innerHeight;
        // How far through the viewport the element is (0 = top, 1 = bottom)
        const progress = (windowHeight - rect.top) / (windowHeight + rect.height);
        const offset = (progress - 0.5) * speed * 100;
        el.style.transform = `translateY(${offset}px)`;
      });
    }

    observer.observe(el);
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll(); // initial position

    return () => {
      observer.disconnect();
      window.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(rafId.current);
    };
  }, [speed]);

  return (
    <div ref={ref} className={`parallax-layer ${className}`}>
      {children}
    </div>
  );
}
