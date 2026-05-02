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
   * Optional: pre-existing clinical_records id this chart should attach
   * to. When omitted (the common case for "I just want to chart this
   * patient"), the API auto-creates a stub treatment_log record on save
   * so the dentist doesn't have to create a separate consultation note
   * first. The dentist can amend the auto-created record later.
   */
  parentRecordId?: string;
  canEdit: boolean;
  /**
   * Called after a successful save when the API auto-created the parent
   * record. Lets ClientFullDetail refresh its clinical_records list so
   * the new auto-created visit appears in the timeline immediately.
   */
  onAutoCreatedParentRecord?: () => void;
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

export function Odontogram({
  profileId,
  parentRecordId,
  canEdit,
  onAutoCreatedParentRecord,
}: OdontogramProps) {
  const [charting, setCharting] = useState<OdontogramCharting>({});
  const [notes, setNotes] = useState<string>("");
  const [editingTooth, setEditingTooth] = useState<FdiCode | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [lastSavedKind, setLastSavedKind] = useState<"none" | "amended" | "new_visit">("none");
  // Single signal that drives "should we render at all". Set to true on 403
  // so non-dental merchants get a fully invisible component.
  const [forbidden, setForbidden] = useState(false);

  // Cross-visit overlay state
  const [previousChart, setPreviousChart] = useState<OdontogramCharting | null>(null);
  const [previousVisitDate, setPreviousVisitDate] = useState<string | null>(null);
  const [showPrevious, setShowPrevious] = useState(false);

  // Charting history list (Q2 fix). Lazily fetched on first expand.
  interface HistoryItem {
    id: string;
    clinical_record_id: string;
    recorded_by_name: string;
    created_at: string;
    /** Cached count of teeth charted in this snapshot — for the list label. */
    tooth_count: number;
  }
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<HistoryItem[] | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  // When set, the chart renders read-only with the historical snapshot's data.
  const [viewingHistoricalRecordId, setViewingHistoricalRecordId] = useState<string | null>(null);

  // ── Load chart on mount or when switching between latest / historical ─
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    const url = viewingHistoricalRecordId
      ? `/merchant/clients/${profileId}/odontogram?recordId=${viewingHistoricalRecordId}`
      : `/merchant/clients/${profileId}/odontogram`;

    apiFetch(url)
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
  }, [profileId, viewingHistoricalRecordId]);

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
    if (!canEdit) return;
    setSaving(true);
    setError(null);
    try {
      // Send clinical_record_id ONLY when we have one — when absent the
      // API auto-creates a stub treatment_log record and returns
      // auto_created_parent_record=true so we can refresh ClientFullDetail's
      // clinical-records list.
      const payload: Record<string, unknown> = {
        charting,
        charting_notes: notes || undefined,
      };
      if (parentRecordId) payload.clinical_record_id = parentRecordId;

      const result = (await apiFetch(`/merchant/clients/${profileId}/odontogram`, {
        method: "POST",
        body: JSON.stringify(payload),
      })) as { auto_created_parent_record?: boolean };

      setDirty(false);
      // Invalidate the cached history list so the new save shows up next
      // time the dentist expands it.
      setHistory(null);
      // Reset the cross-visit overlay cache so the next "show previous"
      // refetches with the latest parent record excluded.
      setPreviousChart(null);

      if (result.auto_created_parent_record) {
        setLastSavedKind("new_visit");
        // Tell the host (ClientFullDetail) to refresh its clinical-records
        // list so the new auto-created visit appears.
        if (onAutoCreatedParentRecord) onAutoCreatedParentRecord();
      } else {
        setLastSavedKind("amended");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  // ── Charting history (Q2 fix) ────────────────────────────────────────
  async function loadHistory() {
    if (history !== null) return; // already loaded
    setHistoryLoading(true);
    try {
      const data = (await apiFetch(
        `/merchant/clients/${profileId}/odontogram/history?limit=12`,
      )) as {
        history: Array<{
          id: string;
          clinical_record_id: string;
          charting: OdontogramCharting;
          recorded_by_name: string;
          created_at: string;
        }>;
      };
      setHistory(
        (data.history ?? []).map((h) => ({
          id: h.id,
          clinical_record_id: h.clinical_record_id,
          recorded_by_name: h.recorded_by_name,
          created_at: h.created_at,
          tooth_count: Object.keys(h.charting ?? {}).length,
        })),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setHistoryLoading(false);
    }
  }

  function viewHistoricalSnapshot(recordId: string) {
    if (dirty) {
      const ok = window.confirm(
        "You have unsaved chart changes. Switching to a historical snapshot will discard them. Continue?",
      );
      if (!ok) return;
    }
    setViewingHistoricalRecordId(recordId);
    setShowPrevious(false);
    setPreviousChart(null);
  }

  function returnToLatest() {
    setViewingHistoricalRecordId(null);
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

  const isViewingHistorical = !!viewingHistoricalRecordId;
  const effectivelyEditable = canEdit && !isViewingHistorical;

  return (
    <div className="bg-tone-surface rounded-xl border border-grey-15 p-5 odontogram-print-root">
      {/* Header */}
      <div className="flex items-baseline justify-between mb-4 flex-wrap gap-3">
        <h2 className="text-sm font-semibold text-tone-ink">
          Dental Charting <span className="text-grey-45 font-normal">· FDI · MDC 2024</span>
        </h2>
        <div className="flex items-center gap-3 print:hidden">
          {/* Toggle: show previous visit overlay (hidden in historical mode) */}
          {!isViewingHistorical && (
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
          )}
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

      {/* Historical-mode banner */}
      {isViewingHistorical && (
        <div className="mb-4 rounded-lg bg-tone-surface-warm border border-grey-15 px-4 py-2.5 flex items-center justify-between gap-3 print:hidden">
          <span className="text-xs text-grey-75">
            Viewing a previous chart — read-only.{" "}
            {history?.find((h) => h.clinical_record_id === viewingHistoricalRecordId) && (
              <span className="text-grey-60">
                Saved{" "}
                {new Date(
                  history.find((h) => h.clinical_record_id === viewingHistoricalRecordId)!.created_at,
                ).toLocaleString("en-SG", {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}{" "}
                by{" "}
                {history.find((h) => h.clinical_record_id === viewingHistoricalRecordId)!.recorded_by_name}
              </span>
            )}
          </span>
          <button
            type="button"
            onClick={returnToLatest}
            className="text-xs font-medium text-tone-sage hover:text-tone-ink"
          >
            ← Back to latest
          </button>
        </div>
      )}

      {/* Upper + lower jaws */}
      <div className="space-y-3 select-none overflow-x-auto">
        <ToothRow
          label="Upper"
          left={PERMANENT_QUADRANTS.upperRight}
          right={PERMANENT_QUADRANTS.upperLeft}
          charting={charting}
          previousCharting={showPrevious ? previousChart ?? undefined : undefined}
          onClickTooth={effectivelyEditable ? (fdi) => setEditingTooth(fdi) : undefined}
        />
        <ToothRow
          label="Lower"
          left={PERMANENT_QUADRANTS.lowerRight}
          right={PERMANENT_QUADRANTS.lowerLeft}
          charting={charting}
          previousCharting={showPrevious ? previousChart ?? undefined : undefined}
          onClickTooth={effectivelyEditable ? (fdi) => setEditingTooth(fdi) : undefined}
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
          disabled={!effectivelyEditable}
          className="w-full rounded-lg border border-grey-15 px-3 py-2 text-sm text-tone-ink outline-none focus:ring-1 focus:ring-tone-sage/30 disabled:bg-grey-5 disabled:cursor-not-allowed"
          rows={3}
          placeholder="e.g. Patient reports sensitivity on UL6. Plan: composite repair next visit."
        />
      </div>

      {/* Footer: save + status (hidden when viewing a historical snapshot)
          parentRecordId is set ONLY when there's a non-locked
          clinical_records row dated today (filtered by ClientFullDetail).
          When undefined, the API auto-creates a fresh treatment_log row
          on save, preserving past visit snapshots. The status text
          previews which path the next save will take so the dentist
          knows what to expect. */}
      {effectivelyEditable && (
        <div className="mt-4 flex items-center justify-between print:hidden">
          <span className="text-xs text-grey-45">
            {dirty
              ? parentRecordId
                ? "Unsaved changes — editing today's chart"
                : "Unsaved changes — will save as a new visit record"
              : lastSavedKind === "new_visit"
                ? "Saved as a new visit record"
                : lastSavedKind === "amended"
                  ? "All changes saved"
                  : parentRecordId
                    ? "Showing today's chart"
                    : "Next save creates a new visit record"}
            {error && (
              <span className="text-semantic-danger ml-2">· {error}</span>
            )}
          </span>
          <button
            type="button"
            onClick={() => { void save(); }}
            disabled={saving || !dirty}
            className="px-4 py-2 rounded-lg bg-tone-ink text-tone-surface text-sm font-medium hover:bg-tone-ink/90 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {saving ? "Saving…" : "Save chart"}
          </button>
        </div>
      )}

      {/* Charting history (Q2) */}
      <div className="mt-5 pt-4 border-t border-grey-10 print:hidden">
        <button
          type="button"
          onClick={() => {
            const next = !historyOpen;
            setHistoryOpen(next);
            if (next) void loadHistory();
          }}
          className="text-xs font-medium text-grey-70 hover:text-tone-ink flex items-center gap-1"
        >
          <span className={`inline-block transition-transform ${historyOpen ? "rotate-90" : ""}`}>›</span>
          {historyOpen ? "Hide" : "Show"} charting history
        </button>
        {historyOpen && (
          <div className="mt-3">
            {historyLoading && (
              <p className="text-xs text-grey-45">Loading history…</p>
            )}
            {!historyLoading && history && history.length === 0 && (
              <p className="text-xs text-grey-45">No saved charts yet.</p>
            )}
            {!historyLoading && history && history.length > 0 && (
              <ul className="space-y-1">
                {history.map((h, idx) => {
                  const isLatest = idx === 0 && !isViewingHistorical;
                  const isCurrentlyViewing = h.clinical_record_id === viewingHistoricalRecordId;
                  return (
                    <li key={h.id}>
                      <button
                        type="button"
                        onClick={() => {
                          if (idx === 0 && !isViewingHistorical) return; // already on it
                          if (idx === 0) returnToLatest();
                          else viewHistoricalSnapshot(h.clinical_record_id);
                        }}
                        className={`w-full flex items-center justify-between gap-3 px-3 py-2 rounded-lg text-left text-xs transition-colors ${
                          isCurrentlyViewing
                            ? "bg-tone-sage/10 text-tone-ink"
                            : isLatest
                              ? "bg-grey-5 text-tone-ink"
                              : "text-grey-70 hover:bg-grey-5"
                        }`}
                      >
                        <span className="flex-1">
                          {new Date(h.created_at).toLocaleString("en-SG", {
                            day: "numeric",
                            month: "short",
                            year: "numeric",
                            hour: "numeric",
                            minute: "2-digit",
                          })}
                          <span className="text-grey-45 ml-2">· {h.recorded_by_name}</span>
                        </span>
                        <span className="text-grey-45">{h.tooth_count} teeth</span>
                        {isLatest && (
                          <span className="text-[10px] uppercase tracking-wider text-tone-sage font-medium">
                            Latest
                          </span>
                        )}
                        {isCurrentlyViewing && !isLatest && (
                          <span className="text-[10px] uppercase tracking-wider text-tone-sage font-medium">
                            Viewing
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </div>

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
