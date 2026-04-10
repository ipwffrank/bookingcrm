import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'GlowOS — Smart Booking for Singapore Salons',
  description:
    'Get booked on Google. Keep clients coming back. The smart booking platform for Singapore\'s best salons.',
  keywords: 'salon booking, beauty booking, Singapore, hair salon, nail studio, spa',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={inter.className}>{children}</body>
    </html>
  );
}
