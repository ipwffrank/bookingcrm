'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

export default function NavBar() {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    function onScroll() {
      setScrolled(window.scrollY > 20);
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
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
        scrolled
          ? 'bg-gray-950/95 backdrop-blur-md shadow-xl shadow-black/20'
          : 'bg-transparent'
      }`}
    >
      <div className="max-w-7xl mx-auto px-6 lg:px-8">
        <div className="flex items-center justify-between h-16 lg:h-20">
          {/* Logo */}
          <Link
            href="/"
            className="flex items-center gap-2 group"
            aria-label="GlowOS home"
          >
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center shadow-lg group-hover:shadow-violet-500/40 transition-shadow">
              <span className="text-white text-sm font-bold">G</span>
            </div>
            <span className="text-xl font-bold text-white tracking-tight">
              GlowOS
            </span>
          </Link>

          {/* Desktop nav links */}
          <nav className="hidden md:flex items-center gap-8">
            <a
              href="#features"
              onClick={(e) => handleAnchor(e, 'features')}
              className="text-sm font-medium text-gray-300 hover:text-white transition-colors cursor-pointer"
            >
              Features
            </a>
            <a
              href="#pricing"
              onClick={(e) => handleAnchor(e, 'pricing')}
              className="text-sm font-medium text-gray-300 hover:text-white transition-colors cursor-pointer"
            >
              Pricing
            </a>
            <a
              href="#how-it-works"
              onClick={(e) => handleAnchor(e, 'how-it-works')}
              className="text-sm font-medium text-gray-300 hover:text-white transition-colors cursor-pointer"
            >
              About
            </a>
          </nav>

          {/* Desktop CTA buttons */}
          <div className="hidden md:flex items-center gap-3">
            <Link
              href="/login"
              className="text-sm font-medium text-gray-300 hover:text-white transition-colors px-4 py-2"
            >
              Log in
            </Link>
            <Link
              href="/signup"
              className="text-sm font-semibold text-white bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 px-5 py-2.5 rounded-lg transition-all duration-200 shadow-lg shadow-violet-900/30 hover:shadow-violet-700/40"
            >
              Start Free Trial
            </Link>
          </div>

          {/* Mobile menu button */}
          <button
            onClick={() => setMobileOpen(!mobileOpen)}
            className="md:hidden p-2 text-gray-300 hover:text-white transition-colors"
            aria-label="Toggle menu"
          >
            {mobileOpen ? (
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
              </svg>
            ) : (
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
              </svg>
            )}
          </button>
        </div>

        {/* Mobile menu */}
        {mobileOpen && (
          <div className="md:hidden border-t border-white/10 bg-gray-950/98 backdrop-blur-md">
            <div className="px-2 py-4 space-y-1">
              <a
                href="#features"
                onClick={(e) => handleAnchor(e, 'features')}
                className="block px-4 py-3 text-sm font-medium text-gray-300 hover:text-white hover:bg-white/5 rounded-lg transition-colors"
              >
                Features
              </a>
              <a
                href="#pricing"
                onClick={(e) => handleAnchor(e, 'pricing')}
                className="block px-4 py-3 text-sm font-medium text-gray-300 hover:text-white hover:bg-white/5 rounded-lg transition-colors"
              >
                Pricing
              </a>
              <a
                href="#how-it-works"
                onClick={(e) => handleAnchor(e, 'how-it-works')}
                className="block px-4 py-3 text-sm font-medium text-gray-300 hover:text-white hover:bg-white/5 rounded-lg transition-colors"
              >
                About
              </a>
              <div className="pt-3 pb-1 flex flex-col gap-2 px-4">
                <Link
                  href="/login"
                  onClick={() => setMobileOpen(false)}
                  className="text-center text-sm font-medium text-gray-300 hover:text-white border border-white/20 hover:border-white/40 px-4 py-2.5 rounded-lg transition-colors"
                >
                  Log in
                </Link>
                <Link
                  href="/signup"
                  onClick={() => setMobileOpen(false)}
                  className="text-center text-sm font-semibold text-white bg-gradient-to-r from-violet-600 to-indigo-600 px-4 py-2.5 rounded-lg transition-all"
                >
                  Start Free Trial
                </Link>
              </div>
            </div>
          </div>
        )}
      </div>
    </header>
  );
}
