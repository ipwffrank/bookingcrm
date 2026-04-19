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
import { EditHistoryPanel } from './EditHistoryPanel';

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
  const [resolvedGroupId, setResolvedGroupId] = useState<string | null>(props.groupId ?? null);
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
  const [packageTemplates, setPackageTemplates] = useState<Array<{ id: string; name: string; priceSgd: string; isActive: boolean }>>([]);
  const [sellPackageId, setSellPackageId] = useState<string>('');
  const [sellOpen, setSellOpen] = useState(false);

  useEffect(() => {
    if (mode !== 'edit' || !props.bookingId) {
      if (services[0] && staffList[0]) {
        setRows([defaultRow(services[0], staffList[0])]);
      }
      const token = localStorage.getItem('access_token');
      apiFetch('/merchant/packages', { headers: { Authorization: `Bearer ${token}` } })
        .then((data) => {
          const res = data as { packages: Array<{ id: string; name: string; priceSgd: string; isActive: boolean }> };
          setPackageTemplates(res.packages.filter((p) => p.isActive));
        })
        .catch(() => {}); // silent; feature is optional
      return;
    }
    const token = localStorage.getItem('access_token');
    apiFetch(`/merchant/bookings/${props.bookingId}/edit-context`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((data) => {
        const ctx = data as EditContextResponse;
        setServices(ctx.services);
        setResolvedGroupId(ctx.group?.id ?? null);
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
    setApiError('');
    if (!clientName.trim() || !clientPhone.trim()) {
      setApiError('Client name and phone are required');
      return;
    }
    if (rows.length === 0) {
      setApiError('At least one service is required');
      return;
    }
    if (rows.some((r) => !r.serviceId || !r.staffId || !r.startTime)) {
      setApiError('Each service needs a service, staff, and start time');
      return;
    }

    const token = localStorage.getItem('access_token');
    setSaving(true);
    try {
      if (mode === 'create') {
        await apiFetch('/merchant/bookings/group', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            client_name: clientName,
            client_phone: clientPhone,
            payment_method: paymentMethod,
            notes: notes || undefined,
            services: rows.map((r) => ({
              service_id: r.serviceId,
              staff_id: r.staffId,
              start_time: r.startTime,
              price_sgd: r.priceTouched ? Number(r.priceSgd) : undefined,
              use_package: r.usePackage
                ? { client_package_id: r.usePackage.clientPackageId, session_id: r.usePackage.sessionId }
                : undefined,
            })),
            sell_package: sellPackageId ? { package_id: sellPackageId } : undefined,
          }),
        });
      } else if (resolvedGroupId) {
        await apiFetch(`/merchant/bookings/group/${resolvedGroupId}`, {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            payment_method: paymentMethod,
            notes: notes || null,
            services: rows.map((r) => ({
              booking_id: r.bookingId,
              service_id: r.serviceId,
              staff_id: r.staffId,
              start_time: r.startTime,
              price_sgd: Number(r.priceSgd),
              use_package: r.usePackage
                ? { client_package_id: r.usePackage.clientPackageId, session_id: r.usePackage.sessionId }
                : undefined,
            })),
          }),
        });
      } else if (props.bookingId) {
        const r = rows[0];
        await apiFetch(`/merchant/bookings/${props.bookingId}`, {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            service_id: r.serviceId,
            staff_id: r.staffId,
            start_time: r.startTime,
            price_sgd: Number(r.priceSgd),
            payment_method: paymentMethod,
            client_notes: notes || null,
          }),
        });
      }
      onSave();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) router.push('/login');
      else setApiError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
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
        {mode === 'edit' && props.bookingId && <EditHistoryPanel bookingId={props.bookingId} />}
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

          {mode === 'create' && packageTemplates.length > 0 && (
            <div className="rounded-lg border border-dashed border-gray-300 px-3 py-2">
              <button
                type="button"
                onClick={() => setSellOpen(!sellOpen)}
                className="text-sm font-medium text-indigo-600"
              >
                {sellOpen ? "− Don't sell a package" : '+ Also sell a package'}
              </button>
              {sellOpen && (
                <div className="mt-2">
                  <select
                    value={sellPackageId}
                    onChange={(e) => setSellPackageId(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  >
                    <option value="">Select package to sell...</option>
                    {packageTemplates.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} (S${p.priceSgd})
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          )}

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
