import type { Metadata } from 'next';
import { apiFetch } from '../../lib/api';
import BookingWidget from '../../[slug]/BookingWidget';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

interface SalonData {
  merchant: {
    id: string;
    slug: string;
    name: string;
    description: string | null;
    logoUrl: string | null;
    coverPhotoUrl: string | null;
    phone: string | null;
    addressLine1: string | null;
    addressLine2: string | null;
    postalCode: string | null;
    timezone: string;
    country?: 'SG' | 'MY' | null;
    paymentEnabled?: boolean;
    operatingHours?: Record<string, { open: string; close: string; closed: boolean }> | null;
  };
  services: Array<{
    id: string;
    name: string;
    description: string | null;
    durationMinutes: number;
    priceSgd: string;
    category: string;
    slotType: 'standard' | 'consult' | 'treatment';
    requiresConsultFirst: boolean;
    discountPct: number | null;
    discountShowOnline: boolean;
    firstTimerDiscountPct: number | null;
    firstTimerDiscountEnabled: boolean;
  }>;
  staff: Array<{
    id: string;
    name: string;
    photoUrl: string | null;
    title: string | null;
    bio: string | null;
    specialtyTags: string[] | null;
    isAnyAvailable: boolean;
  }>;
}

export default async function EmbedPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  let data: SalonData | null = null;
  try {
    data = (await apiFetch(`/booking/${slug}`, { cache: 'no-store' })) as SalonData;
  } catch {
    data = null;
  }

  if (!data) {
    return (
      <div className="min-h-screen bg-transparent flex items-center justify-center p-4">
        <p className="text-sm text-gray-500">Booking is temporarily unavailable.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-transparent">
      <div className="max-w-2xl mx-auto px-2 py-4">
        <BookingWidget
          merchant={data.merchant}
          services={data.services}
          staff={data.staff}
          slug={slug}
          embedded
        />
      </div>
      <footer className="py-3 text-center">
        <span className="text-[11px] text-gray-400">Powered by GlowOS</span>
      </footer>
    </div>
  );
}
