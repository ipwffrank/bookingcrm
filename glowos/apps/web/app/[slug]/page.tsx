import Link from 'next/link';
import { apiFetch } from '../lib/api';
import BookingWidget from './BookingWidget';

export const dynamic = 'force-dynamic';

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
    country?: 'SG' | 'MY' | 'HK' | null;
    paymentEnabled?: boolean;
    paymentGateway?: 'stripe' | 'ipay88';
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
    consultServiceId: string | null;
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
    serviceIds?: string[];
  }>;
}

export default async function BookingPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  let data: SalonData;
  try {
    data = await apiFetch(`/booking/${slug}`, { cache: 'no-store' });
  } catch {
    return (
      <div className="min-h-screen bg-grey-5 flex items-center justify-center px-4">
        <div className="text-center">
          <div className="text-6xl mb-4">🔍</div>
          <h1 className="text-2xl font-bold text-tone-ink mb-2">Business not found</h1>
          <p className="text-grey-60">
            We couldn&apos;t find a business at this address. Double-check the link and try again.
          </p>
        </div>
      </div>
    );
  }

  const { merchant, services, staff } = data;

  return (
    <div className="min-h-screen bg-grey-5">
      {/* Business Header */}
      <div className="bg-tone-surface border-b border-grey-5">
        {merchant.coverPhotoUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={merchant.coverPhotoUrl}
            alt={merchant.name}
            className="w-full h-48 object-cover"
          />
        )}
        <div className="max-w-2xl mx-auto px-4 py-6">
          <div className="flex items-start gap-4">
            {merchant.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={merchant.logoUrl}
                alt={merchant.name}
                className="w-16 h-16 rounded-xl object-cover border border-grey-5 shadow-sm flex-shrink-0"
              />
            ) : (
              <div className="w-16 h-16 rounded-xl bg-tone-ink flex items-center justify-center text-white text-2xl font-bold flex-shrink-0">
                {merchant.name.charAt(0)}
              </div>
            )}
            <div>
              <h1 className="text-2xl font-bold text-tone-ink">{merchant.name}</h1>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-1 text-sm text-grey-60">
                <span>⭐</span>
                <span className="capitalize">Service Business</span>
                {merchant.addressLine1 && (
                  <>
                    <span>·</span>
                    <span>
                      {merchant.addressLine1}
                      {merchant.postalCode ? `, Singapore ${merchant.postalCode}` : ''}
                    </span>
                  </>
                )}
              </div>
              {merchant.description && (
                <p className="text-sm text-grey-75 mt-2 leading-relaxed">{merchant.description}</p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Packages entry point — subtle banner linking to the purchase page */}
      <div className="max-w-2xl mx-auto px-4 pt-6">
        <Link
          href={`/${slug}/packages`}
          className="block rounded-xl border border-tone-sage/30 bg-tone-sage/5 px-4 py-3 text-sm text-tone-sage hover:bg-tone-sage/10 transition-colors"
        >
          <span className="font-semibold">🎁 Browse packages & bundles</span>
          <span className="text-grey-75"> — save more with a multi-session package</span>
        </Link>
      </div>

      {/* Booking Widget (client component) */}
      <div className="max-w-2xl mx-auto px-4 py-6">
        <BookingWidget merchant={merchant} services={services} staff={staff} slug={slug} />
      </div>
    </div>
  );
}
