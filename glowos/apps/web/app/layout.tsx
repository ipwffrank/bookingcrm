import type { Metadata } from 'next';
import { Cormorant_Garamond, Outfit } from 'next/font/google';
import './globals.css';

const outfit = Outfit({
  subsets: ['latin'],
  variable: '--font-body',
  weight: ['300', '400', '500', '600'],
});

const cormorant = Cormorant_Garamond({
  subsets: ['latin'],
  variable: '--font-display',
  weight: ['300', '400', '500', '600', '700'],
  style: ['normal', 'italic'],
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
      <body className={`${outfit.variable} ${cormorant.variable} font-[family-name:var(--font-body)] antialiased`}>
        {children}
      </body>
    </html>
  );
}
