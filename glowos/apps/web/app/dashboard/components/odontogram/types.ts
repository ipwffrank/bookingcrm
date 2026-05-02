// Odontogram types. Mirror of `packages/db/src/schema/clinical-records.ts`
// odontogram exports. The web app doesn't depend on `@glowos/db` so we
// duplicate the type definitions here. Keep this file in sync with the
// backend schema when adding new whole-tooth statuses or surface conditions.

// FDI two-digit numbering (ISO 3950).
//   Permanent: 11–18 (upper right), 21–28 (upper left),
//              31–38 (lower left), 41–48 (lower right).
//   Primary:   51–55 / 61–65 / 71–75 / 81–85.
export type FdiPermanent =
  | "11" | "12" | "13" | "14" | "15" | "16" | "17" | "18"
  | "21" | "22" | "23" | "24" | "25" | "26" | "27" | "28"
  | "31" | "32" | "33" | "34" | "35" | "36" | "37" | "38"
  | "41" | "42" | "43" | "44" | "45" | "46" | "47" | "48";

export type FdiPrimary =
  | "51" | "52" | "53" | "54" | "55"
  | "61" | "62" | "63" | "64" | "65"
  | "71" | "72" | "73" | "74" | "75"
  | "81" | "82" | "83" | "84" | "85";

export type FdiCode = FdiPermanent | FdiPrimary;

// Surface codes:
//   M = mesial · D = distal · O = occlusal (posterior) · I = incisal (anterior)
//   B = buccal/labial · L = lingual/palatal
export type SurfaceCode = "M" | "D" | "O" | "I" | "B" | "L";

export type WholeToothStatus =
  | "present"
  | "missing"
  | "extracted"
  | "extraction_indicated"
  | "unerupted"
  | "erupting"
  | "crown"
  | "rct"
  | "rct_crown"
  | "implant"
  | "bridge_pontic"
  | "bridge_abutment"
  | "veneer";

export type SurfaceCondition =
  | "caries"
  | "amalgam"
  | "composite"
  | "gic"
  | "sealant"
  | "fracture"
  | "attrition"
  | "erosion"
  | "recession"
  | "plaque"
  | "calculus";

export interface ToothChart {
  whole?: WholeToothStatus;
  surfaces?: Partial<Record<SurfaceCode, SurfaceCondition[]>>;
  notes?: string;
}

export type OdontogramCharting = Partial<Record<FdiCode, ToothChart>>;

export interface PerioProbingMeasurements {
  mesial_buccal: number;
  mid_buccal: number;
  distal_buccal: number;
  mesial_lingual: number;
  mid_lingual: number;
  distal_lingual: number;
  bop?: Partial<Record<"mb" | "b" | "db" | "ml" | "l" | "dl", boolean>>;
  recession?: Partial<Record<"mb" | "b" | "db" | "ml" | "l" | "dl", number>>;
}

export type PerioProbingChart = Partial<Record<FdiCode, PerioProbingMeasurements>>;
