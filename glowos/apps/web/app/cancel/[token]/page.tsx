import CancelClient from './CancelClient';
import { apiFetch } from '../../lib/api';

export const dynamic = 'force-dynamic';

interface CancelData {
  booking: {
    id: string;
    startTime: string;
    priceSgd: string;
    status: string;
  };
  service?: {
    name: string;
    durationMinutes: number;
  };
  eligible: boolean;
  reason?: string;
  refund_type: 'full' | 'partial' | 'none';
  refund_amount: number;
  refund_percentage: number;
}

export default async function CancelPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  let data: CancelData;
  try {
    data = await apiFetch(`/booking/cancel/${token}`, { cache: 'no-store' });
  } catch {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <div className="text-center">
          <div className="text-5xl mb-4">❌</div>
          <h1 className="text-xl font-bold text-gray-900 mb-2">Invalid cancellation link</h1>
          <p className="text-gray-500 text-sm">
            This link is invalid or has expired. Check your WhatsApp for the correct link.
          </p>
        </div>
      </div>
    );
  }

  return <CancelClient token={token} data={data} />;
}
