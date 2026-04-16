import type { Metadata } from 'next';
import { Cormorant_Garamond, Outfit, Newsreader, Manrope, Inter } from 'next/font/google';
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

// Landing page fonts (variable names use --nf- prefix to avoid @theme collision)
const newsreader = Newsreader({
  subsets: ['latin'],
  weight: ['300', '400', '600'],
  style: ['normal', 'italic'],
  variable: '--nf-newsreader',
  display: 'swap',
});

const manrope = Manrope({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--nf-manrope',
  display: 'swap',
});

const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--nf-inter',
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
      <body className={`${outfit.variable} ${cormorant.variable} ${newsreader.variable} ${manrope.variable} ${inter.variable} font-[family-name:var(--font-body)] antialiased`}>
        {children}
      </body>
    </html>
  );
}
