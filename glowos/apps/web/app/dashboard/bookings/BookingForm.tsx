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
import { ServiceRow } from './ServiceRow';

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

  const totalPrice = rows.reduce((s, r) => s + Number(r.priceSgd || 0), 0);

  function addServiceRow() {
    const prev = rows[rows.length - 1];
    const defaultSvc = services[0];
    const defaultStaff = staffList[0];
    if (!defaultSvc || !defaultStaff) return;
    const anchor = prev
      ? new Date(
          new Date(prev.startTime).getTime() +
            (services.find((s) => s.id === prev.serviceId)?.durationMinutes ?? 30) *
              60_000
        ).toISOString()
      : new Date().toISOString();
    setRows([
      ...rows,
      {
        serviceId: defaultSvc.id,
        staffId: defaultStaff.id,
        startTime: anchor,
        priceSgd: defaultSvc.priceSgd,
        priceTouched: false,
      },
    ]);
  }

  async function maybeLookupClient() {
    if (mode !== 'create' || clientPhone.trim().length < 6) return;
    const token = localStorage.getItem('access_token');
    try {
      const res = (await apiFetch(
        `/merchant/clients/lookup?phone=${encodeURIComponent(clientPhone)}`,
        { headers: { Authorization: `Bearer ${token}` } }
      )) as {
        client: { id: string; name: string | null } | null;
        activePackages: ActivePackage[];
      };
      if (res.client && !clientName) setClientName(res.client.name ?? '');
      setActivePackages(res.activePackages ?? []);
    } catch {
      // silent — lookup is opportunistic
    }
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
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Client Name</label>
              <input
                type="text"
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                placeholder="Jane Doe"
                disabled={mode === 'edit'}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
              <input
                type="tel"
                value={clientPhone}
                onChange={(e) => setClientPhone(e.target.value)}
                onBlur={() => void maybeLookupClient()}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                placeholder="+65 9123 4567"
                disabled={mode === 'edit'}
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Services</label>
            <div className="space-y-2">
              {rows.map((row, i) => (
                <ServiceRow
                  key={row.bookingId ?? `new-${i}`}
                  row={row}
                  services={services}
                  staff={staffList}
                  activePackages={activePackages}
                  canRemove={rows.length > 1}
                  onChange={(patch) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)))}
                  onRemove={() => setRows(rows.filter((_, j) => j !== i))}
                />
              ))}
            </div>
            <button
              type="button"
              onClick={addServiceRow}
              className="mt-2 text-sm font-medium text-indigo-600 hover:text-indigo-700"
            >
              + Add service
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Payment Method</label>
              <select
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              >
                <option value="cash">Cash</option>
                <option value="card">Card</option>
                <option value="paynow">PayNow</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div className="flex items-end">
              <div className="w-full rounded-lg bg-gray-50 border border-gray-200 px-3 py-2 text-sm">
                <span className="text-gray-500">Total: </span>
                <span className="font-semibold text-gray-900">S${totalPrice.toFixed(2)}</span>
              </div>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Notes (optional)</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm resize-none"
              placeholder="Any special requests..."
            />
          </div>

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
