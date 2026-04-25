'use client';

import { useState } from 'react';
import { apiFetch } from '../../lib/api';
import { PhoneInput } from '../components/PhoneInput';

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

interface PurchaseResponse {
  clientPackage: {
    id: string;
    packageName: string;
    sessionsTotal: number;
    expiresAt: string;
    paymentMethod: 'cash' | 'card';
    pricePaidSgd: string;
    priceDueSgd: string;
  };
}

interface Props {
  slug: string;
  packages: PackageTemplate[];
  defaultCountry: 'SG' | 'MY';
  paymentEnabled: boolean;
  // ID of the merchant's consultation service (slot_type='consult'), used to
  // build the "Book consultation" deep link for consult-required packages.
  // Null if the merchant has no consultation service configured.
  consultServiceId: string | null;
}

export default function PackagePurchaseClient({ slug, packages, defaultCountry, paymentEnabled, consultServiceId }: Props) {
  // paymentEnabled is wired through for the upcoming online-payment flow.
  void paymentEnabled;
  const [openId, setOpenId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState<PurchaseResponse['clientPackage'] | null>(null);

  function openPurchase(pkgId: string) {
    setOpenId(pkgId);
    setError('');
    setSuccess(null);
  }

  function close() {
    setOpenId(null);
    setName('');
    setPhone('');
    setEmail('');
    setError('');
    setSuccess(null);
  }

  async function handleSubmit(e: React.FormEvent, pkgId: string) {
    e.preventDefault();
    setError('');
    if (!name.trim() || !phone.trim()) {
      setError('Name and mobile number are required.');
      return;
    }
    setSubmitting(true);
    try {
      const res = (await apiFetch(`/booking/${slug}/packages/purchase`, {
        method: 'POST',
        body: JSON.stringify({
          package_id: pkgId,
          client_name: name.trim(),
          client_phone: phone.trim(),
          client_email: email.trim() || undefined,
          payment_method: 'cash',
        }),
      })) as PurchaseResponse;
      setSuccess(res.clientPackage);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Purchase failed. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-3">
      {packages.map((pkg) => {
        const isOpen = openId === pkg.id;
        const totalItems = pkg.includedServices.reduce((s, x) => s + x.quantity, 0);
        return (
          <div key={pkg.id} className="bg-tone-surface rounded-xl border border-grey-15 overflow-hidden">
            <div className="p-5">
              <div className="flex items-start justify-between gap-3 mb-1">
                <div className="min-w-0 flex-1">
                  <h2 className="text-lg font-bold text-tone-ink">{pkg.name}</h2>
                  <p className="text-xs text-grey-60 mt-0.5">
                    {pkg.totalSessions} session{pkg.totalSessions === 1 ? '' : 's'} · Valid {pkg.validityDays} days
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-xs text-grey-60 uppercase tracking-wider">Price</p>
                  <p className="text-2xl font-bold text-tone-sage">SGD {parseFloat(pkg.priceSgd).toFixed(2)}</p>
                </div>
              </div>

              {pkg.description && (
                <p className="text-sm text-grey-75 mt-2 leading-relaxed">{pkg.description}</p>
              )}

              {pkg.includedServices.length > 0 && (
                <div className="mt-3 pt-3 border-t border-grey-5">
                  <p className="text-[11px] uppercase tracking-wider text-grey-60 font-semibold mb-1.5">
                    Includes ({totalItems} {totalItems === 1 ? 'item' : 'items'})
                  </p>
                  <ul className="text-sm text-grey-90 space-y-0.5">
                    {pkg.includedServices.map((svc) => (
                      <li key={svc.serviceId} className="flex items-center gap-2">
                        <span className="text-tone-sage text-xs">✓</span>
                        <span className="truncate">
                          {svc.serviceName}
                          {svc.quantity > 1 && <span className="text-grey-60"> × {svc.quantity}</span>}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {pkg.requiresConsultFirst ? (
                <div className="mt-4 space-y-2">
                  <div className="rounded-lg bg-semantic-warn/10 border border-semantic-warn/30 px-3 py-3 text-xs text-grey-75">
                    <p className="font-semibold text-tone-ink mb-0.5">Consultation required</p>
                    This package can only be purchased after an in-person consultation. After
                    your consult, the clinic will send a personalised quote with a secure
                    payment link.
                  </div>
                  {consultServiceId ? (
                    <a
                      href={`/${slug}?service=${consultServiceId}`}
                      className="block w-full text-center rounded-xl bg-tone-ink text-tone-surface py-3 text-sm font-semibold hover:opacity-90 transition-opacity"
                    >
                      Book consultation
                    </a>
                  ) : (
                    <a
                      href={`/${slug}`}
                      className="block w-full text-center rounded-xl border border-grey-15 bg-tone-surface py-3 text-sm font-semibold text-tone-ink hover:border-tone-sage/50 transition-colors"
                    >
                      Visit booking page
                    </a>
                  )}
                </div>
              ) : !isOpen ? (
                <button
                  onClick={() => openPurchase(pkg.id)}
                  className="mt-4 w-full rounded-xl bg-tone-ink text-tone-surface py-3 text-sm font-semibold hover:opacity-90 transition-opacity"
                >
                  Buy Package
                </button>
              ) : null}
            </div>

            {isOpen && (
              <div className="border-t border-grey-15 bg-grey-5 p-5">
                {success ? (
                  <div className="text-center py-2">
                    <div className="w-12 h-12 bg-tone-sage/10 text-tone-sage rounded-full mx-auto flex items-center justify-center text-2xl mb-2">
                      ✓
                    </div>
                    <p className="text-sm font-semibold text-tone-ink">Package reserved!</p>
                    <p className="text-xs text-grey-75 mt-1">
                      {success.sessionsTotal} sessions are now on your account. Pay SGD {parseFloat(success.priceDueSgd).toFixed(2)} at your first visit to activate.
                    </p>
                    <p className="text-[11px] text-grey-60 mt-1">
                      Valid until {new Date(success.expiresAt).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </p>
                    <div className="flex gap-2 mt-4">
                      <a
                        href={`/${slug}`}
                        className="flex-1 rounded-xl border border-grey-15 bg-tone-surface py-2.5 text-sm font-medium text-tone-ink hover:border-tone-sage/50 transition-colors text-center"
                      >
                        Book a session
                      </a>
                      <button
                        onClick={close}
                        className="flex-1 rounded-xl bg-tone-ink text-tone-surface py-2.5 text-sm font-medium hover:opacity-90 transition-opacity"
                      >
                        Done
                      </button>
                    </div>
                  </div>
                ) : (
                  <form onSubmit={(e) => handleSubmit(e, pkg.id)} className="space-y-3">
                    <div>
                      <label className="block text-xs font-medium text-grey-75 mb-1">Your name</label>
                      <input
                        type="text"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Jane Tan"
                        className="w-full rounded-lg border border-grey-15 bg-tone-surface px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-tone-sage"
                        autoComplete="name"
                        autoFocus
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-grey-75 mb-1">Mobile number</label>
                      <PhoneInput
                        value={phone}
                        onChange={setPhone}
                        defaultCountry={defaultCountry}
                        placeholder="9123 4567"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-grey-75 mb-1">Email (optional)</label>
                      <input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="jane@example.com"
                        className="w-full rounded-lg border border-grey-15 bg-tone-surface px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-tone-sage"
                        autoComplete="email"
                      />
                    </div>

                    <div className="rounded-lg bg-semantic-warn/5 border border-semantic-warn/30 px-3 py-2 text-xs text-grey-75">
                      <p className="font-semibold text-tone-ink mb-0.5">🏪 Pay at first visit</p>
                      Your package is reserved immediately. Pay SGD {parseFloat(pkg.priceSgd).toFixed(2)} at the counter on your first redemption — cash, card, or PayNow accepted.
                    </div>

                    {error && (
                      <div className="rounded-lg bg-semantic-danger/5 border border-semantic-danger/30 px-3 py-2 text-xs text-semantic-danger">
                        {error}
                      </div>
                    )}

                    <div className="flex gap-2 pt-1">
                      <button
                        type="button"
                        onClick={close}
                        className="flex-1 rounded-xl border border-grey-15 bg-tone-surface py-2.5 text-sm font-medium text-grey-75 hover:bg-grey-5 transition-colors"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        disabled={submitting}
                        className="flex-1 rounded-xl bg-tone-ink text-tone-surface py-2.5 text-sm font-semibold hover:opacity-90 disabled:opacity-50 transition-opacity"
                      >
                        {submitting ? 'Reserving…' : 'Reserve Package'}
                      </button>
                    </div>
                  </form>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
