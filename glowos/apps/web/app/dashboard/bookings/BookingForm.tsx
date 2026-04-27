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
  BookingStatus,
} from './types';
import { ServiceRow } from './ServiceRow';
import { EditHistoryPanel } from './EditHistoryPanel';
import { NoShowChip } from '../components/NoShowChip';
import { PhoneInput } from '../../components/PhoneInput';

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
  /**
   * When opening from a known-client surface (e.g. client profile drawer),
   * pre-fill the client name and phone, and lock the fields so the merchant
   * can't accidentally re-book against a different client.
   */
  prefilledClient?: { name: string; phone: string };
  onClose: () => void;
  /**
   * Called after a successful save. In create mode, receives the id of the
   * first booking created — surfaces enough info for the parent to chain
   * into edit mode (e.g. so the staff can immediately apply loyalty points,
   * which is only possible against an existing booking row).
   */
  onSave: (createdBookingId?: string) => void;
  /**
   * Optional toast emitter wired by the parent (e.g. the calendar page) so
   * the reschedule sub-modal can surface success/error feedback in the
   * parent's existing toast stack instead of a nested transient.
   */
  showToast?: (message: string, type: 'success' | 'error') => void;
}

interface NotificationLogRow {
  id: string;
  type: string;
  channel: string;
  recipient: string | null;
  status: string;
  twilioSid: string | null;
  messageBody: string | null;
  createdAt: string;
}

export function BookingForm(props: BookingFormProps) {
  const { mode, onClose, onSave } = props;
  const router = useRouter();

  const [loading, setLoading] = useState(mode === 'edit');
  const [saving, setSaving] = useState(false);
  const [resolvedGroupId, setResolvedGroupId] = useState<string | null>(props.groupId ?? null);
  const [apiError, setApiError] = useState('');
  const [clientName, setClientName] = useState(props.prefilledClient?.name ?? '');
  const [clientNoShowCount, setClientNoShowCount] = useState(0);
  const [clientPhone, setClientPhone] = useState(props.prefilledClient?.phone ?? '');
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

  // Defensive fallback — if the parent didn't pass services/staff (or passed
  // empty arrays and never updated), fetch them ourselves. Covers the case
  // where the parent's fetch failed silently or the form was mounted from a
  // different surface that doesn't pre-load.
  useEffect(() => {
    if (mode === 'edit') return;
    if (services.length > 0 && staffList.length > 0) return;
    const token = localStorage.getItem('access_token');
    if (!token) return;
    let cancelled = false;
    Promise.all([
      services.length === 0
        ? apiFetch('/merchant/services', { headers: { Authorization: `Bearer ${token}` } }) as Promise<{ services: ServiceOption[] }>
        : Promise.resolve(null),
      staffList.length === 0
        ? apiFetch('/merchant/staff', { headers: { Authorization: `Bearer ${token}` } }) as Promise<{ staff: Array<{ id: string; name: string; service_ids?: string[] }> }>
        : Promise.resolve(null),
    ])
      .then(([svcRes, staffRes]) => {
        if (cancelled) return;
        if (svcRes && svcRes.services && svcRes.services.length > 0) {
          setServices(svcRes.services);
        }
        if (staffRes && staffRes.staff && staffRes.staff.length > 0) {
          // /merchant/staff returns snake_case service_ids; normalise to camelCase
          // so ServiceRow can filter the per-service staff dropdown.
          setStaffList(
            staffRes.staff.map((s) => ({
              id: s.id,
              name: s.name,
              serviceIds: s.service_ids ?? [],
            }))
          );
        }
      })
      .catch(() => { /* surfaces below via the empty-state guard */ });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);
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

  // ── Loyalty redemption state (edit mode only) ──────────────────────────────
  const [bookingStatus, setBookingStatus] = useState<BookingStatus | null>(null);
  const [profileId, setProfileId] = useState<string | null>(null);
  const [loyaltyBalance, setLoyaltyBalance] = useState<number | null>(null);
  const [loyaltyProgram, setLoyaltyProgram] = useState<{
    enabled: boolean;
    pointsPerDollarRedeem: number;
    minRedeemPoints: number;
  } | null>(null);
  const [pointsToRedeem, setPointsToRedeem] = useState<string>('');
  const [redemption, setRedemption] = useState<{ points: number; sgd: string } | null>(null);
  const [loyaltyBusy, setLoyaltyBusy] = useState(false);
  const [loyaltyError, setLoyaltyError] = useState<string | null>(null);

  // ── Reschedule sub-modal state (edit mode, reschedulable statuses only) ────
  // The button is rendered alongside Save inside the edit-mode form; clicking
  // it pre-fills the date/time inputs from the loaded booking's current start
  // (rows[0].startTime) so the operator sees what they're moving FROM.
  const [showRescheduleModal, setShowRescheduleModal] = useState(false);
  const [rescheduleDate, setRescheduleDate] = useState('');
  const [rescheduleTime, setRescheduleTime] = useState('');
  const [rescheduleNotify, setRescheduleNotify] = useState(true);
  const [rescheduleSubmitting, setRescheduleSubmitting] = useState(false);

  // ── Notifications panel state (edit mode) ────────────────────────────────────
  // Loads on open; renders the per-booking notification_log so admin can see
  // exactly which messages went out, when, and (if any failed) why.
  const [notifications, setNotifications] = useState<NotificationLogRow[]>([]);
  const [notificationsLoading, setNotificationsLoading] = useState(false);

  useEffect(() => {
    if (mode !== 'edit' || !props.bookingId) return;
    setNotificationsLoading(true);
    apiFetch(`/merchant/bookings/${props.bookingId}/notifications`)
      .then((d) => setNotifications((d as { notifications?: NotificationLogRow[] }).notifications ?? []))
      .catch(() => { /* non-fatal — panel just shows empty */ })
      .finally(() => setNotificationsLoading(false));
  }, [mode, props.bookingId]);

  // ── Reschedule notification status polling ───────────────────────────────────
  // After a successful PATCH /reschedule with notify_client=true, the worker
  // will create rows in notification_log within ~1-3s. We poll the new
  // /:id/notifications endpoint to confirm the messages actually went out and
  // surface a follow-up toast that replaces the optimistic "Sending…" one.
  async function pollReschedNotificationStatus(
    bookingId: string,
    sentAfter: Date,
    clientNameForToast: string,
  ) {
    for (let i = 0; i < 8; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      try {
        const data = (await apiFetch(`/merchant/bookings/${bookingId}/notifications`)) as {
          notifications: Array<{ type: string; channel: string; status: string; createdAt: string }>;
        };
        const recent = (data.notifications ?? []).filter(
          (n) => n.type === 'reschedule_confirmation' && new Date(n.createdAt) >= sentAfter,
        );
        if (recent.length > 0) {
          const channels = recent.map((r) => `${r.channel}: ${r.status}`).join(', ');
          const allSent = recent.every((r) => r.status === 'sent');
          props.showToast?.(
            allSent
              ? `✓ Notification delivered to ${clientNameForToast} (${channels})`
              : `⚠ Notification status — ${channels}`,
            allSent ? 'success' : 'error',
          );
          return;
        }
      } catch {
        // ignore poll errors, keep retrying
      }
    }
    props.showToast?.('Notification status pending — check the booking detail panel.', 'success');
  }

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
        setClientName(ctx.client?.name ?? '');
        setClientPhone(ctx.client?.phone ?? '');
        setProfileId(ctx.client?.profileId ?? null);
        setBookingStatus(ctx.booking.status);
        setPaymentMethod((ctx.group?.paymentMethod ?? 'cash') as PaymentMethod);
        setNotes(ctx.group?.notes ?? ctx.booking.clientNotes ?? '');
        setCompletedBanner(ctx.booking.status === 'completed');
        const redeemedPts = ctx.booking.loyaltyPointsRedeemed ?? 0;
        if (redeemedPts > 0) {
          setRedemption({ points: redeemedPts, sgd: ctx.booking.discountSgd ?? '0' });
        } else {
          setRedemption(null);
        }
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

  // Fetch loyalty balance + program once we have a profileId (edit mode).
  useEffect(() => {
    if (mode !== 'edit' || !profileId) return;
    let cancelled = false;
    apiFetch(`/merchant/clients/${profileId}/loyalty`)
      .then((data) => {
        if (cancelled) return;
        const res = data as {
          balance: number;
          program: {
            enabled: boolean;
            pointsPerDollarRedeem: number;
            minRedeemPoints: number;
          };
        };
        setLoyaltyBalance(res.balance);
        setLoyaltyProgram({
          enabled: res.program.enabled,
          pointsPerDollarRedeem: res.program.pointsPerDollarRedeem,
          minRedeemPoints: res.program.minRedeemPoints,
        });
      })
      .catch(() => {
        // silent — loyalty section just won't render
      });
    return () => {
      cancelled = true;
    };
  }, [mode, profileId]);

  // ── Loyalty redemption helpers ─────────────────────────────────────────────
  const maxRedeemablePoints = (() => {
    if (!loyaltyProgram || loyaltyBalance == null) return 0;
    const cappedBySgd = Math.floor(totalPrice * loyaltyProgram.pointsPerDollarRedeem);
    return Math.max(0, Math.min(loyaltyBalance, cappedBySgd));
  })();

  const parsedPointsToRedeem = Number(pointsToRedeem || 0);
  const pointsToRedeemSgd =
    loyaltyProgram && parsedPointsToRedeem > 0
      ? (parsedPointsToRedeem / loyaltyProgram.pointsPerDollarRedeem).toFixed(2)
      : '0.00';

  const loyaltyDiscountReadOnly =
    bookingStatus === 'completed' || bookingStatus === 'cancelled' || bookingStatus === 'no_show';

  // Redemption is only available once the client is here for treatment —
  // i.e. the booking has been confirmed by the customer or checked in by
  // staff. For pending pre-bookings we wait, because (a) the balance may
  // still grow before the visit, (b) cancelled appointments shouldn't
  // require unwinding a redemption, and (c) the till is the natural moment
  // to apply discounts.
  const loyaltyApplyAvailable =
    bookingStatus === 'confirmed' || bookingStatus === 'in_progress';

  async function handleApplyRedemption() {
    if (!props.bookingId || !loyaltyProgram) return;
    setLoyaltyError(null);
    if (parsedPointsToRedeem < loyaltyProgram.minRedeemPoints) {
      setLoyaltyError(`Minimum redemption is ${loyaltyProgram.minRedeemPoints} points`);
      return;
    }
    if (parsedPointsToRedeem > maxRedeemablePoints) {
      setLoyaltyError(
        `Cannot redeem more than ${maxRedeemablePoints} points (capped by booking total)`,
      );
      return;
    }
    setLoyaltyBusy(true);
    try {
      const res = (await apiFetch(
        `/merchant/bookings/${props.bookingId}/apply-loyalty-redemption`,
        {
          method: 'POST',
          body: JSON.stringify({ points: parsedPointsToRedeem }),
        },
      )) as {
        booking: { discountSgd: string; loyaltyPointsRedeemed: number };
        newBalance: number;
      };
      setRedemption({
        points: res.booking.loyaltyPointsRedeemed,
        sgd: res.booking.discountSgd,
      });
      setLoyaltyBalance(res.newBalance);
      setPointsToRedeem('');
    } catch (err) {
      setLoyaltyError(err instanceof Error ? err.message : 'Failed to apply');
    } finally {
      setLoyaltyBusy(false);
    }
  }

  async function handleRemoveRedemption() {
    if (!props.bookingId) return;
    setLoyaltyError(null);
    setLoyaltyBusy(true);
    try {
      const res = (await apiFetch(
        `/merchant/bookings/${props.bookingId}/remove-loyalty-redemption`,
        { method: 'POST' },
      )) as { newBalance: number };
      setRedemption(null);
      setLoyaltyBalance(res.newBalance);
    } catch (err) {
      setLoyaltyError(err instanceof Error ? err.message : 'Failed to remove');
    } finally {
      setLoyaltyBusy(false);
    }
  }

  function addServiceRow() {
    const prev = rows[rows.length - 1];
    const defaultSvc = services[0];
    const defaultStaff = staffList[0];
    if (!defaultSvc || !defaultStaff) {
      setApiError(
        services.length === 0
          ? 'No services configured for this merchant yet. Add a service in Services first.'
          : staffList.length === 0
            ? 'No staff configured for this merchant yet. Add a staff member first.'
            : 'Could not load services. Try closing this and reopening.',
      );
      return;
    }
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

  // Debounced lookup as the staff types/picks a country code. PhoneInput emits
  // E.164 (e.g. "+6591234567"); the API normalizes both sides via libphonenumber
  // so SG/MY/ID/etc. all match against existing clients.phone.
  useEffect(() => {
    if (mode !== 'create') return;
    if (clientPhone.trim().length < 8) {
      setClientNoShowCount(0);
      return;
    }
    const handle = setTimeout(() => {
      void (async () => {
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
      })();
    }, 300);
    return () => clearTimeout(handle);
    // clientName intentionally excluded to avoid re-trigger after auto-fill.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientPhone, mode]);

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

    // Block out-of-hours bookings for non-owners. The owner can still
    // override (the operating-hours warning beneath each row remains
    // visible for them) — sometimes a clinic genuinely runs an after-
    // hours appointment and only the boss should authorise it.
    const role = (() => {
      try {
        return (JSON.parse(localStorage.getItem('user') ?? '{}').role ?? null) as
          | 'owner' | 'manager' | 'clinician' | 'staff' | null;
      } catch {
        return null;
      }
    })();
    if (role !== 'owner' && props.operatingHours) {
      const offending = rows
        .map((r, i) => ({ row: r, index: i, violation: outsideHoursViolation(r.startTime, props.operatingHours!) }))
        .filter((v) => v.violation !== null);
      if (offending.length > 0) {
        const first = offending[0];
        setApiError(
          first.violation === 'closed'
            ? `Service ${first.index + 1} falls on a day the merchant is closed. Only the owner can book outside operating hours.`
            : `Service ${first.index + 1} is outside operating hours. Only the owner can book outside operating hours.`,
        );
        return;
      }
    }

    const token = localStorage.getItem('access_token');
    setSaving(true);
    try {
      if (mode === 'create') {
        const resp = (await apiFetch('/merchant/bookings/group', {
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
        })) as { bookings?: Array<{ id: string }> };
        // First booking is the canonical anchor for chained UX (e.g. apply
        // loyalty points immediately after creating a future appointment).
        onSave(resp.bookings?.[0]?.id);
        return;
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
                disabled={mode === 'edit' || !!props.prefilledClient}
              />
              {clientNoShowCount > 0 && (
                <div className="mt-1">
                  <NoShowChip count={clientNoShowCount} />
                </div>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-grey-75 mb-1">Phone</label>
              <PhoneInput
                value={clientPhone}
                onChange={setClientPhone}
                disabled={mode === 'edit' || !!props.prefilledClient}
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

          {mode === 'edit' && loyaltyProgram?.enabled && (
            <LoyaltySection
              balance={loyaltyBalance ?? 0}
              program={loyaltyProgram}
              redemption={redemption}
              maxRedeemable={maxRedeemablePoints}
              points={pointsToRedeem}
              onPointsChange={setPointsToRedeem}
              pointsSgd={pointsToRedeemSgd}
              onApply={handleApplyRedemption}
              onRemove={handleRemoveRedemption}
              busy={loyaltyBusy}
              error={loyaltyError}
              readOnly={loyaltyDiscountReadOnly}
              applyAvailable={loyaltyApplyAvailable}
            />
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
                    {redemption && (
                      <div className="flex justify-between text-xs text-tone-sage">
                        <span>Loyalty discount:</span>
                        <span>−S${Number(redemption.sgd).toFixed(2)}</span>
                      </div>
                    )}
                    <div className="flex justify-between font-semibold text-tone-ink border-t border-grey-15 mt-1 pt-1">
                      <span>Total:</span>
                      <span>
                        S$
                        {(
                          totalPrice +
                          Number(sellPackageTemplate.priceSgd) -
                          Number(redemption?.sgd ?? 0)
                        ).toFixed(2)}
                      </span>
                    </div>
                  </>
                ) : redemption ? (
                  <>
                    <div className="flex justify-between text-xs text-grey-75">
                      <span>Subtotal:</span>
                      <span>S${totalPrice.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between text-xs text-tone-sage">
                      <span>Loyalty discount:</span>
                      <span>−S${Number(redemption.sgd).toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between font-semibold text-tone-ink border-t border-grey-15 mt-1 pt-1">
                      <span>Total:</span>
                      <span>
                        S${(totalPrice - Number(redemption.sgd)).toFixed(2)}
                      </span>
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

          <div className="flex flex-wrap gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 min-w-[120px] rounded-xl border border-grey-30 py-2.5 text-sm font-medium text-grey-75 hover:bg-grey-5"
            >
              Cancel
            </button>
            {mode === 'edit' && (bookingStatus === 'confirmed' || bookingStatus === 'in_progress') && (
              <button
                type="button"
                onClick={() => {
                  // Pre-populate fields from the loaded booking's current
                  // start time (sourced from rows[0].startTime, which is
                  // hydrated from /edit-context's ctx.booking.startTime).
                  const startIso = rows[0]?.startTime;
                  if (!startIso) return;
                  const start = new Date(startIso);
                  if (Number.isNaN(start.getTime())) return;
                  const yyyy = start.getFullYear();
                  const mm = String(start.getMonth() + 1).padStart(2, '0');
                  const dd = String(start.getDate()).padStart(2, '0');
                  const hh = String(start.getHours()).padStart(2, '0');
                  const mi = String(start.getMinutes()).padStart(2, '0');
                  setRescheduleDate(`${yyyy}-${mm}-${dd}`);
                  setRescheduleTime(`${hh}:${mi}`);
                  setRescheduleNotify(true);
                  setShowRescheduleModal(true);
                }}
                className="flex-1 min-w-[120px] rounded-xl border border-tone-sage/40 py-2.5 text-sm font-medium text-tone-sage hover:bg-tone-sage/10"
              >
                Reschedule
              </button>
            )}
            <button
              type="submit"
              disabled={saving}
              className="flex-1 min-w-[120px] rounded-xl bg-tone-ink py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-60"
            >
              {saving ? 'Saving…' : mode === 'create' ? 'Create Booking' : 'Save changes'}
            </button>
          </div>
        </form>

        {mode === 'edit' && props.bookingId && (
          <div className="mt-6 border-t border-grey-15 pt-4">
            <h3 className="text-sm font-semibold text-tone-ink mb-3">Notifications</h3>
            {notificationsLoading ? (
              <p className="text-xs text-grey-60">Loading…</p>
            ) : notifications.length === 0 ? (
              <p className="text-xs text-grey-60">No notifications sent for this booking yet.</p>
            ) : (
              <ul className="space-y-2">
                {notifications.map((n) => (
                  <li key={n.id} className="flex items-start gap-3 text-xs">
                    <span
                      className={`mt-0.5 inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] ${
                        n.status === 'sent'
                          ? 'bg-tone-sage/20 text-tone-sage'
                          : 'bg-semantic-danger/15 text-semantic-danger'
                      }`}
                    >
                      {n.status === 'sent' ? '✓' : '!'}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-tone-ink">
                        {prettyNotificationType(n.type)} · {n.channel}
                      </p>
                      <p className="text-grey-60 truncate">
                        {n.recipient ?? '—'} ·{' '}
                        {new Date(n.createdAt).toLocaleString('en-GB', {
                          day: '2-digit',
                          month: 'short',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                        {n.status !== 'sent' ? ` · ${n.status}` : ''}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {showRescheduleModal && (
          <div className="fixed inset-0 bg-black/40 z-[60] flex items-center justify-center p-4">
            <div className="bg-tone-surface rounded-xl shadow-2xl w-full max-w-md p-6 space-y-4 font-manrope">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-semibold text-tone-ink">Reschedule appointment</h2>
                <button
                  type="button"
                  onClick={() => setShowRescheduleModal(false)}
                  disabled={rescheduleSubmitting}
                  className="text-grey-45 hover:text-grey-75 disabled:opacity-40"
                  aria-label="Close"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-grey-70 mb-1">Date</label>
                  <input
                    type="date"
                    value={rescheduleDate}
                    onChange={(e) => setRescheduleDate(e.target.value)}
                    disabled={rescheduleSubmitting}
                    className="w-full border border-grey-20 rounded-md px-3 py-2 text-sm text-tone-ink focus:outline-none focus:ring-2 focus:ring-tone-sage"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-grey-70 mb-1">Time</label>
                  <input
                    type="time"
                    value={rescheduleTime}
                    onChange={(e) => setRescheduleTime(e.target.value)}
                    disabled={rescheduleSubmitting}
                    step={900}
                    className="w-full border border-grey-20 rounded-md px-3 py-2 text-sm text-tone-ink focus:outline-none focus:ring-2 focus:ring-tone-sage"
                  />
                </div>
              </div>

              <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-grey-20 text-tone-ink focus:ring-tone-ink"
                  checked={rescheduleNotify}
                  onChange={(e) => setRescheduleNotify(e.target.checked)}
                  disabled={rescheduleSubmitting}
                />
                <span className="text-tone-ink">Notify client by WhatsApp + email</span>
              </label>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowRescheduleModal(false)}
                  disabled={rescheduleSubmitting}
                  className="px-4 py-2 rounded-lg border border-grey-20 text-tone-ink text-sm font-medium hover:bg-grey-5 disabled:opacity-40"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    if (!rescheduleDate || !rescheduleTime || !props.bookingId) return;
                    const newStart = new Date(`${rescheduleDate}T${rescheduleTime}:00`);
                    if (Number.isNaN(newStart.getTime())) {
                      props.showToast?.('Invalid date or time', 'error');
                      return;
                    }
                    setRescheduleSubmitting(true);
                    try {
                      await apiFetch(`/merchant/bookings/${props.bookingId}/reschedule`, {
                        method: 'PATCH',
                        body: JSON.stringify({
                          start_time: newStart.toISOString(),
                          notify_client: rescheduleNotify,
                        }),
                      });
                      const sentAfter = new Date();
                      if (rescheduleNotify) {
                        props.showToast?.('Rescheduled. Sending notification…', 'success');
                      } else {
                        props.showToast?.('Rescheduled. Client not notified.', 'success');
                      }
                      setShowRescheduleModal(false);
                      // onSave (rather than onClose) so the parent calendar
                      // reloads its data via its existing onSave handler.
                      onSave();
                      // Fire-and-forget: poll notification_log so the admin
                      // sees a follow-up toast confirming delivery (or a
                      // failure surface) without blocking modal close.
                      if (rescheduleNotify && props.bookingId) {
                        void pollReschedNotificationStatus(
                          props.bookingId,
                          sentAfter,
                          clientName || 'client',
                        );
                      }
                    } catch (err) {
                      props.showToast?.(
                        err instanceof Error ? err.message : 'Reschedule failed',
                        'error',
                      );
                    } finally {
                      setRescheduleSubmitting(false);
                    }
                  }}
                  disabled={rescheduleSubmitting || !rescheduleDate || !rescheduleTime}
                  className="px-4 py-2 rounded-lg bg-tone-ink text-tone-surface-warm text-sm font-medium hover:opacity-90 disabled:opacity-40"
                >
                  {rescheduleSubmitting ? 'Rescheduling…' : 'Confirm reschedule'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

interface LoyaltySectionProps {
  balance: number;
  program: { pointsPerDollarRedeem: number; minRedeemPoints: number };
  redemption: { points: number; sgd: string } | null;
  maxRedeemable: number;
  points: string;
  onPointsChange: (v: string) => void;
  pointsSgd: string;
  onApply: () => void;
  onRemove: () => void;
  busy: boolean;
  error: string | null;
  readOnly: boolean;
  /** Apply UI is hidden when false — used to defer redemption to check-in. */
  applyAvailable: boolean;
}

function LoyaltySection(props: LoyaltySectionProps) {
  const {
    balance,
    program,
    redemption,
    maxRedeemable,
    points,
    onPointsChange,
    pointsSgd,
    onApply,
    onRemove,
    busy,
    error,
    readOnly,
    applyAvailable,
  } = props;

  const balanceSgd = (balance / program.pointsPerDollarRedeem).toFixed(2);
  const canApply =
    applyAvailable &&
    !redemption &&
    balance >= program.minRedeemPoints &&
    maxRedeemable >= program.minRedeemPoints;

  return (
    <div className="rounded-lg border border-tone-sage/30 bg-tone-sage/5 px-3 py-2">
      <p className="text-xs font-semibold text-tone-sage mb-1">Loyalty points</p>
      {redemption ? (
        <div className="flex items-center justify-between text-sm">
          <span className="text-tone-ink">
            Loyalty discount: −S${Number(redemption.sgd).toFixed(2)} ({redemption.points} pts)
          </span>
          {!readOnly && (
            <button
              type="button"
              onClick={onRemove}
              disabled={busy}
              className="text-xs font-medium text-tone-sage hover:underline disabled:opacity-60"
            >
              Remove
            </button>
          )}
        </div>
      ) : (
        <>
          <p className="text-xs text-grey-75 mb-2">
            Balance: {balance} pts (S${balanceSgd} available)
          </p>
          {canApply && !readOnly ? (
            <div className="flex items-center gap-2">
              <input
                type="number"
                inputMode="numeric"
                min={program.minRedeemPoints}
                max={maxRedeemable}
                step={1}
                value={points}
                onChange={(e) => onPointsChange(e.target.value)}
                placeholder={`min ${program.minRedeemPoints}`}
                className="w-32 rounded-lg border border-grey-30 px-2 py-1.5 text-sm"
              />
              <span className="text-xs text-grey-60">
                = S${pointsSgd} (max {maxRedeemable} pts)
              </span>
              <button
                type="button"
                onClick={onApply}
                disabled={busy || Number(points || 0) <= 0}
                className="ml-auto rounded-lg bg-tone-sage px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-60"
              >
                Apply
              </button>
            </div>
          ) : (
            <p className="text-xs text-grey-60">
              {readOnly
                ? "Booking is finalised — discount can't be changed."
                : !applyAvailable
                  ? "Redemption opens at check-in. Confirm or check the client in to apply points before payment."
                  : balance < program.minRedeemPoints
                    ? `Below minimum of ${program.minRedeemPoints} pts.`
                    : 'Booking total is too low to redeem points.'}
            </p>
          )}
        </>
      )}
      {error && <p className="mt-1 text-xs text-semantic-danger">{error}</p>}
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

/**
 * Returns the kind of operating-hours violation at the given moment, or null
 * if it falls inside open hours. Used by the create-booking submit guard so
 * non-owners can't schedule treatments outside the merchant's stated window.
 */
function outsideHoursViolation(
  iso: string,
  operatingHours: Record<string, { open: string; close: string; closed: boolean }>,
): 'closed' | 'outside' | null {
  if (!iso) return null;
  let d: Date;
  try {
    d = new Date(iso);
  } catch {
    return null;
  }
  const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const dayKey = dayNames[d.getDay()];
  if (!dayKey) return null;
  const day = operatingHours[dayKey];
  if (!day) return null;
  if (day.closed) return 'closed';
  const [oh, om] = day.open.split(':').map((n) => parseInt(n, 10));
  const [ch, cm] = day.close.split(':').map((n) => parseInt(n, 10));
  if ([oh, om, ch, cm].some((n) => Number.isNaN(n))) return null;
  const open = oh * 60 + om;
  const close = ch * 60 + cm;
  const min = d.getHours() * 60 + d.getMinutes();
  if (min < open || min > close) return 'outside';
  return null;
}

function prettyNotificationType(t: string): string {
  switch (t) {
    case 'booking_confirmation':
      return 'Booking confirmation';
    case 'reschedule_confirmation':
      return 'Reschedule notification';
    case 'cancellation_notification':
      return 'Cancellation';
    case 'appointment_reminder':
      return 'Appointment reminder';
    case 'review_request':
      return 'Review request';
    case 'no_show_reengagement':
      return 'No-show re-engagement';
    case 'rebooking_prompt':
      return 'Rebooking prompt';
    case 'post_service_receipt':
      return 'Post-service receipt';
    default:
      return t;
  }
}
