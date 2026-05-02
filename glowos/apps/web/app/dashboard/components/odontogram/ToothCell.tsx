// Single-tooth visual cell. Displays the FDI number + a stylised tooth
// shape coloured by whole-tooth status, with surface dots for surface
// conditions. Click to open the per-tooth editor modal.
//
// Save to: apps/web/app/dashboard/components/clinical-record/odontogram/ToothCell.tsx
//
// Visual conventions (matches GlowOS palette):
//   - 'present' / unset       → grey-15 outline, white fill
//   - 'caries' on any surface → semantic-warn (amber) dot on the surface
//   - 'amalgam'/'composite'   → tone-ink dot on the surface
//   - 'missing' / 'extracted' → grey-30 X overlay, strike-through
//   - 'crown' / 'rct_crown'   → tone-sage fill (tooth covered)
//   - 'rct'                   → tone-sage diagonal lines (RCT only, no crown)
//   - 'implant'               → tone-ink stem visual
//   - 'unerupted' / 'erupting'→ dashed outline
//
// Tooth shape uses a simple rounded rectangle with surface zones — not
// anatomically accurate, but unambiguous for charting purposes. Real
// odontograms in MY clinics typically use schematic shapes too.

"use client";

import type {
  FdiCode,
  ToothChart,
  WholeToothStatus,
  SurfaceCode,
  SurfaceCondition,
} from "./types";

interface ToothCellProps {
  fdi: FdiCode;
  chart?: ToothChart;
  /**
   * Read-only ghost overlay of the previous visit's chart for this tooth.
   * Renders at 30% opacity behind the current chart when present.
   */
  previousChart?: ToothChart;
  onClick?: (fdi: FdiCode) => void;
}

// Posterior teeth (premolars + molars) have an occlusal surface; anterior
// teeth (incisors + canines) have an incisal edge instead. FDI second
// digit 4–8 = posterior, 1–3 = anterior.
function isPosterior(fdi: FdiCode): boolean {
  const second = parseInt(fdi.charAt(1), 10);
  return second >= 4;
}

// Status → fill colour
function statusFill(status?: WholeToothStatus): string {
  switch (status) {
    case "crown":
    case "rct_crown":
      return "fill-tone-sage";
    case "missing":
    case "extracted":
      return "fill-grey-15";
    case "implant":
      return "fill-tone-ink";
    case "extraction_indicated":
      return "fill-semantic-warn/20";
    default:
      return "fill-white";
  }
}

// Status → stroke style
function statusStroke(status?: WholeToothStatus): string {
  switch (status) {
    case "unerupted":
    case "erupting":
      return "stroke-grey-30 stroke-dashed"; // see <style> note in usage
    case "missing":
    case "extracted":
      return "stroke-grey-30";
    default:
      return "stroke-grey-30";
  }
}

// Surface condition → dot colour. First condition wins for the dot.
function surfaceDotColor(conditions?: SurfaceCondition[]): string | null {
  if (!conditions || conditions.length === 0) return null;
  const c = conditions[0];
  switch (c) {
    case "caries":
      return "fill-semantic-warn";
    case "amalgam":
    case "composite":
    case "gic":
      return "fill-tone-ink";
    case "sealant":
      return "fill-tone-sage";
    case "fracture":
    case "attrition":
    case "erosion":
      return "fill-semantic-warn";
    case "recession":
    case "plaque":
    case "calculus":
      return "fill-grey-45";
    default:
      return "fill-grey-45";
  }
}

export function ToothCell({ fdi, chart, previousChart, onClick }: ToothCellProps) {
  const status = chart?.whole;
  const surfaces = chart?.surfaces ?? {};
  const isMissing = status === "missing" || status === "extracted";
  const interactive = !!onClick;
  const prevStatus = previousChart?.whole;
  const prevSurfaces = previousChart?.surfaces ?? {};
  const prevIsMissing = prevStatus === "missing" || prevStatus === "extracted";

  // Surface positions inside a 24×30 viewBox.
  // Tooth shape: rounded rect at (4,4) → (20,26).
  // Surface zones (small circles overlaid):
  //   M (mesial, left)            (5, 15)
  //   D (distal, right)           (19, 15)
  //   B (buccal/labial, top)      (12, 6)
  //   L (lingual/palatal, bottom) (12, 24)
  //   O / I (centre)              (12, 15)
  const post = isPosterior(fdi);
  const centerSurface: SurfaceCode = post ? "O" : "I";
  const surfaceDots: Array<{ key: SurfaceCode; cx: number; cy: number }> = [
    { key: "M", cx: 5, cy: 15 },
    { key: "D", cx: 19, cy: 15 },
    { key: "B", cx: 12, cy: 6 },
    { key: "L", cx: 12, cy: 24 },
    { key: centerSurface, cx: 12, cy: 15 },
  ];

  return (
    <button
      type="button"
      onClick={interactive ? () => onClick!(fdi) : undefined}
      disabled={!interactive}
      // Touch-friendly sizing: 24×30 baseline, scaled up to 36×44 on
      // coarse-pointer devices (iPad, phone) so DSAs charting on tablet
      // hit Apple HIG / Material's 44 px minimum touch target.
      className={`flex flex-col items-center gap-0.5 p-0.5 ${
        interactive
          ? "cursor-pointer hover:bg-grey-5 rounded"
          : "cursor-default"
      } disabled:cursor-default touch-manipulation`}
      style={{ minWidth: 28, minHeight: 36 }}
      aria-label={`Tooth ${fdi}${status ? ` (${status})` : ""}`}
      title={describeTooth(fdi, chart)}
    >
      <span className="text-[9px] text-grey-45 tabular-nums leading-none [@media(pointer:coarse)]:text-[11px]">
        {fdi}
      </span>
      <svg
        viewBox="0 0 24 30"
        aria-hidden="true"
        className="w-6 h-[30px] [@media(pointer:coarse)]:w-9 [@media(pointer:coarse)]:h-11"
      >
        {/* ── Previous-visit ghost overlay (30% opacity, behind current) ── */}
        {previousChart && (
          <g opacity={0.3}>
            <rect
              x="4"
              y="4"
              width="16"
              height="22"
              rx="3"
              ry="3"
              className={`${statusFill(prevStatus)} stroke-grey-30`}
              strokeDasharray="2 2"
              strokeWidth="0.75"
            />
            {prevIsMissing && (
              <>
                <line x1="4" y1="4" x2="20" y2="26" className="stroke-grey-45" strokeWidth="1" />
                <line x1="20" y1="4" x2="4" y2="26" className="stroke-grey-45" strokeWidth="1" />
              </>
            )}
            {!prevIsMissing &&
              surfaceDots.map(({ key, cx, cy }) => {
                const color = surfaceDotColor(prevSurfaces[key]);
                if (!color) return null;
                return <circle key={`prev-${key}`} cx={cx} cy={cy} r={1.2} className={color} />;
              })}
          </g>
        )}

        {/* ── Current-visit chart (full opacity, on top) ── */}
        <rect
          x="4"
          y="4"
          width="16"
          height="22"
          rx="3"
          ry="3"
          className={`${statusFill(status)} ${statusStroke(status)}`}
          strokeWidth="1"
        />

        {/* Missing / extracted: cross out */}
        {isMissing && (
          <>
            <line x1="4" y1="4" x2="20" y2="26" className="stroke-grey-45" strokeWidth="1.5" />
            <line x1="20" y1="4" x2="4" y2="26" className="stroke-grey-45" strokeWidth="1.5" />
          </>
        )}

        {/* RCT (no crown): diagonal hatching */}
        {status === "rct" && (
          <line x1="4" y1="26" x2="20" y2="4" className="stroke-tone-sage" strokeWidth="1" />
        )}

        {/* Surface dots */}
        {!isMissing &&
          surfaceDots.map(({ key, cx, cy }) => {
            const color = surfaceDotColor(surfaces[key]);
            if (!color) return null;
            return (
              <circle key={key} cx={cx} cy={cy} r={1.6} className={color} />
            );
          })}
      </svg>
    </button>
  );
}

// Hover tooltip / aria description
function describeTooth(fdi: FdiCode, chart?: ToothChart): string {
  if (!chart) return `Tooth ${fdi} — present, no findings`;
  const parts: string[] = [`Tooth ${fdi}`];
  if (chart.whole) parts.push(chart.whole.replace(/_/g, " "));
  if (chart.surfaces) {
    const entries = Object.entries(chart.surfaces) as Array<[string, SurfaceCondition[] | undefined]>;
    const surf = entries
      .map(([s, conds]) => `${s}: ${(conds ?? []).join(", ")}`)
      .filter(Boolean);
    if (surf.length) parts.push(surf.join(" · "));
  }
  if (chart.notes) parts.push(`note: ${chart.notes}`);
  return parts.join(" — ");
}
