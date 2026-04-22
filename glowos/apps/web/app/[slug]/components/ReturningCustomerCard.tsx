'use client';

interface Props {
  maskedName: string;
  phone: string;
  onConfirm: () => void;
  onNotMe: () => void;
}

export function ReturningCustomerCard({ maskedName, phone, onConfirm, onNotMe }: Props) {
  return (
    <div className="rounded-lg border border-tone-sage/30 bg-tone-sage/5 p-4">
      <div className="font-medium">👋 Welcome back, {maskedName}!</div>
      <div className="text-sm text-grey-75 mt-1">Is this you? {phone}</div>
      <div className="mt-3 space-y-2">
        <button
          type="button"
          onClick={onConfirm}
          className="w-full rounded bg-tone-sage text-white py-2 text-sm font-medium"
        >
          Send WhatsApp code to continue
        </button>
        <button
          type="button"
          onClick={onNotMe}
          className="w-full text-xs text-grey-60 underline"
        >
          Not me
        </button>
      </div>
    </div>
  );
}
