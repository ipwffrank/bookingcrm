'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

export default function NavBar() {
  const [scrolled, setScrolled] = useState(false);
  const [pastHero, setPastHero] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    function onScroll() {
      setScrolled(window.scrollY > 20);
      setPastHero(window.scrollY > window.innerHeight * 0.7);
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  function handleAnchor(e: React.MouseEvent<HTMLAnchorElement>, id: string) {
    e.preventDefault();
    setMobileOpen(false);
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth' });
    }
  }

  return (
    <header
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-700 ${
        scrolled
          ? 'bg-[#0a0a0a]/85 backdrop-blur-2xl border-b border-white/[0.04] shadow-lg shadow-black/20'
          : 'bg-transparent'
      }`}
    >
      <div className="max-w-7xl mx-auto px-6 lg:px-8">
        <div className="flex items-center justify-between h-20">
          {/* Logo */}
          <Link
            href="/"
            className="flex items-center gap-3 group"
            aria-label="GlowOS home"
          >
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-[var(--gold)] to-[var(--gold-dark)] flex items-center justify-center group-hover:shadow-lg group-hover:shadow-[var(--gold)]/15 transition-all duration-500 group-hover:scale-105">
              <span className="text-white text-sm font-semibold">G</span>
            </div>
            <span className="text-[17px] font-medium text-white tracking-tight">
              Glow<span className="text-[var(--gold)]">OS</span>
            </span>
          </Link>

          {/* Desktop nav links */}
          <nav className="hidden md:flex items-center gap-12">
            {[
              { label: 'Features', id: 'features' },
              { label: 'How It Works', id: 'how-it-works' },
              { label: 'Pricing', id: 'pricing' },
            ].map((link) => (
              <a
                key={link.id}
                href={`#${link.id}`}
                onClick={(e) => handleAnchor(e, link.id)}
                className="relative text-[13px] font-normal text-neutral-500 hover:text-white transition-colors duration-500 tracking-[0.08em] uppercase cursor-pointer after:absolute after:bottom-[-4px] after:left-0 after:w-0 after:h-px after:bg-[var(--gold)] hover:after:w-full after:transition-all after:duration-500"
              >
                {link.label}
              </a>
            ))}
          </nav>

          {/* Desktop CTA buttons */}
          <div className="hidden md:flex items-center gap-6">
            <Link
              href="/login"
              className="text-[13px] font-normal text-neutral-500 hover:text-white transition-colors duration-500 tracking-wide"
            >
              Log in
            </Link>
            {/* Animated CTA - grows more prominent after scrolling past hero */}
            <Link
              href="/signup"
              className={`text-[13px] font-medium text-[#0a0a0a] bg-[var(--gold)] hover:bg-[var(--gold-light)] rounded-lg transition-all duration-500 tracking-wide hover:shadow-lg hover:shadow-[var(--gold)]/15 ${
                pastHero
                  ? 'px-7 py-3 animate-pulse-glow'
                  : 'px-6 py-2.5'
              }`}
            >
              Get Started
            </Link>
          </div>

          {/* Mobile menu button */}
          <button
            onClick={() => setMobileOpen(!mobileOpen)}
            className="md:hidden p-3 text-neutral-500 hover:text-white transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
            aria-label="Toggle menu"
            aria-expanded={mobileOpen}
          >
            <div className="w-5 h-4 relative flex flex-col justify-between">
              <span className={`block h-px bg-current transition-all duration-300 ${mobileOpen ? 'rotate-45 translate-y-[7px]' : ''}`} />
              <span className={`block h-px bg-current transition-all duration-300 ${mobileOpen ? 'opacity-0' : ''}`} />
              <span className={`block h-px bg-current transition-all duration-300 ${mobileOpen ? '-rotate-45 -translate-y-[7px]' : ''}`} />
            </div>
          </button>
        </div>

        {/* Mobile menu */}
        <div
          className={`md:hidden overflow-hidden transition-all duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] ${
            mobileOpen ? 'max-h-80 opacity-100' : 'max-h-0 opacity-0'
          }`}
        >
          <div className="border-t border-white/[0.04] py-8 space-y-1">
            {[
              { label: 'Features', id: 'features' },
              { label: 'How It Works', id: 'how-it-works' },
              { label: 'Pricing', id: 'pricing' },
            ].map((link) => (
              <a
                key={link.id}
                href={`#${link.id}`}
                onClick={(e) => handleAnchor(e, link.id)}
                className="block px-4 py-3 text-sm text-neutral-500 hover:text-white transition-colors duration-300 min-h-[44px] flex items-center"
              >
                {link.label}
              </a>
            ))}
            <div className="pt-6 flex flex-col gap-3 px-4">
              <Link
                href="/login"
                onClick={() => setMobileOpen(false)}
                className="text-center text-sm text-neutral-500 hover:text-white border border-white/[0.06] hover:border-white/[0.12] px-4 py-3.5 rounded-lg transition-colors duration-300 min-h-[44px]"
              >
                Log in
              </Link>
              <Link
                href="/signup"
                onClick={() => setMobileOpen(false)}
                className="text-center text-sm font-medium text-[#0a0a0a] bg-[var(--gold)] hover:bg-[var(--gold-light)] px-4 py-3.5 rounded-lg transition-all duration-300 min-h-[44px]"
              >
                Get Started
              </Link>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
