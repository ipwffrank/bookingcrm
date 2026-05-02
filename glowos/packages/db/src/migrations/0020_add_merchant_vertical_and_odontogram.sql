-- Migration 0020: vertical-aware clinical records + dental odontogram
--
-- Adds a `vertical` column to `merchants` so the clinical-record UI can
-- gate vertical-specific modules (odontogram for dental, body chart for
-- aesthetic — future, skin atlas for derma — future).
--
-- Adds `clinical_record_odontograms` to store FDI-numbered tooth charting
-- per the Malaysian Dental Council 2024 record-keeping mandate. One row
-- per snapshot (typically one per clinical_records row of type
-- 'consultation_note' or 'treatment_log').
--
-- The dental-only constraint is enforced at the API layer (the route
-- handler reads merchant.vertical before allowing INSERT). No SQL trigger
-- — keeps the migration simple and matches GlowOS's existing pattern of
-- enforcing cross-table invariants in code.

-- ─── 1. merchants.vertical ───────────────────────────────────────────────
ALTER TABLE merchants
  ADD COLUMN vertical VARCHAR(20);

ALTER TABLE merchants
  ADD CONSTRAINT merchants_vertical_check
  CHECK (vertical IS NULL OR vertical IN (
    'dental',
    'aesthetic',
    'dermatology',
    'spa',
    'general_medical'
  ));

CREATE INDEX merchants_vertical_idx
  ON merchants(vertical)
  WHERE vertical IS NOT NULL;

-- Backfill: existing merchants stay NULL until manually classified by
-- the owner (via a new field on the merchant settings page) or by a
-- super-admin during onboarding. Aura Aesthetic & Laser would be set
-- to 'aesthetic' once the field is in production.

-- ─── 2. clinical_record_odontograms ──────────────────────────────────────
CREATE TABLE clinical_record_odontograms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Tied to the parent clinical_records row so the odontogram inherits
  -- the same audit context (recorded by, recorded at, amendment chain).
  clinical_record_id UUID NOT NULL
    REFERENCES clinical_records(id) ON DELETE CASCADE,

  -- Denormalized merchant + client for direct queries (e.g. "show all
  -- odontograms for client X across visits") without join.
  merchant_id UUID NOT NULL
    REFERENCES merchants(id) ON DELETE CASCADE,
  client_id UUID NOT NULL
    REFERENCES clients(id) ON DELETE CASCADE,

  -- Per-tooth charting. Keys = FDI two-digit codes (11-48 permanent,
  -- 51-85 primary). Value shape (validated at API layer):
  --   {
  --     whole?: 'present' | 'missing' | 'extracted' | 'extraction_indicated' |
  --             'unerupted' | 'erupting' | 'crown' | 'rct' | 'rct_crown' |
  --             'implant' | 'bridge_pontic' | 'bridge_abutment' | 'veneer',
  --     surfaces?: { M?: SurfaceCondition[], D?: ..., O?: ..., I?: ..., B?: ..., L?: ... },
  --     notes?: string  -- per-tooth narrative
  --   }
  -- Surface codes: M=mesial, D=distal, O=occlusal (post.), I=incisal (ant.),
  -- B=buccal/labial, L=lingual/palatal.
  -- Surface conditions: caries · amalgam · composite · gic · sealant ·
  -- fracture · attrition · erosion · recession · plaque · calculus.
  charting JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Periodontal probing depths in mm. Optional; populated only for perio
  -- assessments. Shape:
  --   {
  --     [fdi]: {
  --       mesial_buccal: number, mid_buccal: number, distal_buccal: number,
  --       mesial_lingual: number, mid_lingual: number, distal_lingual: number,
  --       bop?: { mb?: bool, b?: bool, db?: bool, ml?: bool, l?: bool, dl?: bool },
  --       recession?: { mb?: number, ... }
  --     }
  --   }
  perio_probing JSONB,

  -- Free-text notes specific to the chart (separate from
  -- clinical_records.body which carries the consultation narrative).
  charting_notes TEXT,

  -- Author identity, denormalized so it survives merchant_users deletion.
  recorded_by_user_id UUID REFERENCES merchant_users(id) ON DELETE SET NULL,
  recorded_by_name VARCHAR(255) NOT NULL,
  recorded_by_email VARCHAR(255) NOT NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Lookup by parent clinical record (UI loads the odontogram alongside the record).
CREATE INDEX clinical_record_odontograms_record_idx
  ON clinical_record_odontograms(clinical_record_id);

-- Cross-visit history for a client.
CREATE INDEX clinical_record_odontograms_client_idx
  ON clinical_record_odontograms(merchant_id, client_id, created_at);

-- One odontogram per parent clinical_records row. (Amendments create a
-- new clinical_records row with amends_id set, and that new row gets
-- its own odontogram.) Simpler than many-to-one and matches MDC's
-- "snapshot per visit" expectation.
CREATE UNIQUE INDEX clinical_record_odontograms_unique_per_record
  ON clinical_record_odontograms(clinical_record_id);
