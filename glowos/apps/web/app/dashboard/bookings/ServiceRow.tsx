'use client';

import type {
  ServiceOption,
  StaffOption,
  ServiceRowState,
  ActivePackage,
  DayBooking,
  SoldPackageTemplate,
} from './types';

export interface ServiceRowProps {
  row: ServiceRowState;
  services: ServiceOption[];
  staff: StaffOption[];
  operatingHours?: Record<string, { open: string; close: string; closed: boolean }> | null;
  activePackages: ActivePackage[];
  dayBookings: DayBooking[];
  ownBookingIds: Set<string>;
  canRemove: boolean;
  sellPackageTemplate: SoldPackageTemplate | null;
  newPackageUsedForService: number;
  onChange: (patch: Partial<ServiceRowState>) => void;
  onRemove: () => void;
  error?: string;
}

// Heuristic: a staff is the "Any Available" placeholder if the merchant
// literally named them that. Skip per-staff busy computation on that row
// because it represents a bucket, not a person — any booked time shown
// there is noise and confuses the merchant.
function isAnyAvailablePlaceholder(name: string): boolean {
  return name.trim().toLowerCase() === 'any available';
}

function dayOfWeekKey(iso: string): string | null {
  if (!iso) return null;
  try {
    const names = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    return names[new Date(iso).getDay()] ?? null;
  } catch {
    return null;
  }
}

export function ServiceRow({
  row,
  services,
  staff,
  operatingHours,
  activePackages,
  dayBookings,
  ownBookingIds,
  canRemove,
  sellPackageTemplate,
  newPackageUsedForService,
  onChange,
  onRemove,
  error,
}: ServiceRowProps) {
  // Operating-hours awareness for this row's selected date. We intentionally
  // do NOT hard-clamp the datetime-local input (that blocked users from
  // changing the DATE because datetime-local treats min/max as absolute
  // timestamps, not time-of-day). Instead we surface an inline warning if
  // the chosen moment falls outside the day's hours or on a closed day —
  // leaving the merchant free to override if they really mean it (e.g. a
  // special after-hours appointment).
  const dayKey = dayOfWeekKey(row.startTime);
  const dayHours = dayKey && operatingHours ? operatingHours[dayKey] : undefined;
  const isDayClosed = dayHours?.closed === true;
  const outsideHours = dayHours && !dayHours.closed && isOutsideHours(row.startTime, dayHours);

  const selectedStaffEntry = staff.find((s) => s.id === row.staffId);
  const selectedIsPlaceholder = selectedStaffEntry
    ? isAnyAvailablePlaceholder(selectedStaffEntry.name)
    : false;
  const eligiblePackages = activePackages.flatMap((pkg) =>
    pkg.pendingSessions
      .filter((s) => s.serviceId === row.serviceId)
      .map((s) => ({ pkg, session: s }))
  );

  const svc = services.find((s) => s.id === row.serviceId);
  // Split-buffer services need a secondary staff selector. Hidden entirely
  // when the service has no pre/post buffer windows since a secondary with
  // nothing to own is rejected by the backend.
  const hasBuffers =
    !!svc && ((svc.preBufferMinutes ?? 0) > 0 || (svc.postBufferMinutes ?? 0) > 0);

  const soldQuantityForService = sellPackageTemplate
    ? sellPackageTemplate.includedServices
        .filter((s) => s.serviceId === row.serviceId)
        .reduce((sum, s) => sum + s.quantity, 0)
    : 0;
  const rowCountsTowardCapacity = row.useNewPackage ? 1 : 0;
  const otherRowsUsingSame = newPackageUsedForService;
  const remainingCapacity =
    soldQuantityForService - otherRowsUsingSame - rowCountsTowardCapacity;
  const canToggleNewPackage =
    sellPackageTemplate !== null &&
    soldQuantityForService > 0 &&
    (row.useNewPackage || remainingCapacity >= 0);
  const rowStart = row.startTime ? new Date(row.startTime).getTime() : NaN;
  const rowEnd =
    svc && !Number.isNaN(rowStart)
      ? rowStart + (svc.durationMinutes + svc.bufferMinutes) * 60_000
      : NaN;

  function busyUntilFor(staffId: string): number | null {
    if (Number.isNaN(rowStart) || Number.isNaN(rowEnd)) return null;
    let latestEnd: number | null = null;
    for (const b of dayBookings) {
      if (ownBookingIds.has(b.id)) continue;
      if (b.staffId !== staffId) continue;
      if (b.status === 'cancelled' || b.status === 'no_show') continue;
      const bStart = new Date(b.startTime).getTime();
      const bEnd = new Date(b.endTime).getTime();
      if (rowStart < bEnd && bStart < rowEnd) {
        if (latestEnd === null || bEnd > latestEnd) latestEnd = bEnd;
      }
    }
    return latestEnd;
  }

  // Skip the per-staff busy computation on the placeholder "Any Available"
  // row — it's a bucket, not a person. Any bookings historically attached to
  // it aren't meaningful "busy" state for a new walk-in.
  const selectedBusyUntil = selectedIsPlaceholder ? null : busyUntilFor(row.staffId);

  function handleServiceChange(newServiceId: string) {
    const svc = services.find((s) => s.id === newServiceId);
    const patch: Partial<ServiceRowState> = { serviceId: newServiceId };
    if (svc && !row.priceTouched) patch.priceSgd = svc.priceSgd;
    if (row.usePackage) {
      const stillValid = activePackages.some((pkg) =>
        pkg.pendingSessions.some(
          (s) =>
            s.id === row.usePackage!.sessionId && s.serviceId === newServiceId
        )
      );
      if (!stillValid) patch.usePackage = undefined;
    }
    // If the currently-selected staff isn't credentialed for the new service
    // (and isn't the "Any Available" placeholder), clear the staff selection
    // so the user is forced to pick someone qualified.
    if (newServiceId && row.staffId) {
      const cur = staff.find((s) => s.id === row.staffId);
      if (cur && !isAnyAvailablePlaceholder(cur.name) && !cur.serviceIds.includes(newServiceId)) {
        patch.staffId = '';
      }
    }
    onChange(patch);
  }

  function togglePackage() {
    if (row.usePackage) {
      onChange({ usePackage: undefined, priceTouched: false });
      return;
    }
    if (eligiblePackages.length === 0) return;
    const pick = eligiblePackages[0];
    onChange({
      usePackage: { clientPackageId: pick.pkg.id, sessionId: pick.session.id },
      priceSgd: '0.00',
      priceTouched: false,
    });
  }

  return (
    <div className="rounded-xl border border-grey-15 p-3 space-y-2 bg-grey-5">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <select
          value={row.serviceId}
          onChange={(e) => handleServiceChange(e.target.value)}
          className="w-full rounded-lg border border-grey-30 px-3 py-2 text-sm"
        >
          <option value="">Select service...</option>
          {services.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
        <select
          value={row.staffId}
          onChange={(e) => onChange({ staffId: e.target.value })}
          className="w-full rounded-lg border border-grey-30 px-3 py-2 text-sm"
        >
          <option value="">Select staff...</option>
          {staff
            // Filter out staff who aren't credentialed for the selected service.
            // Always keep "Any Available" placeholder and the currently-selected
            // staff (so legacy bad-data bookings remain editable).
            .filter((s) => {
              if (isAnyAvailablePlaceholder(s.name)) return true;
              if (!row.serviceId) return true;
              if (s.id === row.staffId) return true;
              return s.serviceIds.includes(row.serviceId);
            })
            .map((s) => {
              const busyUntil = isAnyAvailablePlaceholder(s.name) ? null : busyUntilFor(s.id);
              return (
                <option key={s.id} value={s.id}>
                  {busyUntil
                    ? `⚠ ${s.name} — busy until ${fmtTime(busyUntil)}`
                    : s.name}
                </option>
              );
            })}
        </select>
      </div>
      {hasBuffers && svc && (
        <div>
          <label className="block text-xs font-medium text-grey-75 mb-1">
            Secondary staff (handles {svc.preBufferMinutes ?? 0}min prep + {svc.postBufferMinutes ?? 0}min cleanup)
          </label>
          <select
            value={row.secondaryStaffId ?? ''}
            onChange={(e) =>
              onChange({ secondaryStaffId: e.target.value ? e.target.value : null })
            }
            className="w-full rounded-lg border border-grey-30 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-tone-sage"
          >
            <option value="">(none — primary staff handles full duration)</option>
            {staff
              // Exclude the primary (can't be both) and the "Any Available"
              // bucket placeholder. Inactive staff are also dropped — but
              // because edit-context returns staff without an isActive flag,
              // we treat undefined as active so we don't accidentally hide
              // everyone.
              .filter((s) => {
                if (s.id === row.staffId) return false;
                if (isAnyAvailablePlaceholder(s.name)) return false;
                if (s.isActive === false) return false;
                return true;
              })
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                  {s.title ? ` · ${s.title}` : ''}
                </option>
              ))}
          </select>
        </div>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <input
          type="datetime-local"
          value={toLocalInput(row.startTime)}
          onChange={(e) => onChange({ startTime: new Date(e.target.value).toISOString() })}
          className="w-full rounded-lg border border-grey-30 px-3 py-2 text-sm"
        />
        <input
          type="number"
          step="0.01"
          min="0"
          value={row.priceSgd}
          onChange={(e) => onChange({ priceSgd: e.target.value, priceTouched: true })}
          className="w-full rounded-lg border border-grey-30 px-3 py-2 text-sm"
        />
      </div>
      {selectedBusyUntil !== null && (
        <p className="text-xs text-semantic-warn">
          ⚠ Selected staff is busy until {fmtTime(selectedBusyUntil)}.
        </p>
      )}
      {isDayClosed && (
        <p className="text-xs text-semantic-danger">
          ⚠ The business is closed on this day per operating hours.
        </p>
      )}
      {outsideHours && !isDayClosed && (
        <p className="text-xs text-semantic-warn">
          ⚠ This time is outside the business&apos;s operating hours ({dayHours?.open}–{dayHours?.close}).
        </p>
      )}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1 flex-wrap">
          {eligiblePackages.length > 0 && (() => {
            // When the row is using a package, surface the package's name and
            // remaining session count so staff know what they're consuming
            // before clicking Save. The figures come from the parent's
            // activePackages payload which the backend recomputes after each
            // save — the visible numbers therefore decrement automatically
            // once the booking is created and the page refetches.
            const activePkg = row.usePackage
              ? activePackages.find((p) => p.id === row.usePackage!.clientPackageId) ?? null
              : eligiblePackages[0]?.pkg ?? null;
            const remaining = activePkg
              ? activePkg.sessionsTotal - activePkg.sessionsUsed
              : 0;
            const pkgName = activePkg?.packageName ?? 'package';
            const shortName =
              pkgName.length > 22 ? pkgName.slice(0, 20).trimEnd() + '…' : pkgName;
            return (
              <button
                type="button"
                onClick={togglePackage}
                disabled={Boolean(row.useNewPackage)}
                title={
                  row.usePackage
                    ? `${pkgName} — ${remaining} of ${activePkg?.sessionsTotal ?? 0} sessions remaining (this booking will use 1)`
                    : `Redeem from ${pkgName} — ${remaining} sessions remaining`
                }
                className={`px-2 py-1 rounded-full text-xs font-medium border disabled:opacity-40 ${
                  row.usePackage
                    ? 'bg-tone-ink text-white border-tone-ink'
                    : 'bg-tone-surface text-tone-sage border-tone-sage/30 hover:bg-tone-sage/10'
                }`}
              >
                {row.usePackage ? `✓ Using ${shortName} · ${remaining} left` : 'Use package'}
              </button>
            );
          })()}
          {sellPackageTemplate && soldQuantityForService > 0 && (
            <button
              type="button"
              onClick={() => {
                if (row.useNewPackage) {
                  onChange({
                    useNewPackage: false,
                    priceSgd: svc?.priceSgd ?? row.priceSgd,
                    priceTouched: false,
                  });
                } else {
                  onChange({
                    useNewPackage: true,
                    usePackage: undefined,
                    priceSgd: '0.00',
                    priceTouched: false,
                  });
                }
              }}
              disabled={!canToggleNewPackage}
              className={`px-2 py-1 rounded-full text-xs font-medium border disabled:opacity-40 ${
                row.useNewPackage
                  ? 'bg-tone-sage text-white border-tone-sage'
                  : 'bg-tone-surface text-tone-sage border-tone-sage/30 hover:bg-tone-sage/5'
              }`}
            >
              {row.useNewPackage
                ? '✓ Redeem from new package'
                : remainingCapacity < 0
                ? '⚠ exceeds package quantity'
                : 'Redeem from new package'}
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={onRemove}
          disabled={!canRemove}
          className="text-sm text-semantic-danger disabled:opacity-30"
          aria-label="Remove service"
        >
          ×
        </button>
      </div>
      {error && <p className="text-xs text-semantic-danger">{error}</p>}
    </div>
  );
}

function toLocalInput(iso: string) {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function parseHM(hhmm: string): number | null {
  const [h, m] = hhmm.split(':').map((x) => parseInt(x, 10));
  if (Number.isNaN(h) || Number.isNaN(m ?? 0)) return null;
  return h * 60 + (m ?? 0);
}

function isOutsideHours(
  iso: string,
  day: { open: string; close: string },
): boolean {
  if (!iso) return false;
  try {
    const d = new Date(iso);
    const rowMin = d.getHours() * 60 + d.getMinutes();
    const open = parseHM(day.open);
    const close = parseHM(day.close);
    if (open === null || close === null) return false;
    return rowMin < open || rowMin > close;
  } catch {
    return false;
  }
}

function fmtTime(ms: number): string {
  return new Date(ms).toLocaleTimeString('en-SG', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}
