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
  searchParams: Promise<{ booking?: string; service?: string; staff?: string; time?: string; amount?: string }>;
}) {
  const { slug } = await params;
  const { booking, service, staff, time, amount } = await searchParams;

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 via-white to-indigo-50 flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-2xl shadow-xl shadow-gray-100 border border-gray-100 overflow-hidden">
          {/* Header */}
          <div className="bg-gradient-to-r from-green-400 to-emerald-500 px-8 py-10 text-white text-center">
            <div className="text-5xl mb-3">✅</div>
            <h1 className="text-2xl font-bold mb-1">Booking Confirmed!</h1>
            <p className="text-green-100 text-sm">We&apos;re looking forward to seeing you</p>
          </div>

          {/* Details */}
          <div className="px-8 py-6 space-y-4">
            {booking && (
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Booking ref</span>
                <span className="font-mono text-gray-700 text-xs">{booking.slice(0, 8).toUpperCase()}</span>
              </div>
            )}
            {service && (
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Service</span>
                <span className="font-medium text-gray-900">{service}</span>
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
                <span className="font-medium text-gray-900">{formatTime(time)}</span>
              </div>
            )}
            {amount && (
              <div className="flex justify-between text-sm border-t border-gray-100 pt-4">
                <span className="text-gray-500">Amount paid</span>
                <span className="font-semibold text-gray-900">
                  SGD {parseFloat(amount).toFixed(2)}
                </span>
              </div>
            )}
          </div>

          {/* WhatsApp notice */}
          <div className="mx-8 mb-6 bg-green-50 border border-green-100 rounded-xl px-4 py-3 text-sm text-green-700">
            <div className="font-medium mb-0.5">💬 Confirmation on the way</div>
            You&apos;ll receive a WhatsApp confirmation shortly with your booking details.
          </div>

          {/* Cancel notice */}
          <div className="mx-8 mb-8 text-xs text-gray-400 text-center">
            Need to cancel? Check your WhatsApp message for the cancellation link.
          </div>

          <div className="px-8 pb-8">
            <Link
              href={`/${slug}`}
              className="block w-full rounded-xl border border-gray-200 py-3 text-center text-sm font-medium text-gray-700 hover:border-indigo-300 hover:text-indigo-600 transition-colors"
            >
              Back to {slug.replace(/-/g, ' ')}
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
