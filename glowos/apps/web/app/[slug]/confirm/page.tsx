import Link from 'next/link';

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString('en-SG', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
  } catch {
    return iso;
  }
}

export default async function ConfirmPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{
    booking_id?: string;
    // Legacy support
    booking?: string;
    service?: string;
    staff?: string;
    time?: string;
    amount?: string;
  }>;
}) {
  const { slug } = await params;
  const sp = await searchParams;

  // Support both booking_id (new) and booking (legacy)
  const bookingId = sp.booking_id ?? sp.booking;
  const { service, staff, time, amount } = sp;

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 via-white to-indigo-50 flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-2xl shadow-xl shadow-gray-100 border border-gray-100 overflow-hidden">
          {/* Header */}
          <div className="bg-gradient-to-r from-green-400 to-emerald-500 px-8 py-10 text-white text-center">
            <div className="w-16 h-16 rounded-full bg-white/20 flex items-center justify-center mx-auto mb-4 text-3xl">
              ✅
            </div>
            <h1 className="text-2xl font-bold mb-1">Booking Confirmed!</h1>
            <p className="text-green-100 text-sm">
              We&apos;re looking forward to seeing you
            </p>
          </div>

          {/* Details */}
          <div className="px-8 py-6 space-y-3">
            {bookingId && (
              <div className="flex justify-between items-center text-sm pb-3 border-b border-gray-100">
                <span className="text-gray-500">Booking ref</span>
                <span className="font-mono text-xs bg-gray-100 text-gray-700 px-2 py-1 rounded">
                  {bookingId.slice(0, 8).toUpperCase()}
                </span>
              </div>
            )}
            {service && (
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Service</span>
                <span className="font-semibold text-gray-900">{service}</span>
              </div>
            )}
            {staff && (
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Stylist</span>
                <span className="font-medium text-gray-900">{staff}</span>
              </div>
            )}
            {time && (
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Date &amp; time</span>
                <span className="font-medium text-gray-900 text-right">{formatTime(time)}</span>
              </div>
            )}
            {amount && (
              <div className="flex justify-between text-sm border-t border-gray-100 pt-3 mt-3">
                <span className="text-gray-500">Amount due</span>
                <span className="font-bold text-gray-900 text-base">
                  SGD {parseFloat(amount).toFixed(2)}
                </span>
              </div>
            )}
          </div>

          {/* Payment notice */}
          {amount && (
            <div className="mx-8 mb-4 bg-indigo-50 border border-indigo-100 rounded-xl px-4 py-3 text-sm text-indigo-700">
              <div className="font-semibold mb-0.5">💳 Pay at the salon</div>
              Please bring SGD {parseFloat(amount).toFixed(2)} on the day of your appointment.
            </div>
          )}

          {/* WhatsApp notice */}
          <div className="mx-8 mb-5 bg-green-50 border border-green-100 rounded-xl px-4 py-3 text-sm text-green-700">
            <div className="font-semibold mb-0.5">💬 Confirmation on the way</div>
            You&apos;ll receive a WhatsApp confirmation shortly with your booking details
            and a cancellation link.
          </div>

          {/* Back link */}
          <div className="px-8 pb-8">
            <Link
              href={`/${slug}`}
              className="block w-full rounded-xl border-2 border-gray-200 py-3 text-center text-sm font-semibold text-gray-700 hover:border-indigo-300 hover:text-indigo-600 transition-colors"
            >
              ← Back to {slug.replace(/-/g, ' ')}
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
