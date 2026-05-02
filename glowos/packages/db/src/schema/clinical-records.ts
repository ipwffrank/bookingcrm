import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { merchants } from "./merchants";
import { clients } from "./clients";
import { merchantUsers } from "./merchant-users";
import { services } from "./services";
import { bookings } from "./bookings";

export const clinicalRecordType = [
  "consultation_note",
  "treatment_log",
  "prescription",
  "amendment",
] as const;
export type ClinicalRecordType = (typeof clinicalRecordType)[number];

// Immutable, append-only clinical records. Hard delete is intentionally
// disallowed at the application layer to comply with MY/SG private healthcare
// retention rules (7-year minimum). Amendments create a NEW row whose
// amendsId points at the row being amended; reading code surfaces the most
// recent revision but the chain is preserved.
export const clinicalRecords = pgTable(
  "clinical_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    merchantId: uuid("merchant_id")
      .notNull()
      .references(() => merchants.id, { onDelete: "cascade" }),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    type: varchar("type", { length: 40 })
      .notNull()
      .$type<ClinicalRecordType>(),
    title: varchar("title", { length: 255 }),
    body: text("body").notNull(),
    serviceId: uuid("service_id").references(() => services.id, {
      onDelete: "set null",
    }),
    bookingId: uuid("booking_id").references(() => bookings.id, {
      onDelete: "set null",
    }),
    // Author identity, denormalized so it survives merchant_users deletion.
    recordedByUserId: uuid("recorded_by_user_id").references(
      () => merchantUsers.id,
      { onDelete: "set null" },
    ),
    recordedByName: varchar("recorded_by_name", { length: 255 }).notNull(),
    recordedByEmail: varchar("recorded_by_email", { length: 255 }).notNull(),
    // Amendment chain. When non-null, this row replaces the data on the
    // referenced prior row. amendmentReason MUST be set when amendsId is set.
    amendsId: uuid("amends_id"),
    amendmentReason: text("amendment_reason"),
    // Future-proofing for photos + consent forms; nullable for now.
    attachments: jsonb("attachments"),
    signedConsent: jsonb("signed_consent"),
    // Set once a consent form is submitted; locks the record from further writes.
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    clientIdx: index("clinical_records_client_idx").on(
      t.merchantId,
      t.clientId,
      t.createdAt,
    ),
    amendsIdx: index("clinical_records_amends_idx").on(t.amendsId),
  }),
);

// Append-only access log. Every read of a clinical record (one entry per
// distinct record per request) and every write get one row. Used by the
// per-merchant audit-trail UI; satisfies PDPA "who accessed what when"
// requirement for healthcare data.
export const clinicalRecordAccessLog = pgTable(
  "clinical_record_access_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    merchantId: uuid("merchant_id")
      .notNull()
      .references(() => merchants.id, { onDelete: "cascade" }),
    recordId: uuid("record_id")
      .notNull()
      .references(() => clinicalRecords.id, { onDelete: "cascade" }),
    clientId: uuid("client_id").notNull(),
    userId: uuid("user_id").references(() => merchantUsers.id, {
      onDelete: "set null",
    }),
    userEmail: varchar("user_email", { length: 255 }).notNull(),
    action: varchar("action", { length: 20 })
      .notNull()
      .$type<"read" | "write" | "amend">(),
    ipAddress: varchar("ip_address", { length: 64 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    recordIdx: index("clinical_record_access_log_record_idx").on(
      t.recordId,
      t.createdAt,
    ),
    clientIdx: index("clinical_record_access_log_client_idx").on(
      t.merchantId,
      t.clientId,
      t.createdAt,
    ),
  }),
);

// ─── Dental odontogram (MDC 2024) ────────────────────────────────────────
// Structured FDI charting per Malaysian Dental Council 2024 mandate.
// One row per parent clinical_records row (snapshot per visit). Amendments
// to the parent create a new clinical_records row with amendsId set; that
// new row gets its own odontogram. Editing in place is intentionally not
// supported — the access log + amendment chain is the digital equivalent
// of MDC's "struck-through corrections initialled" rule.

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
  | "present"               // default; tooth present and unmodified
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

export const clinicalRecordOdontograms = pgTable(
  "clinical_record_odontograms",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicalRecordId: uuid("clinical_record_id")
      .notNull()
      .references(() => clinicalRecords.id, { onDelete: "cascade" }),
    merchantId: uuid("merchant_id")
      .notNull()
      .references(() => merchants.id, { onDelete: "cascade" }),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),

    charting: jsonb("charting").notNull().$type<OdontogramCharting>(),
    perioProbing: jsonb("perio_probing").$type<PerioProbingChart>(),
    chartingNotes: text("charting_notes"),

    recordedByUserId: uuid("recorded_by_user_id").references(
      () => merchantUsers.id,
      { onDelete: "set null" },
    ),
    recordedByName: varchar("recorded_by_name", { length: 255 }).notNull(),
    recordedByEmail: varchar("recorded_by_email", { length: 255 }).notNull(),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    recordIdx: index("clinical_record_odontograms_record_idx").on(t.clinicalRecordId),
    clientIdx: index("clinical_record_odontograms_client_idx").on(
      t.merchantId,
      t.clientId,
      t.createdAt,
    ),
    uniquePerRecord: uniqueIndex("clinical_record_odontograms_unique_per_record")
      .on(t.clinicalRecordId),
  }),
);
