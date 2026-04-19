'use client';

interface Props {
  maskedName: string;
  phone: string;
  onConfirm: () => void;
  onNotMe: () => void;
}

export function ReturningCustomerCard({ maskedName, phone, onConfirm, onNotMe }: Props) {
  return (
    <div className="rounded-lg border border-green-200 bg-green-50 p-4">
      <div className="font-medium">👋 Welcome back, {maskedName}!</div>
      <div className="text-sm text-gray-600 mt-1">Is this you? {phone}</div>
      <div className="mt-3 space-y-2">
        <button
          type="button"
          onClick={onConfirm}
          className="w-full rounded bg-green-600 text-white py-2 text-sm font-medium"
        >
          Send WhatsApp code to continue
        </button>
        <button
          type="button"
          onClick={onNotMe}
          className="w-full text-xs text-gray-500 underline"
        >
          Not me
        </button>
      </div>
    </div>
  );
}
