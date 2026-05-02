// Modal that opens when clicking a tooth in the odontogram. Lets the
// clinician set the whole-tooth status + per-surface conditions + a
// per-tooth note, then commits the change back to the parent component.
//
// Save to: apps/web/app/dashboard/components/clinical-record/odontogram/ToothEditorModal.tsx
//
// UX:
//   - Whole-tooth status selected from a single-select pill row
//   - Surface grid (M/D/O-I/B/L) — each surface multi-selects conditions
//   - Notes text area at bottom
//   - Save / Cancel / Clear-tooth at footer

"use client";

import { useState } from "react";
import type {
  FdiCode,
  ToothChart,
  WholeToothStatus,
  SurfaceCode,
  SurfaceCondition,
} from "./types";

interface ToothEditorModalProps {
  fdi: FdiCode;
  chart: ToothChart;
  onSave: (chart: ToothChart) => void;
  onClose: () => void;
}

const WHOLE_TOOTH_OPTIONS: { value: WholeToothStatus; label: string }[] = [
  { value: "present", label: "Present" },
  { value: "missing", label: "Missing" },
  { value: "extracted", label: "Extracted" },
  { value: "extraction_indicated", label: "Extr. indicated" },
  { value: "unerupted", label: "Unerupted" },
  { value: "erupting", label: "Erupting" },
  { value: "crown", label: "Crown" },
  { value: "rct", label: "RCT only" },
  { value: "rct_crown", label: "RCT + crown" },
  { value: "implant", label: "Implant" },
  { value: "bridge_pontic", label: "Bridge pontic" },
  { value: "bridge_abutment", label: "Bridge abutment" },
  { value: "veneer", label: "Veneer" },
];

const SURFACE_CONDITIONS: { value: SurfaceCondition; label: string }[] = [
  { value: "caries", label: "Caries" },
  { value: "amalgam", label: "Amalgam" },
  { value: "composite", label: "Composite" },
  { value: "gic", label: "GIC" },
  { value: "sealant", label: "Sealant" },
  { value: "fracture", label: "Fracture" },
  { value: "attrition", label: "Attrition" },
  { value: "erosion", label: "Erosion" },
  { value: "recession", label: "Recession" },
  { value: "plaque", label: "Plaque" },
  { value: "calculus", label: "Calculus" },
];

function isPosterior(fdi: FdiCode): boolean {
  return parseInt(fdi.charAt(1), 10) >= 4;
}

export function ToothEditorModal({
  fdi,
  chart,
  onSave,
  onClose,
}: ToothEditorModalProps) {
  const [whole, setWhole] = useState<WholeToothStatus | undefined>(chart.whole);
  const [surfaces, setSurfaces] = useState<Partial<Record<SurfaceCode, SurfaceCondition[]>>>(
    chart.surfaces ?? {},
  );
  const [notes, setNotes] = useState(chart.notes ?? "");

  const post = isPosterior(fdi);
  const centerSurfaceCode: SurfaceCode = post ? "O" : "I";
  const centerSurfaceLabel = post ? "Occlusal" : "Incisal";

  function toggleSurfaceCondition(surface: SurfaceCode, c: SurfaceCondition) {
    setSurfaces((prev) => {
      const current = prev[surface] ?? [];
      const next = current.includes(c)
        ? current.filter((x) => x !== c)
        : [...current, c];
      const out = { ...prev };
      if (next.length === 0) delete out[surface];
      else out[surface] = next;
      return out;
    });
  }

  function clearTooth() {
    onSave({});
  }

  function save() {
    onSave({
      whole,
      surfaces: Object.keys(surfaces).length ? surfaces : undefined,
      notes: notes.trim() || undefined,
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-tone-ink/50 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="tooth-editor-title"
    >
      <div
        className="bg-tone-surface rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-grey-15 flex items-center justify-between">
          <h2 id="tooth-editor-title" className="text-lg font-semibold text-tone-ink">
            Tooth {fdi}
            <span className="ml-2 text-sm font-normal text-grey-60">
              {post ? "Posterior" : "Anterior"}
            </span>
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-grey-60 hover:text-tone-ink"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-6">
          {/* Whole-tooth status */}
          <section>
            <h3 className="text-xs font-medium text-grey-60 uppercase tracking-wider mb-2">
              Whole-tooth status
            </h3>
            <div className="flex flex-wrap gap-2">
              {WHOLE_TOOTH_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() =>
                    setWhole((prev: WholeToothStatus | undefined) =>
                      prev === opt.value ? undefined : opt.value,
                    )
                  }
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    whole === opt.value
                      ? "bg-tone-ink text-tone-surface"
                      : "bg-tone-surface border border-grey-15 text-grey-70 hover:bg-grey-5"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </section>

          {/* Surfaces — only meaningful when tooth is present-ish */}
          {whole !== "missing" && whole !== "extracted" && whole !== "unerupted" && (
            <section>
              <h3 className="text-xs font-medium text-grey-60 uppercase tracking-wider mb-2">
                Surface conditions
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {([
                  ["M", "Mesial"],
                  ["D", "Distal"],
                  [centerSurfaceCode, centerSurfaceLabel],
                  ["B", "Buccal / labial"],
                  ["L", "Lingual / palatal"],
                ] as Array<[SurfaceCode, string]>).map(([code, label]) => (
                  <div key={code} className="border border-grey-15 rounded-lg p-3">
                    <div className="text-xs font-medium text-tone-ink mb-2">
                      {label} <span className="text-grey-45">({code})</span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {SURFACE_CONDITIONS.map((cond) => {
                        const active = (surfaces[code] ?? []).includes(cond.value);
                        return (
                          <button
                            key={cond.value}
                            type="button"
                            onClick={() => toggleSurfaceCondition(code, cond.value)}
                            className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${
                              active
                                ? "bg-tone-sage text-tone-surface"
                                : "bg-grey-5 text-grey-70 hover:bg-grey-15"
                            }`}
                          >
                            {cond.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Per-tooth note */}
          <section>
            <label
              htmlFor={`tooth-${fdi}-note`}
              className="text-xs font-medium text-grey-60 uppercase tracking-wider mb-2 block"
            >
              Note
            </label>
            <textarea
              id={`tooth-${fdi}-note`}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full rounded-lg border border-grey-15 px-3 py-2 text-sm text-tone-ink outline-none focus:ring-2 focus:ring-tone-sage"
              rows={2}
              placeholder={`e.g. ${fdi}: sensitive to cold, plan for composite next visit`}
            />
          </section>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-grey-15 flex items-center justify-between">
          <button
            type="button"
            onClick={clearTooth}
            className="text-xs text-grey-60 hover:text-semantic-danger"
          >
            Clear tooth
          </button>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-sm font-medium text-grey-70 hover:bg-grey-5"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={save}
              className="px-4 py-2 rounded-lg bg-tone-ink text-tone-surface text-sm font-medium hover:bg-tone-ink/90"
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
