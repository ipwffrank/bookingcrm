'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch, ApiError } from '../../lib/api';
import type {
  ServiceOption,
  StaffOption,
  PaymentMethod,
  ServiceRowState,
  ActivePackage,
  EditContextResponse,
} from './types';

export interface BookingFormProps {
  mode: 'create' | 'edit';
  bookingId?: string;
  groupId?: string;
  services?: ServiceOption[];
  staffList?: StaffOption[];
  onClose: () => void;
  onSave: () => void;
}

export function BookingForm(props: BookingFormProps) {
  const { mode, onClose, onSave } = props;
  const router = useRouter();

  const [loading, setLoading] = useState(mode === 'edit');
  const [saving, setSaving] = useState(false);
  const [apiError, setApiError] = useState('');
  const [clientName, setClientName] = useState('');
  const [clientPhone, setClientPhone] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [notes, setNotes] = useState('');
  const [services, setServices] = useState<ServiceOption[]>(props.services ?? []);
  const [staffList, setStaffList] = useState<StaffOption[]>(props.staffList ?? []);
  const [activePackages, setActivePackages] = useState<ActivePackage[]>([]);
  const [rows, setRows] = useState<ServiceRowState[]>([]);
  const [completedBanner, setCompletedBanner] = useState(false);
  const [lastEditLabel, setLastEditLabel] = useState<string | null>(null);

  useEffect(() => {
    if (mode !== 'edit' || !props.bookingId) {
      if (services[0] && staffList[0]) {
        setRows([defaultRow(services[0], staffList[0])]);
      }
      return;
    }
    const token = localStorage.getItem('access_token');
    apiFetch(`/merchant/bookings/${props.bookingId}/edit-context`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((data) => {
        const ctx = data as EditContextResponse;
        setServices(ctx.services);
        setStaffList(ctx.staff);
        setActivePackages(ctx.activePackages);
        setClientName(ctx.client.name ?? '');
        setClientPhone(ctx.client.phone);
        setPaymentMethod((ctx.group?.paymentMethod ?? 'cash') as PaymentMethod);
        setNotes(ctx.group?.notes ?? ctx.booking.clientNotes ?? '');
        setCompletedBanner(ctx.booking.status === 'completed');
        if (ctx.lastEdit) {
          setLastEditLabel(
            `Last edited ${new Date(ctx.lastEdit.createdAt).toLocaleString('en-SG')}`
          );
        }
        const list = ctx.siblingBookings.length > 0 ? ctx.siblingBookings : [{ booking: ctx.booking }];
        setRows(
          list.map((sib) => ({
            bookingId: sib.booking.id,
            serviceId: sib.booking.serviceId,
            staffId: sib.booking.staffId,
            startTime: sib.booking.startTime,
            priceSgd: sib.booking.priceSgd,
            priceTouched: false,
          }))
        );
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) router.push('/login');
        else setApiError(err instanceof Error ? err.message : 'Failed to load');
      })
      .finally(() => setLoading(false));
  }, [mode, props.bookingId, router, services, staffList]);

  function defaultRow(svc: ServiceOption, st: StaffOption): ServiceRowState {
    const now = new Date();
    return {
      serviceId: svc.id,
      staffId: st.id,
      startTime: now.toISOString(),
      priceSgd: svc.priceSgd,
      priceTouched: false,
    };
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    // Wired in Task 19
  }

  if (loading) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center">
        <div className="fixed inset-0 bg-black/40" onClick={onClose} />
        <div className="relative bg-white rounded-2xl p-6 z-10">Loading…</div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <div className="fixed inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl p-6 z-10 max-h-[90vh] overflow-y-auto">
        <h2 className="text-lg font-bold text-gray-900 mb-1">
          {mode === 'create' ? 'Add Walk-in Booking' : 'Edit Booking'}
        </h2>
        {lastEditLabel && <p className="text-xs text-gray-500 mb-3">{lastEditLabel}</p>}
        {completedBanner && (
          <div className="mb-4 rounded-lg bg-amber-50 border border-amber-200 px-4 py-2 text-xs text-amber-800">
            This booking is completed. Edits will not re-send review requests or recalculate commissions.
          </div>
        )}
        {apiError && (
          <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-600">
            {apiError}
          </div>
        )}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-xl border border-gray-300 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 rounded-xl bg-indigo-600 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
            >
              {saving ? 'Saving…' : mode === 'create' ? 'Create Booking' : 'Save changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
