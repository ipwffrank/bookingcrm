import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  jsonb,
  numeric,
  smallint,
  boolean,
  char,
  index,
  uniqueIndex,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { merchants } from "./merchants";
import { merchantUsers } from "./merchant-users";
import { clients } from "./clients";
import { bookings } from "./bookings";
import { services } from "./services";

// ─── Enums ───────────────────────────────────────────────────────────────

export const invoiceDocumentType = [
  "invoice",
  "credit_note",
  "debit_note",
  "refund_note",
  "self_billed_invoice",
] as const;
export type InvoiceDocumentType = (typeof invoiceDocumentType)[number];

export const invoiceSubmissionStatus = [
  "draft",        // not yet submitted
  "submitting",   // request in flight
  "submitted",    // accepted by LHDN, awaiting validation
  "valid",        // LHDN validated successfully
  "invalid",      // LHDN rejected on validation
  "cancelled",    // valid invoice subsequently cancelled within window
  "rejected",     // LHDN rejected at submission (auth / format / etc.)
  "failed",       // network / unexpected error — caller can retry
] as const;
export type InvoiceSubmissionStatus = (typeof invoiceSubmissionStatus)[number];

export const myinvoisEnvironment = ["sandbox", "production"] as const;
export type MyInvoisEnvironment = (typeof myinvoisEnvironment)[number];

export const businessRegistrationType = [
  "BRN",       // ROB / ROC business registration number
  "NRIC",      // individual practitioner using NRIC
  "PASSPORT",  // foreign individual
  "ARMY",      // armed forces ID
] as const;
export type BusinessRegistrationType = (typeof businessRegistrationType)[number];

// ─── Tax breakdown shape (stored in invoices.tax_breakdown JSONB) ────────
//
// Per-tax-category roll-up across the invoice's line items. Keys are
// LHDN tax category codes (see `invoiceLineItems.taxCategory` below).
//
//   {
//     "01": { rate: 6,  taxable: 100.00, tax: 6.00 },
//     "02": { rate: 8,  taxable: 250.00, tax: 20.00 },
//     "E":  {            taxable:  50.00, tax: 0    }
//   }
export interface TaxBreakdown {
  [taxCategory: string]: {
    rate?: number;
    taxable: number;
    tax: number;
  };
}

// ─── merchant_myinvois_configs ───────────────────────────────────────────
//
// One row per merchant (unique-on-merchant_id). Holds LHDN credentials,
// environment, and cached access token. CHECK constraint enforces that
// `enabled=true` requires the core identifier fields to be populated.

export const merchantMyinvoisConfigs = pgTable(
  "merchant_myinvois_configs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    merchantId: uuid("merchant_id")
      .notNull()
      .unique()
      .references(() => merchants.id, { onDelete: "cascade" }),

    enabled: boolean("enabled").notNull().default(false),

    environment: varchar("environment", { length: 20 })
      .notNull()
      .default("sandbox")
      .$type<MyInvoisEnvironment>(),

    tin: varchar("tin", { length: 20 }),
    businessRegistrationNumber: varchar("business_registration_number", { length: 50 }),
    businessRegistrationType: varchar("business_registration_type", { length: 20 })
      .$type<BusinessRegistrationType>(),

    sstRegistrationNumber: varchar("sst_registration_number", { length: 50 }),
    tourismTaxRegistrationNumber: varchar("tourism_tax_registration_number", { length: 50 }),

    msicIndustryCode: varchar("msic_industry_code", { length: 10 }),
    businessActivityDescription: text("business_activity_description"),

    // OAuth2 client credentials issued by the LHDN developer portal.
    // Stored plaintext for MVP — same pattern as ipay88; rotation to
    // pgcrypto-encrypted storage is queued tech debt.
    clientId: varchar("client_id", { length: 255 }),
    clientSecret: text("client_secret"),

    // Per-clinic X.509 PFX cert from a Malaysian CA — required to sign
    // every submitted document. Annual renewal; expiry tracked here so
    // we can warn the clinic 30 days out.
    digitalCertificatePfxBase64: text("digital_certificate_pfx_base64"),
    digitalCertificatePassword: text("digital_certificate_password"),
    certSubjectCn: varchar("cert_subject_cn", { length: 255 }),
    certIssuerName: varchar("cert_issuer_name", { length: 255 }),
    certExpiresAt: timestamp("cert_expires_at", { withTimezone: true }),

    cachedAccessToken: text("cached_access_token"),
    tokenExpiresAt: timestamp("token_expires_at", { withTimezone: true }),
    lastTokenRefreshAt: timestamp("last_token_refresh_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdByUserId: uuid("created_by_user_id").references(() => merchantUsers.id, {
      onDelete: "set null",
    }),
    updatedByUserId: uuid("updated_by_user_id").references(() => merchantUsers.id, {
      onDelete: "set null",
    }),
  },
  (t) => ({
    merchantIdx: index("merchant_myinvois_configs_merchant_idx").on(t.merchantId),
  }),
);

// ─── invoices ────────────────────────────────────────────────────────────
//
// Canonical invoice record. Stores both internal audit fields AND
// LHDN-side state. Issuer + buyer are denormalized snapshots so the
// invoice survives later edits. NUMERIC(14, 2) covers up to ~$1T.

export const invoices = pgTable(
  "invoices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    merchantId: uuid("merchant_id")
      .notNull()
      .references(() => merchants.id, { onDelete: "cascade" }),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "restrict" }),

    bookingId: uuid("booking_id").references(() => bookings.id, {
      onDelete: "set null",
    }),

    internalInvoiceNumber: varchar("internal_invoice_number", { length: 50 }).notNull(),

    documentType: varchar("document_type", { length: 30 })
      .notNull()
      .default("invoice")
      .$type<InvoiceDocumentType>(),

    // For credit/debit/refund notes: FK to the original invoice they amend.
    // Self-FK declared via the AnyPgColumn helper to avoid Drizzle's
    // forward-reference complaint on `invoices.id`.
    originalInvoiceId: uuid("original_invoice_id").references(
      (): AnyPgColumn => invoices.id,
      { onDelete: "restrict" },
    ),

    // ─── Issuer (clinic) snapshot ─────────────────────────────────────
    issuerName: varchar("issuer_name", { length: 255 }).notNull(),
    issuerTin: varchar("issuer_tin", { length: 20 }).notNull(),
    issuerBusinessRegistrationNumber: varchar("issuer_business_registration_number", { length: 50 }).notNull(),
    issuerBusinessRegistrationType: varchar("issuer_business_registration_type", { length: 20 })
      .notNull()
      .$type<BusinessRegistrationType>(),
    issuerSstRegistrationNumber: varchar("issuer_sst_registration_number", { length: 50 }),
    issuerMsicCode: varchar("issuer_msic_code", { length: 10 }).notNull(),
    issuerAddressLine1: varchar("issuer_address_line1", { length: 255 }),
    issuerAddressLine2: varchar("issuer_address_line2", { length: 255 }),
    issuerPostalCode: varchar("issuer_postal_code", { length: 10 }),
    issuerCity: varchar("issuer_city", { length: 100 }),
    issuerState: varchar("issuer_state", { length: 50 }),
    issuerCountry: char("issuer_country", { length: 2 }).notNull().default("MY"),
    issuerPhone: varchar("issuer_phone", { length: 20 }),
    // LHDN requires email on every supplier — non-nullable.
    issuerEmail: varchar("issuer_email", { length: 255 }).notNull(),

    // ─── Buyer (client) snapshot ──────────────────────────────────────
    // For private individuals without a TIN, app code substitutes LHDN's
    // generic-individual placeholder ('EI00000000010') at submission
    // time but stores the actual NRIC as buyer_id_number.
    buyerName: varchar("buyer_name", { length: 255 }).notNull(),
    buyerTin: varchar("buyer_tin", { length: 20 }),
    buyerIdType: varchar("buyer_id_type", { length: 20 }).$type<BusinessRegistrationType>(),
    buyerIdNumber: varchar("buyer_id_number", { length: 50 }),
    buyerAddressLine1: varchar("buyer_address_line1", { length: 255 }),
    buyerAddressLine2: varchar("buyer_address_line2", { length: 255 }),
    buyerPostalCode: varchar("buyer_postal_code", { length: 10 }),
    buyerCity: varchar("buyer_city", { length: 100 }),
    buyerState: varchar("buyer_state", { length: 50 }),
    buyerCountry: char("buyer_country", { length: 2 }).default("MY"),
    buyerPhone: varchar("buyer_phone", { length: 20 }),
    buyerEmail: varchar("buyer_email", { length: 255 }),

    // ─── Document metadata ────────────────────────────────────────────
    currency: char("currency", { length: 3 }).notNull().default("MYR"),
    exchangeRate: numeric("exchange_rate", { precision: 10, scale: 6 }).notNull().default("1.0"),
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
    paymentMode: varchar("payment_mode", { length: 20 }),
    paymentTerms: text("payment_terms"),

    // ─── Totals ───────────────────────────────────────────────────────
    subtotalAmount: numeric("subtotal_amount", { precision: 14, scale: 2 }).notNull().default("0"),
    taxAmount: numeric("tax_amount", { precision: 14, scale: 2 }).notNull().default("0"),
    discountAmount: numeric("discount_amount", { precision: 14, scale: 2 }).notNull().default("0"),
    totalAmount: numeric("total_amount", { precision: 14, scale: 2 }).notNull().default("0"),
    taxBreakdown: jsonb("tax_breakdown").$type<TaxBreakdown>(),

    // ─── LHDN submission state ────────────────────────────────────────
    submissionStatus: varchar("submission_status", { length: 20 })
      .notNull()
      .default("draft")
      .$type<InvoiceSubmissionStatus>(),
    environment: varchar("environment", { length: 20 })
      .notNull()
      .default("sandbox")
      .$type<MyInvoisEnvironment>(),

    // LHDN returns TWO ids on submission: a batch-level submissionUid
    // (covers all docs in one POST) and a per-document uuid. We store
    // both — submissionUid is what we poll for status; uuid identifies
    // the specific invoice for cancel / refund-note linking.
    lhdnSubmissionUid: varchar("lhdn_submission_uid", { length: 50 }),
    lhdnUuid: varchar("lhdn_uuid", { length: 50 }),
    // The "longId" returned alongside the uuid after validation — combined
    // into the public-validation URL used in the QR code.
    lhdnLongId: varchar("lhdn_long_id", { length: 100 }),
    // Computed once we have uuid + longId:
    //   {portal}/{uuid}/share/{longId}
    lhdnQrUrl: text("lhdn_qr_url"),

    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    validatedAt: timestamp("validated_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancellationReason: text("cancellation_reason"),

    lhdnErrorCode: varchar("lhdn_error_code", { length: 50 }),
    lhdnErrorMessage: text("lhdn_error_message"),

    // LHDN accepts JSON or XML; default flow is JSON (UBL 2.1 mapped
    // to JSON per LHDN spec). Stored for resubmission, audit, debug.
    submittedDocumentPayload: text("submitted_document_payload"),
    // SHA-256 (hex, lowercase) of the canonical minified signed payload.
    // Sent in `documentHash` of the submit body; LHDN re-hashes and
    // rejects on mismatch — canonicalization is unforgiving.
    documentHash: varchar("document_hash", { length: 128 }),
    lhdnResponsePayload: jsonb("lhdn_response_payload"),

    lastStatusCheckAt: timestamp("last_status_check_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdByUserId: uuid("created_by_user_id").references(() => merchantUsers.id, {
      onDelete: "set null",
    }),
  },
  (t) => ({
    merchantInternalNumberUnique: uniqueIndex("invoices_merchant_internal_number_unique")
      .on(t.merchantId, t.internalInvoiceNumber),
    merchantStatusIdx: index("invoices_merchant_status_idx").on(
      t.merchantId,
      t.submissionStatus,
      t.issuedAt,
    ),
    merchantIssuedAtIdx: index("invoices_merchant_issued_at_idx").on(
      t.merchantId,
      t.issuedAt,
    ),
    clientIdx: index("invoices_client_idx").on(t.clientId, t.issuedAt),
    bookingIdx: index("invoices_booking_idx").on(t.bookingId),
  }),
);

// ─── invoice_line_items ──────────────────────────────────────────────────

export const invoiceLineItems = pgTable(
  "invoice_line_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => invoices.id, { onDelete: "cascade" }),
    lineNumber: smallint("line_number").notNull(),

    serviceId: uuid("service_id").references(() => services.id, {
      onDelete: "set null",
    }),
    bookingId: uuid("booking_id").references(() => bookings.id, {
      onDelete: "set null",
    }),

    description: varchar("description", { length: 500 }).notNull(),
    classificationCode: varchar("classification_code", { length: 10 }),

    quantity: numeric("quantity", { precision: 12, scale: 4 }).notNull().default("1"),
    unitOfMeasure: varchar("unit_of_measure", { length: 10 }),
    unitPrice: numeric("unit_price", { precision: 14, scale: 4 }).notNull(),
    subtotal: numeric("subtotal", { precision: 14, scale: 2 }).notNull(),
    discountAmount: numeric("discount_amount", { precision: 14, scale: 2 }).notNull().default("0"),

    // Tax category codes per LHDN:
    //   '01' = Sales Tax  · '02' = Service Tax · '03' = Tourism Tax
    //   '04' = High-Value Goods Tax · 'E' = Exempt · 'Z' = Zero-rated
    taxCategory: varchar("tax_category", { length: 10 }).notNull().default("E"),
    taxRatePct: numeric("tax_rate_pct", { precision: 6, scale: 3 }).notNull().default("0"),
    taxAmount: numeric("tax_amount", { precision: 14, scale: 2 }).notNull().default("0"),
    totalAmount: numeric("total_amount", { precision: 14, scale: 2 }).notNull(),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    invoiceLineUnique: uniqueIndex("invoice_line_items_invoice_line_unique").on(
      t.invoiceId,
      t.lineNumber,
    ),
    invoiceIdx: index("invoice_line_items_invoice_idx").on(t.invoiceId, t.lineNumber),
    serviceIdx: index("invoice_line_items_service_idx").on(t.serviceId),
  }),
);
