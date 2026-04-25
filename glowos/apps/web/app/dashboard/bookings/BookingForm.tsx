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
  DayBooking,
} from './types';
import { ServiceRow } from './ServiceRow';
import { EditHistoryPanel } from './EditHistoryPanel';
import { NoShowChip } from '../components/NoShowChip';

export interface BookingFormProps {
  mode: 'create' | 'edit';
  // Walk-in = someone here right now. Pre-book = future appointment (e.g.
  // client schedules their next visit after their current treatment).
  // Same endpoints + same form shape — we only tweak the title and the
  // default start time so the merchant's muscle memory doesn't fight them.
  intent?: 'walkin' | 'prebook';
  bookingId?: string;
  groupId?: string;
  services?: ServiceOption[];
  staffList?: StaffOption[];
  operatingHours?: Record<string, { open: string; close: string; closed: boolean }> | null;
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
  const [clientNoShowCount, setClientNoShowCount] = useState(0);
  const [clientPhone, setClientPhone] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [notes, setNotes] = useState('');
  const [services, setServices] = useState<ServiceOption[]>(props.services ?? []);
  const [staffList, setStaffList] = useState<StaffOption[]>(props.staffList ?? []);

  // Sync props → state whenever the parent's services/staffList arrive or
  // change. useState only consumes the initial prop at mount, which was
  // the underlying reason the pre-book dialog often opened with an empty
  // service list: the dashboard's fetch resolved after the form had
  // already snapshotted an empty props array. Edit mode overwrites these
  // from /edit-context so skip the sync there.
  useEffect(() => {
    if (mode === 'edit') return;
    if (props.services && props.services.length > 0) {
      setServices(props.services);
    }
    if (props.staffList && props.staffList.length > 0) {
      setStaffList(props.staffList);
    }
  }, [mode, props.services, props.staffList]);
  const [activePackages, setActivePackages] = useState<ActivePackage[]>([]);
  const [rows, setRows] = useState<ServiceRowState[]>([]);
  const [dayBookings, setDayBookings] = useState<DayBooking[]>([]);
  const [completedBanner, setCompletedBanner] = useState(false);
  const [lastEditLabel, setLastEditLabel] = useState<string | null>(null);
  const [packageTemplates, setPackageTemplates] = useState<
    Array<{
      id: string;
      name: string;
      priceSgd: string;
      isActive: boolean;
      includedServices: Array<{ serviceId: string; serviceName: string; quantity: number }>;
    }>
  >([]);
  const [sellPackageId, setSellPackageId] = useState<string>('');
  const [soldByStaffId, setSoldByStaffId] = useState<string>('');
  const [sellOpen, setSellOpen] = useState(false);

  useEffect(() => {
    if (mode !== 'edit' || !props.bookingId) {
      const token = localStorage.getItem('access_token');
      apiFetch('/merchant/packages', { headers: { Authorization: `Bearer ${token}` } })
        .then((data) => {
          const res = data as {
            packages: Array<{
              id: string;
              name: string;
              priceSgd: string;
              isActive: boolean;
              includedServices: Array<{ serviceId: string; serviceName: string; quantity: number }>;
            }>;
          };
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, props.bookingId, router]);

  // Seed a default service row as soon as services + staff are both available.
  // Runs on mount AND whenever services/staffList arrive async after mount —
  // previously the row was only set if both were ready at the very first
  // render, which broke the pre-book dialog (and walk-in under slow network).
  useEffect(() => {
    if (mode === 'edit') return;
    if (rows.length > 0) return;
    if (!services[0] || !staffList[0]) return;
    setRows([defaultRow(services[0], staffList[0])]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, services, staffList, rows.length]);

  function defaultRow(svc: ServiceOption, st: StaffOption): ServiceRowState {
    // Walk-in: default to "now" (someone standing at the counter).
    // Pre-book: default to same time tomorrow at the top of the hour
    // so the merchant just adjusts from there instead of paging back
    // from today's date.
    const anchor = new Date();
    if (props.intent === 'prebook') {
      anchor.setDate(anchor.getDate() + 1);
      anchor.setMinutes(0, 0, 0);
    }
    return {
      serviceId: svc.id,
      staffId: st.id,
      startTime: anchor.toISOString(),
      priceSgd: svc.priceSgd,
      priceTouched: false,
    };
  }

  const totalPrice = rows.reduce((s, r) => s + Number(r.priceSgd || 0), 0);
  const scheduleOverlaps = findScheduleOverlaps(rows, services);
  const focusDate = rows[0]?.startTime ? isoDateOnly(rows[0].startTime) : null;
  const ownBookingIds = new Set(
    rows.map((r) => r.bookingId).filter((id): id is string => Boolean(id))
  );
  const sellPackageTemplate = sellPackageId
    ? packageTemplates.find((p) => p.id === sellPackageId) ?? null
    : null;

  function newPackageUsedFor(serviceId: string, excludeIndex: number): number {
    return rows.reduce(
      (count, r, j) =>
        count + (j !== excludeIndex && r.useNewPackage && r.serviceId === serviceId ? 1 : 0),
      0
    );
  }

  function clearNewPackageRedemptions() {
    setRows((prev) =>
      prev.map((r) => {
        if (!r.useNewPackage) return r;
        const svc = services.find((s) => s.id === r.serviceId);
        return {
          ...r,
          useNewPackage: false,
          priceSgd: svc?.priceSgd ?? r.priceSgd,
          priceTouched: false,
        };
      })
    );
  }

  useEffect(() => {
    if (!focusDate) return;
    const token = localStorage.getItem('access_token');
    let cancelled = false;
    apiFetch(`/merchant/bookings?date=${focusDate}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((data) => {
        if (cancelled) return;
        const rows = (data as { bookings: Array<{ booking: DayBooking; staffMember: { id: string } }> }).bookings ?? [];
        setDayBookings(
          rows.map((r) => ({
            id: r.booking.id,
            staffId: r.staffMember.id,
            startTime: r.booking.startTime,
            endTime: r.booking.endTime,
            status: r.booking.status,
          }))
        );
      })
      .catch(() => {
        /* non-critical — availability hints just won't render */
      });
    return () => {
      cancelled = true;
    };
  }, [focusDate]);

  function addServiceRow() {
    const prev = rows[rows.length - 1];
    const defaultSvc = services[0];
    const defaultStaff = staffList[0];
    if (!defaultSvc || !defaultStaff) return;
    const prevSvc = prev ? services.find((s) => s.id === prev.serviceId) : undefined;
    const offsetMinutes = (prevSvc?.durationMinutes ?? 30) + (prevSvc?.bufferMinutes ?? 0);
    const anchor = prev
      ? new Date(new Date(prev.startTime).getTime() + offsetMinutes * 60_000).toISOString()
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
    if (mode !== 'create' || clientPhone.trim().length < 6) {
      setClientNoShowCount(0);
      return;
    }
    const token = localStorage.getItem('access_token');
    try {
      const res = (await apiFetch(
        `/merchant/clients/lookup?phone=${encodeURIComponent(clientPhone)}`,
        { headers: { Authorization: `Bearer ${token}` } }
      )) as {
        client: { id: string; name: string | null; noShowCount?: number } | null;
        activePackages: ActivePackage[];
      };
      if (res.client && !clientName) setClientName(res.client.name ?? '');
      setClientNoShowCount(res.client?.noShowCount ?? 0);
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
    if (sellPackageId && !soldByStaffId) {
      setApiError('Pick who sold the package');
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
            // Pre-bookings should land as 'pending' so the customer gets the
            // confirm-reminder cascade; walk-ins land as 'confirmed' since
            // the customer is physically present at the counter.
            intent: props.intent ?? 'walkin',
            services: rows.map((r) => ({
              service_id: r.serviceId,
              staff_id: r.staffId,
              start_time: r.startTime,
              price_sgd: r.priceTouched ? Number(r.priceSgd) : undefined,
              use_package: r.usePackage
                ? { client_package_id: r.usePackage.clientPackageId, session_id: r.usePackage.sessionId }
                : undefined,
              use_new_package: r.useNewPackage ? true : undefined,
            })),
            sell_package: sellPackageId
              ? { package_id: sellPackageId, sold_by_staff_id: soldByStaffId }
              : undefined,
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
        <div className="relative bg-tone-surface rounded-2xl p-6 z-10">Loading…</div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <div className="fixed inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-tone-surface rounded-2xl shadow-2xl w-full max-w-2xl p-6 z-10 max-h-[90vh] overflow-y-auto">
        <h2 className="text-lg font-bold text-tone-ink mb-1">
          {mode === 'create'
            ? props.intent === 'prebook'
              ? 'Schedule Future Appointment'
              : 'Add Walk-in Booking'
            : 'Edit Booking'}
        </h2>
        {lastEditLabel && <p className="text-xs text-grey-60 mb-3">{lastEditLabel}</p>}
        {mode === 'edit' && props.bookingId && <EditHistoryPanel bookingId={props.bookingId} />}
        {completedBanner && (
          <div className="mb-4 rounded-lg bg-semantic-warn/5 border border-semantic-warn/30 px-4 py-2 text-xs text-semantic-warn">
            This booking is completed. Edits will not re-send review requests or recalculate commissions.
          </div>
        )}
        {apiError && (
          <div className="mb-4 rounded-lg bg-semantic-danger/5 border border-semantic-danger/30 px-4 py-3 text-sm text-semantic-danger">
            {apiError}
          </div>
        )}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-grey-75 mb-1">Client Name</label>
              <input
                type="text"
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
                className="w-full rounded-lg border border-grey-30 px-3 py-2 text-sm"
                placeholder="Jane Doe"
                disabled={mode === 'edit'}
              />
              {clientNoShowCount > 0 && (
                <div className="mt-1">
                  <NoShowChip count={clientNoShowCount} />
                </div>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-grey-75 mb-1">Phone</label>
              <input
                type="tel"
                value={clientPhone}
                onChange={(e) => setClientPhone(e.target.value)}
                onBlur={() => void maybeLookupClient()}
                className="w-full rounded-lg border border-grey-30 px-3 py-2 text-sm"
                placeholder="+65 9123 4567"
                disabled={mode === 'edit'}
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-grey-75 mb-2">Services</label>
            {sellPackageTemplate && (
              <div className="mb-2 rounded-lg bg-tone-sage/5 border border-tone-sage/30 px-3 py-2 text-xs text-tone-sage">
                <p className="font-semibold mb-1">
                  Selling {sellPackageTemplate.name} (S${sellPackageTemplate.priceSgd}):
                </p>
                <ul className="space-y-0.5">
                  {sellPackageTemplate.includedServices.map((s) => {
                    const used = rows.filter(
                      (r) => r.useNewPackage && r.serviceId === s.serviceId
                    ).length;
                    const remaining = s.quantity - used;
                    return (
                      <li key={s.serviceId}>
                        · {s.serviceName} — {used} of {s.quantity} to redeem today, {remaining} remaining
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
            <div className="space-y-2">
              {rows.map((row, i) => (
                <ServiceRow
                  key={row.bookingId ?? `new-${i}`}
                  row={row}
                  services={services}
                  staff={staffList}
                  operatingHours={props.operatingHours ?? null}
                  activePackages={activePackages}
                  dayBookings={dayBookings}
                  ownBookingIds={ownBookingIds}
                  canRemove={rows.length > 1}
                  sellPackageTemplate={mode === 'create' ? sellPackageTemplate : null}
                  newPackageUsedForService={newPackageUsedFor(row.serviceId, i)}
                  onChange={(patch) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)))}
                  onRemove={() => setRows(rows.filter((_, j) => j !== i))}
                />
              ))}
            </div>
            <button
              type="button"
              onClick={addServiceRow}
              className="mt-2 text-sm font-medium text-tone-sage hover:text-tone-sage"
            >
              + Add service
            </button>
            {scheduleOverlaps.length > 0 && (
              <div className="mt-2 rounded-lg bg-semantic-warn/5 border border-semantic-warn/30 px-3 py-2 text-xs text-semantic-warn">
                <p className="font-medium mb-0.5">Heads-up: overlapping times</p>
                <ul className="list-disc pl-4 space-y-0.5">
                  {scheduleOverlaps.map((o) => (
                    <li key={`${o.a}-${o.b}`}>
                      Service {o.a + 1} ({o.aRange}) overlaps Service {o.b + 1} ({o.bRange})
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {mode === 'create' && packageTemplates.length > 0 && (
            <div className="rounded-lg border border-dashed border-grey-30 px-3 py-2">
              <button
                type="button"
                onClick={() => {
                  if (sellOpen) {
                    // Closing the disclosure: drop any selected package and
                    // reset rows that were flagged as redemptions from it.
                    setSellPackageId('');
                    clearNewPackageRedemptions();
                  }
                  setSellOpen(!sellOpen);
                }}
                className="text-sm font-medium text-tone-sage"
              >
                {sellOpen ? "− Don't sell a package" : '+ Also sell a package'}
              </button>
              {sellOpen && (
                <div className="mt-2">
                  <select
                    value={sellPackageId}
                    onChange={(e) => {
                      // Any existing row redemptions referenced the prior
                      // package's capacity — clear them before switching.
                      clearNewPackageRedemptions();
                      setSellPackageId(e.target.value);
                      if (e.target.value && !soldByStaffId) {
                        setSoldByStaffId(rows[0]?.staffId ?? '');
                      }
                      if (!e.target.value) {
                        setSoldByStaffId('');
                      }
                    }}
                    className="w-full rounded-lg border border-grey-30 px-3 py-2 text-sm"
                  >
                    <option value="">Select package to sell...</option>
                    {packageTemplates.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} (S${p.priceSgd})
                      </option>
                    ))}
                  </select>
                  {sellPackageId && (
                    <div className="mt-2">
                      <label className="block text-xs font-medium text-grey-75 mb-1">Sold by</label>
                      <select
                        value={soldByStaffId}
                        onChange={(e) => setSoldByStaffId(e.target.value)}
                        className="w-full rounded-lg border border-grey-30 px-3 py-2 text-sm"
                        required
                      >
                        <option value="">Select staff...</option>
                        {staffList.map((s) => (
                          <option key={s.id} value={s.id}>{s.name}</option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-grey-75 mb-1">Payment Method</label>
              <select
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
                className="w-full rounded-lg border border-grey-30 px-3 py-2 text-sm"
              >
                <option value="cash">Cash</option>
                <option value="card">Card</option>
                <option value="paynow">PayNow</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div className="flex items-end">
              <div className="w-full rounded-lg bg-grey-5 border border-grey-15 px-3 py-2 text-sm">
                {sellPackageTemplate ? (
                  <>
                    <div className="flex justify-between text-xs text-grey-75">
                      <span>Services:</span>
                      <span>S${totalPrice.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between text-xs text-grey-75">
                      <span>Package:</span>
                      <span>S${Number(sellPackageTemplate.priceSgd).toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between font-semibold text-tone-ink border-t border-grey-15 mt-1 pt-1">
                      <span>Total:</span>
                      <span>S${(totalPrice + Number(sellPackageTemplate.priceSgd)).toFixed(2)}</span>
                    </div>
                  </>
                ) : (
                  <>
                    <span className="text-grey-60">Total: </span>
                    <span className="font-semibold text-tone-ink">S${totalPrice.toFixed(2)}</span>
                  </>
                )}
              </div>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-grey-75 mb-1">Notes (optional)</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="w-full rounded-lg border border-grey-30 px-3 py-2 text-sm resize-none"
              placeholder="Any special requests..."
            />
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-xl border border-grey-30 py-2.5 text-sm font-medium text-grey-75 hover:bg-grey-5"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 rounded-xl bg-tone-ink py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-60"
            >
              {saving ? 'Saving…' : mode === 'create' ? 'Create Booking' : 'Save changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

interface OverlapPair {
  a: number;
  b: number;
  aRange: string;
  bRange: string;
}

function findScheduleOverlaps(
  rows: ServiceRowState[],
  services: ServiceOption[]
): OverlapPair[] {
  const intervals = rows.map((r) => {
    const svc = services.find((s) => s.id === r.serviceId);
    if (!svc || !r.startTime) return null;
    const start = new Date(r.startTime).getTime();
    if (Number.isNaN(start)) return null;
    const end = start + (svc.durationMinutes + svc.bufferMinutes) * 60_000;
    return { start, end };
  });

  const overlaps: OverlapPair[] = [];
  for (let a = 0; a < intervals.length; a++) {
    const x = intervals[a];
    if (!x) continue;
    for (let b = a + 1; b < intervals.length; b++) {
      const y = intervals[b];
      if (!y) continue;
      if (x.start < y.end && y.start < x.end) {
        overlaps.push({
          a,
          b,
          aRange: `${fmtTime(x.start)}–${fmtTime(x.end)}`,
          bRange: `${fmtTime(y.start)}–${fmtTime(y.end)}`,
        });
      }
    }
  }
  return overlaps;
}

function fmtTime(ms: number): string {
  return new Date(ms).toLocaleTimeString('en-SG', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

function isoDateOnly(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
