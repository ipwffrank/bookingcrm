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
  };
  services: Array<{
    id: string;
    name: string;
    description: string | null;
    durationMinutes: number;
    priceSgd: string;
    category: string;
  }>;
  staff: Array<{
    id: string;
    name: string;
    photoUrl: string | null;
    title: string | null;
  }>;
}

export default async function BookingPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  let data: SalonData;
  try {
    data = await apiFetch(`/booking/${slug}`, { cache: 'no-store' });
  } catch {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <div className="text-center">
          <div className="text-6xl mb-4">🔍</div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Salon not found</h1>
          <p className="text-gray-500">
            We couldn&apos;t find a salon at this address. Double-check the link and try again.
          </p>
        </div>
      </div>
    );
  }

  const { merchant, services, staff } = data;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Salon Header */}
      <div className="bg-white border-b border-gray-100">
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
                className="w-16 h-16 rounded-xl object-cover border border-gray-100 shadow-sm flex-shrink-0"
              />
            ) : (
              <div className="w-16 h-16 rounded-xl bg-gradient-to-br from-indigo-400 to-purple-500 flex items-center justify-center text-white text-2xl font-bold flex-shrink-0">
                {merchant.name.charAt(0)}
              </div>
            )}
            <div>
              <h1 className="text-2xl font-bold text-gray-900">{merchant.name}</h1>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-1 text-sm text-gray-500">
                <span>⭐</span>
                <span className="capitalize">{merchant.id ? 'Beauty' : 'Salon'}</span>
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
                <p className="text-sm text-gray-600 mt-2 leading-relaxed">{merchant.description}</p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Booking Widget (client component) */}
      <div className="max-w-2xl mx-auto px-4 py-8">
        <BookingWidget merchant={merchant} services={services} staff={staff} slug={slug} />
      </div>
    </div>
  );
}
