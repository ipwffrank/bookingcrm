'use client';

type BookingStatus = 'confirmed' | 'in_progress' | 'completed' | 'cancelled' | 'no_show';

interface Booking {
  id: string;
  startTime: string;
  endTime: string;
  status: BookingStatus;
  staffId: string;
  staffName: string;
}

interface OperatingHours {
  [day: string]: { open: string; close: string; closed: boolean };
}

interface DayTimelineStripProps {
  bookings: Booking[];
  operatingHours: OperatingHours | null;
  statusFilter: BookingStatus | null;
  onBarClick: (bookingId: string) => void;
}

// Same palette as the Calendar page so the same staff keeps the same color.
const STAFF_COLORS = [
  '#6366f1', '#06b6d4', '#8b5cf6', '#ec4899', '#f59e0b',
  '#10b981', '#3b82f6', '#ef4444', '#14b8a6', '#a855f7',
];

const DEFAULT_OPEN_MIN = 8 * 60;   // 8 AM
const DEFAULT_CLOSE_MIN = 20 * 60; // 8 PM

const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

function timeStrToMin(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

function minToLabel(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${h12} ${period}` : `${h12}:${String(m).padStart(2, '0')} ${period}`;
}

function isoToLocalMin(iso: string): number {
  const d = new Date(iso);
  return d.getHours() * 60 + d.getMinutes();
}

export function DayTimelineStrip({
  bookings,
  operatingHours,
  statusFilter,
  onBarClick,
}: DayTimelineStripProps) {
  const today = new Date();
  const dayKey = DAY_NAMES[today.getDay()]!;
  const dayHours = operatingHours?.[dayKey];

  const isClosedToday = dayHours?.closed === true;
  const openMin = dayHours && !dayHours.closed ? timeStrToMin(dayHours.open) : DEFAULT_OPEN_MIN;
  const closeMin = dayHours && !dayHours.closed ? timeStrToMin(dayHours.close) : DEFAULT_CLOSE_MIN;
  const totalMin = Math.max(60, closeMin - openMin);

  // Stable staff order: first time a staffId appears in today's bookings wins.
  const staffOrder: string[] = [];
  const staffNames = new Map<string, string>();
  for (const b of bookings) {
    if (!staffOrder.includes(b.staffId)) staffOrder.push(b.staffId);
    staffNames.set(b.staffId, b.staffName);
  }

  // Four evenly-spaced tick labels
  const tickPositions = [0, 1 / 3, 2 / 3, 1];
  const ticks = tickPositions.map((p) => {
    const min = openMin + totalMin * p;
    return { leftPct: p * 100, label: minToLabel(Math.round(min)) };
  });

  return (
    <div className="mb-4 bg-white rounded-xl border border-gray-200 p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-gray-900">Today at a glance</h2>
        {isClosedToday && (
          <span className="text-xs text-gray-500 italic">Closed today</span>
        )}
      </div>

      {isClosedToday ? (
        <div className="h-10 rounded-md bg-gray-100 border border-gray-200" />
      ) : staffOrder.length === 0 ? (
        <div className="h-10 flex items-center justify-center text-xs text-gray-400 italic">
          No bookings scheduled today
        </div>
      ) : (
        <div className="space-y-1.5">
          {staffOrder.map((staffId, idx) => {
            const color = STAFF_COLORS[idx % STAFF_COLORS.length]!;
            const staffBookings = bookings.filter((b) => b.staffId === staffId);
            return (
              <div key={staffId} className="flex items-center gap-2">
                <span
                  className="text-[10px] font-medium text-gray-600 shrink-0 truncate"
                  style={{ width: 64 }}
                  title={staffNames.get(staffId) ?? ''}
                >
                  {staffNames.get(staffId) ?? ''}
                </span>
                <div className="relative flex-1 h-5 rounded bg-gray-50 border border-gray-100">
                  {staffBookings.map((b) => {
                    const bStart = isoToLocalMin(b.startTime);
                    const bEnd = isoToLocalMin(b.endTime);
                    const rawLeftPct = ((bStart - openMin) / totalMin) * 100;
                    const rawWidthPct = ((bEnd - bStart) / totalMin) * 100;
                    const leftPct = Math.max(0, Math.min(100, rawLeftPct));
                    const widthPct = Math.max(0.5, Math.min(100 - leftPct, rawWidthPct));
                    const truncatedLeft = rawLeftPct < 0;
                    const truncatedRight = rawLeftPct + rawWidthPct > 100;

                    const isCancelled = b.status === 'cancelled';
                    const isNoShow = b.status === 'no_show';
                    const dimmedByFilter = statusFilter !== null && b.status !== statusFilter;

                    return (
                      <button
                        key={b.id}
                        type="button"
                        onClick={() => onBarClick(b.id)}
                        className="absolute top-0 bottom-0 rounded text-[9px] font-medium text-white px-0.5 overflow-hidden whitespace-nowrap transition-all hover:brightness-110 hover:z-10"
                        style={{
                          left: `${leftPct}%`,
                          width: `${widthPct}%`,
                          backgroundColor: color,
                          opacity: dimmedByFilter ? 0.2 : isCancelled ? 0.3 : 1,
                          border: isNoShow ? '1px dashed rgba(0,0,0,0.5)' : undefined,
                          textDecoration: isCancelled ? 'line-through' : undefined,
                        }}
                        title={`${minToLabel(bStart)}–${minToLabel(bEnd)} · ${b.status}`}
                      >
                        {truncatedLeft && '‹'}
                        {minToLabel(bStart)}
                        {truncatedRight && '›'}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Tick labels */}
      {!isClosedToday && (
        <div className="relative mt-2 ml-[72px] h-4">
          {ticks.map((t, i) => (
            <span
              key={i}
              className="absolute text-[10px] text-gray-400 tabular-nums"
              style={{
                left: `${t.leftPct}%`,
                transform:
                  i === 0 ? 'translateX(0)' : i === ticks.length - 1 ? 'translateX(-100%)' : 'translateX(-50%)',
              }}
            >
              {t.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
