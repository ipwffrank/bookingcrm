'use client';

import { useEffect, useState } from 'react';

/**
 * Fetches a private blob through the API proxy (with auth header) and renders
 * it as an <img>. Handles object-URL cleanup on unmount / path change.
 *
 * `proxyPath` is the relative API path, e.g.:
 *   /merchant/clients/:profileId/clinical-records/:recordId/photos/:attachmentId
 *   /merchant/clients/:profileId/clinical-records/:recordId/consent-signature
 */
export function PrivatePhoto({
  proxyPath,
  alt,
  className,
  onClick,
}: {
  proxyPath: string;
  alt: string;
  className?: string;
  onClick?: () => void;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let createdUrl: string | null = null;

    (async () => {
      const token = typeof window !== 'undefined' ? localStorage.getItem('access_token') : null;
      try {
        const apiBase = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
        const res = await fetch(`${apiBase}${proxyPath}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) throw new Error(`Fetch failed ${res.status}`);
        const blob = await res.blob();
        if (cancelled) return;
        createdUrl = URL.createObjectURL(blob);
        setSrc(createdUrl);
      } catch {
        if (!cancelled) setError(true);
      }
    })();

    return () => {
      cancelled = true;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [proxyPath]);

  if (error) {
    return (
      <div
        className={`bg-grey-10 flex items-center justify-center text-[10px] text-grey-50 ${className ?? ''}`}
      >
        Failed
      </div>
    );
  }
  if (!src) {
    return <div className={`bg-grey-5 animate-pulse ${className ?? ''}`} />;
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} className={className} onClick={onClick} />
  );
}
