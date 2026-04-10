'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

type Animation =
  | 'fade-up'
  | 'fade-down'
  | 'fade-in'
  | 'slide-in-left'
  | 'slide-in-right'
  | 'scale-in'
  | 'scale-up'
  | 'blur-in'
  | 'rotate-in';

export default function AnimateOnScroll({
  children,
  animation = 'fade-up',
  delay = 0,
  className = '',
  threshold = 0.15,
  stagger = 0,
  as: Tag = 'div',
}: {
  children: ReactNode;
  animation?: Animation;
  delay?: number;
  className?: string;
  threshold?: number;
  /** If > 0, each direct child gets staggered by this many ms */
  stagger?: number;
  as?: 'div' | 'section' | 'article' | 'li' | 'span';
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.unobserve(el);
        }
      },
      { threshold, rootMargin: '0px 0px -60px 0px' }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [threshold]);

  const animationClass = visible ? `animate-${animation}` : 'reveal-hidden';
  const delayStyle = delay > 0 ? { animationDelay: `${delay}ms` } : undefined;

  // If stagger mode, apply stagger delays via CSS custom properties
  if (stagger > 0 && visible) {
    return (
      <Tag
        ref={ref as React.RefObject<HTMLDivElement>}
        className={className}
        style={{ '--stagger-interval': `${stagger}ms` } as React.CSSProperties}
      >
        {Array.isArray(children)
          ? children.map((child, i) => (
              <div
                key={i}
                className={`animate-${animation}`}
                style={{ animationDelay: `${delay + i * stagger}ms` }}
              >
                {child}
              </div>
            ))
          : <div className={`animate-${animation}`} style={delayStyle}>{children}</div>
        }
      </Tag>
    );
  }

  return (
    <Tag
      ref={ref as React.RefObject<HTMLDivElement>}
      className={`${animationClass} ${className}`}
      style={delayStyle}
    >
      {children}
    </Tag>
  );
}
