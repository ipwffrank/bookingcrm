import type { Metadata } from 'next';
import { Cormorant_Garamond, Manrope } from 'next/font/google';
import './globals.css';

/* ── Two-font system ──────────────────────────────────────────────────────
 *  Display / serif:  Cormorant Garamond  — headlines, prices, logo text
 *  Body / sans:      Manrope             — body, UI labels, buttons, nav
 * ────────────────────────────────────────────────────────────────────────── */

const cormorant = Cormorant_Garamond({
  subsets: ['latin'],
  variable: '--font-display',
  weight: ['300', '400', '500', '600', '700'],
  style: ['normal', 'italic'],
  display: 'swap',
});

const manrope = Manrope({
  subsets: ['latin'],
  variable: '--font-body',
  weight: ['300', '400', '500', '600', '700'],
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'GlowOS — Smart Booking & CRM for Service Businesses',
  description:
    'Get booked on Google. Keep clients coming back. The smart booking platform for restaurants, salons, clinics, and spas.',
  keywords: 'booking software, restaurant reservations, salon booking, clinic scheduling, spa booking, CRM, appointment management',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="scroll-smooth">
      {/* Material Symbols icon font for landing page */}
      <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap"
      />
      <body className={`${cormorant.variable} ${manrope.variable} font-[family-name:var(--font-body)] antialiased`}>
        {children}
      </body>
    </html>
  );
}
