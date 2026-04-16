'use client';

import { useEffect, useRef, useState } from 'react';

interface HeroVideoProps {
  /** Path to video in /public, e.g. "/videos/hero-bg.mp4" */
  src: string;
  /** Optional WebM source for smaller file size */
  srcWebm?: string;
  /** Overlay opacity 0-1 (default 0.6) */
  overlayOpacity?: number;
  /** Poster/fallback image while video loads */
  poster?: string;
}

export default function HeroVideo({ src, srcWebm, overlayOpacity = 0.6, poster }: HeroVideoProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    // Reduce bandwidth on mobile by pausing when not visible
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          video.play().catch(() => {});
        } else {
          video.pause();
        }
      },
      { threshold: 0.1 }
    );
    obs.observe(video);
    return () => obs.disconnect();
  }, []);

  return (
    <div className="absolute inset-0 overflow-hidden">
      <video
        ref={videoRef}
        autoPlay
        muted
        loop
        playsInline
        poster={poster}
        onLoadedData={() => setLoaded(true)}
        className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-1000 ${loaded ? 'opacity-100' : 'opacity-0'}`}
      >
        {srcWebm && <source src={srcWebm} type="video/webm" />}
        <source src={src} type="video/mp4" />
      </video>
      {/* Dark overlay for text readability */}
      <div
        className="absolute inset-0"
        style={{ backgroundColor: `rgba(0, 0, 0, ${overlayOpacity})` }}
      />
    </div>
  );
}
