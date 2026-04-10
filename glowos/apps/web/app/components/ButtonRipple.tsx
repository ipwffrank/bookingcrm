'use client';

import { useCallback, useRef, type ReactNode, type MouseEvent } from 'react';

/**
 * Wraps any element with a ripple effect on click.
 * Light-weight, no external dependencies.
 */
export default function ButtonRipple({
  children,
  className = '',
  color = 'rgba(255,255,255,0.15)',
}: {
  children: ReactNode;
  className?: string;
  color?: string;
}) {
  const containerRef = useRef<HTMLSpanElement>(null);

  const handleClick = useCallback(
    (e: MouseEvent<HTMLSpanElement>) => {
      const container = containerRef.current;
      if (!container) return;

      const rect = container.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      const ripple = document.createElement('span');
      const size = Math.max(rect.width, rect.height);

      ripple.style.cssText = `
        position: absolute;
        width: ${size}px;
        height: ${size}px;
        left: ${x - size / 2}px;
        top: ${y - size / 2}px;
        background: ${color};
        border-radius: 50%;
        pointer-events: none;
        animation: ripple 0.6s ease-out forwards;
      `;

      container.appendChild(ripple);
      ripple.addEventListener('animationend', () => ripple.remove());
    },
    [color]
  );

  return (
    <span
      ref={containerRef}
      className={`relative overflow-hidden inline-flex ${className}`}
      onClick={handleClick}
    >
      {children}
    </span>
  );
}
