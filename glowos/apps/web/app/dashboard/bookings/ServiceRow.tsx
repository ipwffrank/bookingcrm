'use client';

import type { ServiceOption, StaffOption, ServiceRowState, ActivePackage } from './types';

export interface ServiceRowProps {
  row: ServiceRowState;
  services: ServiceOption[];
  staff: StaffOption[];
  activePackages: ActivePackage[];
  canRemove: boolean;
  onChange: (patch: Partial<ServiceRowState>) => void;
  onRemove: () => void;
  error?: string;
}

export function ServiceRow({
  row,
  services,
  staff,
  activePackages,
  canRemove,
  onChange,
  onRemove,
  error,
}: ServiceRowProps) {
  const eligiblePackages = activePackages.flatMap((pkg) =>
    pkg.pendingSessions
      .filter((s) => s.serviceId === row.serviceId)
      .map((s) => ({ pkg, session: s }))
  );

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
    <div className="rounded-xl border border-gray-200 p-3 space-y-2 bg-gray-50">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <select
          value={row.serviceId}
          onChange={(e) => handleServiceChange(e.target.value)}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
        >
          <option value="">Select service...</option>
          {services.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
        <select
          value={row.staffId}
          onChange={(e) => onChange({ staffId: e.target.value })}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
        >
          <option value="">Select staff...</option>
          {staff.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <input
          type="datetime-local"
          value={toLocalInput(row.startTime)}
          onChange={(e) => onChange({ startTime: new Date(e.target.value).toISOString() })}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
        />
        <input
          type="number"
          step="0.01"
          min="0"
          value={row.priceSgd}
          onChange={(e) => onChange({ priceSgd: e.target.value, priceTouched: true })}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
        />
      </div>
      <div className="flex items-center justify-between">
        {eligiblePackages.length > 0 ? (
          <button
            type="button"
            onClick={togglePackage}
            className={`px-2 py-1 rounded-full text-xs font-medium border ${
              row.usePackage
                ? 'bg-indigo-600 text-white border-indigo-600'
                : 'bg-white text-indigo-700 border-indigo-200 hover:bg-indigo-50'
            }`}
          >
            {row.usePackage ? '✓ Using package' : 'Use package'}
          </button>
        ) : (
          <span />
        )}
        <button
          type="button"
          onClick={onRemove}
          disabled={!canRemove}
          className="text-sm text-red-600 disabled:opacity-30"
          aria-label="Remove service"
        >
          ×
        </button>
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}

function toLocalInput(iso: string) {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
