import Link from 'next/link';
import { apiFetch } from '../../lib/api';
import PackagePurchaseClient from './PackagePurchaseClient';

export const dynamic = 'force-dynamic';

interface SalonData {
  merchant: {
    id: string;
    slug: string;
    name: string;
    description: string | null;
    logoUrl: string | null;
    country?: 'SG' | 'MY' | null;
    paymentEnabled?: boolean;
  };
  services: Array<{ id: string; name: string; slotType: 'standard' | 'consult' | 'treatment' }>;
}

interface PackageTemplate {
  id: string;
  name: string;
  description: string | null;
  priceSgd: string;
  totalSessions: number;
  validityDays: number;
  isActive: boolean;
  requiresConsultFirst: boolean;
  includedServices: Array<{ serviceId: string; serviceName: string; quantity: number }>;
}

export default async function PackagesPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  let salonData: SalonData | null = null;
  let packages: PackageTemplate[] = [];
  try {
    salonData = (await apiFetch(`/booking/${slug}`, { cache: 'no-store' })) as SalonData;
    const pkgData = (await apiFetch(`/booking/${slug}/packages`, { cache: 'no-store' })) as { packages: PackageTemplate[] };
    packages = (pkgData.packages ?? []).filter((p) => p.isActive);
  } catch {
    return (
      <div className="min-h-screen bg-tone-surface-warm flex items-center justify-center px-4">
        <div className="text-center">
          <div className="text-6xl mb-4">🔍</div>
          <h1 className="text-2xl font-bold text-tone-ink mb-2">Business not found</h1>
        </div>
      </div>
    );
  }

  const merchant = salonData.merchant;

  return (
    <div className="min-h-screen bg-tone-surface-warm">
      {/* Header */}
      <div className="bg-tone-surface border-b border-grey-15">
        <div className="max-w-2xl mx-auto px-4 py-5">
          <Link href={`/${slug}`} className="text-xs text-tone-sage hover:underline">
            ← Back to {merchant.name}
          </Link>
          <div className="flex items-start gap-4 mt-3">
            {merchant.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={merchant.logoUrl}
                alt={merchant.name}
                className="w-14 h-14 rounded-xl object-cover border border-grey-15 shadow-sm flex-shrink-0"
              />
            ) : (
              <div className="w-14 h-14 rounded-xl bg-tone-ink flex items-center justify-center text-tone-surface text-xl font-bold flex-shrink-0">
                {merchant.name.charAt(0)}
              </div>
            )}
            <div>
              <h1 className="text-xl font-bold text-tone-ink">{merchant.name}</h1>
              <p className="text-xs text-grey-60 mt-0.5 uppercase tracking-wider">Packages & bundles</p>
            </div>
          </div>
        </div>
      </div>

      {/* Packages */}
      <div className="max-w-2xl mx-auto px-4 py-6">
        {packages.length === 0 ? (
          <div className="bg-tone-surface rounded-xl border border-grey-15 p-8 text-center">
            <p className="text-sm text-grey-60">No packages are currently available.</p>
            <Link href={`/${slug}`} className="mt-3 inline-block text-xs text-tone-sage hover:underline">
              Book a single service instead →
            </Link>
          </div>
        ) : (
          <PackagePurchaseClient
            slug={slug}
            packages={packages}
            defaultCountry={merchant.country ?? 'SG'}
            paymentEnabled={merchant.paymentEnabled ?? false}
            consultServiceId={salonData.services.find((s) => s.slotType === 'consult')?.id ?? null}
          />
        )}
      </div>
    </div>
  );
}
