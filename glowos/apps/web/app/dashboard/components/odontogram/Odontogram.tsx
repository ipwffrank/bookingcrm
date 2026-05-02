// Dental odontogram component — implements MDC 2024 full-mouth charting.
//
// Self-hides for non-dental merchants: the GET /odontogram endpoint
// returns 403 when merchants.vertical !== 'dental'. We catch that and
// render null so the host (ClientFullDetail) can mount unconditionally.
//
// FDI two-digit numbering (ISO 3950):
//   Upper right: 18,17,16,15,14,13,12,11   |   Upper left: 21,22,23,24,25,26,27,28
//   Lower right: 48,47,46,45,44,43,42,41   |   Lower left: 31,32,33,34,35,36,37,38
//
// Surface convention:
//   M = mesial · D = distal · O = occlusal (post.) · I = incisal (ant.)
//   B = buccal/labial · L = lingual/palatal

"use client";

import { useEffect, useState } from "react";
import { apiFetch, ApiError } from "../../../lib/api";
import { ToothCell } from "./ToothCell";
import { ToothEditorModal } from "./ToothEditorModal";
import type {
  FdiCode,
  ToothChart,
  OdontogramCharting,
} from "./types";

const PERMANENT_QUADRANTS = {
  upperRight: ["18", "17", "16", "15", "14", "13", "12", "11"] as FdiCode[],
  upperLeft: ["21", "22", "23", "24", "25", "26", "27", "28"] as FdiCode[],
  lowerRight: ["48", "47", "46", "45", "44", "43", "42", "41"] as FdiCode[],
  lowerLeft: ["31", "32", "33", "34", "35", "36", "37", "38"] as FdiCode[],
};

interface OdontogramProps {
  /** client_profiles.id (NOT clients.id — the API resolves the join). */
  profileId: string;
  /**
   * The most recent non-locked clinical_records id for this client. The
   * odontogram saves attach to this record. When undefined, the chart
   * renders read-only with a CTA to create a clinical record first.
   */
  parentRecordId?: string;
  canEdit: boolean;
}

interface OdontogramApiResponse {
  id?: string;
  clinical_record_id?: string;
  charting: OdontogramCharting;
  charting_notes: string | null;
  perio_probing: unknown;
  recorded_by_name?: string;
  updated_at?: string;
}

interface HistoryApiResponse {
  history: Array<{
    id: string;
    clinical_record_id: string;
    charting: OdontogramCharting;
    charting_notes: string | null;
    recorded_by_name: string;
    created_at: string;
  }>;
}

export function Odontogram({ profileId, parentRecordId, canEdit }: OdontogramProps) {
  const [charting, setCharting] = useState<OdontogramCharting>({});
  const [notes, setNotes] = useState<string>("");
  const [editingTooth, setEditingTooth] = useState<FdiCode | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  // Single signal that drives "should we render at all". Set to true on 403
  // so non-dental merchants get a fully invisible component.
  const [forbidden, setForbidden] = useState(false);

  // Cross-visit overlay state
  const [previousChart, setPreviousChart] = useState<OdontogramCharting | null>(null);
  const [previousVisitDate, setPreviousVisitDate] = useState<string | null>(null);
  const [showPrevious, setShowPrevious] = useState(false);

  // ── Load latest chart for this client on mount ───────────────────────
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    apiFetch(`/merchant/clients/${profileId}/odontogram`)
      .then((data: OdontogramApiResponse) => {
        if (cancelled) return;
        setCharting(data.charting ?? {});
        setNotes(data.charting_notes ?? "");
        setDirty(false);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        if (e instanceof ApiError && e.status === 403) {
          // Non-dental merchant — go invisible.
          setForbidden(true);
        } else {
          setError(e instanceof Error ? e.message : String(e));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [profileId]);

  // ── Lazy-load the previous visit's chart when the toggle flips on ────
  useEffect(() => {
    if (!showPrevious || previousChart !== null || forbidden) return;
    let cancelled = false;
    apiFetch(
      `/merchant/clients/${profileId}/odontogram/history?limit=2${
        parentRecordId ? `&beforeRecordId=${parentRecordId}` : ""
      }`,
    )
      .then((data: HistoryApiResponse) => {
        if (cancelled) return;
        // history[0] = current; history[1] = the immediately preceding one
        const prev = data.history?.[1];
        if (prev) {
          setPreviousChart(prev.charting ?? {});
          setPreviousVisitDate(prev.created_at);
        } else {
          setPreviousChart({});
        }
      })
      .catch(() => {
        if (!cancelled) setPreviousChart({});
      });
    return () => {
      cancelled = true;
    };
  }, [showPrevious, previousChart, profileId, parentRecordId, forbidden]);

  // ── Edit handlers ────────────────────────────────────────────────────
  function updateTooth(fdi: FdiCode, chart: ToothChart) {
    setCharting((prev: OdontogramCharting) => {
      // Drop the entry entirely when the chart is empty (cleaner JSON).
      if (
        chart.whole === undefined &&
        (!chart.surfaces || Object.keys(chart.surfaces).length === 0) &&
        !chart.notes
      ) {
        const { [fdi]: _omit, ...rest } = prev;
        return rest as OdontogramCharting;
      }
      return { ...prev, [fdi]: chart };
    });
    setDirty(true);
  }

  async function save() {
    if (!canEdit || !parentRecordId) return;
    setSaving(true);
    setError(null);
    try {
      await apiFetch(`/merchant/clients/${profileId}/odontogram`, {
        method: "POST",
        body: JSON.stringify({
          clinical_record_id: parentRecordId,
          charting,
          charting_notes: notes || undefined,
        }),
      });
      setDirty(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  // ── Render ───────────────────────────────────────────────────────────
  if (forbidden) return null; // non-dental merchant — invisible

  if (loading) {
    return (
      <div className="bg-tone-surface rounded-xl border border-grey-15 p-5 animate-pulse">
        <div className="h-4 bg-grey-15 rounded w-32 mb-4" />
        <div className="h-32 bg-grey-15 rounded" />
      </div>
    );
  }

  return (
    <div className="bg-tone-surface rounded-xl border border-grey-15 p-5 odontogram-print-root">
      {/* Header */}
      <div className="flex items-baseline justify-between mb-4 flex-wrap gap-3">
        <h2 className="text-sm font-semibold text-tone-ink">
          Dental Charting <span className="text-grey-45 font-normal">· FDI · MDC 2024</span>
        </h2>
        <div className="flex items-center gap-3 print:hidden">
          {/* Toggle: show previous visit overlay */}
          <label className="flex items-center gap-1.5 text-xs text-grey-70 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showPrevious}
              onChange={(e) => setShowPrevious(e.target.checked)}
              className="accent-tone-sage"
            />
            <span>
              Show previous visit
              {showPrevious && previousVisitDate && (
                <span className="text-grey-45 ml-1">
                  ·{" "}
                  {new Date(previousVisitDate).toLocaleDateString("en-SG", {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  })}
                </span>
              )}
            </span>
          </label>
          {/* Print / Export PDF */}
          <button
            type="button"
            onClick={() => window.print()}
            className="text-xs text-grey-70 hover:text-tone-ink underline-offset-2 hover:underline"
            title="Use the browser's print dialog — choose 'Save as PDF' to export."
          >
            Print / Export PDF
          </button>
        </div>
      </div>

      {/* Upper + lower jaws */}
      <div className="space-y-3 select-none overflow-x-auto">
        <ToothRow
          label="Upper"
          left={PERMANENT_QUADRANTS.upperRight}
          right={PERMANENT_QUADRANTS.upperLeft}
          charting={charting}
          previousCharting={showPrevious ? previousChart ?? undefined : undefined}
          onClickTooth={canEdit ? (fdi) => setEditingTooth(fdi) : undefined}
        />
        <ToothRow
          label="Lower"
          left={PERMANENT_QUADRANTS.lowerRight}
          right={PERMANENT_QUADRANTS.lowerLeft}
          charting={charting}
          previousCharting={showPrevious ? previousChart ?? undefined : undefined}
          onClickTooth={canEdit ? (fdi) => setEditingTooth(fdi) : undefined}
        />
      </div>

      {/* Notes */}
      <div className="mt-5">
        <label
          htmlFor={`odontogram-notes-${profileId}`}
          className="text-[11px] text-grey-60 font-medium block mb-1.5"
        >
          Charting notes
        </label>
        <textarea
          id={`odontogram-notes-${profileId}`}
          value={notes}
          onChange={(e) => {
            setNotes(e.target.value);
            setDirty(true);
          }}
          disabled={!canEdit}
          className="w-full rounded-lg border border-grey-15 px-3 py-2 text-sm text-tone-ink outline-none focus:ring-1 focus:ring-tone-sage/30 disabled:bg-grey-5 disabled:cursor-not-allowed"
          rows={3}
          placeholder="e.g. Patient reports sensitivity on UL6. Plan: composite repair next visit."
        />
      </div>

      {/* Footer: save + status */}
      {canEdit && (
        <div className="mt-4 flex items-center justify-between print:hidden">
          <span className="text-xs text-grey-45">
            {!parentRecordId && (
              <>
                Create a clinical record above to save this chart.
              </>
            )}
            {parentRecordId && (dirty ? "Unsaved changes" : "All changes saved")}
            {error && (
              <span className="text-semantic-danger ml-2">· {error}</span>
            )}
          </span>
          <button
            type="button"
            onClick={() => { void save(); }}
            disabled={saving || !dirty || !parentRecordId}
            className="px-4 py-2 rounded-lg bg-tone-ink text-tone-surface text-sm font-medium hover:bg-tone-ink/90 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {saving ? "Saving…" : "Save chart"}
          </button>
        </div>
      )}

      {/* Per-tooth editor modal */}
      {editingTooth && (
        <ToothEditorModal
          fdi={editingTooth}
          chart={charting[editingTooth] ?? {}}
          onSave={(chart) => {
            updateTooth(editingTooth, chart);
            setEditingTooth(null);
          }}
          onClose={() => setEditingTooth(null)}
        />
      )}
    </div>
  );
}

// ─── Single jaw row ──────────────────────────────────────────────────────
function ToothRow({
  label,
  left,
  right,
  charting,
  previousCharting,
  onClickTooth,
}: {
  label: string;
  left: FdiCode[];
  right: FdiCode[];
  charting: OdontogramCharting;
  previousCharting?: OdontogramCharting;
  onClickTooth?: (fdi: FdiCode) => void;
}) {
  return (
    <div className="flex items-center gap-1">
      <span className="w-12 text-[10px] text-grey-45 uppercase tracking-wider flex-shrink-0">
        {label}
      </span>
      <div className="flex-1 flex gap-0.5 justify-center">
        {left.map((fdi) => (
          <ToothCell
            key={fdi}
            fdi={fdi}
            chart={charting[fdi]}
            previousChart={previousCharting?.[fdi]}
            onClick={onClickTooth}
          />
        ))}
        <div className="w-px bg-grey-30 mx-1.5" aria-hidden="true" />
        {right.map((fdi) => (
          <ToothCell
            key={fdi}
            fdi={fdi}
            chart={charting[fdi]}
            previousChart={previousCharting?.[fdi]}
            onClick={onClickTooth}
          />
        ))}
      </div>
    </div>
  );
}
