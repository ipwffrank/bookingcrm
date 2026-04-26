import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  jsonb,
  index,
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
