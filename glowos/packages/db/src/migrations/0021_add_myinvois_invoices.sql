-- Migration 0021: MyInvois (LHDN e-invoicing) integration scaffold
--
-- Three new tables to support LHDN MyInvois compliance for Malaysian
-- clinics under PR-shipped this Saturday:
--
--   1. merchant_myinvois_configs — per-merchant LHDN settings (TIN,
--      registration number, OAuth2 creds, sandbox/prod toggle, cached
--      access token). One row per merchant, unique-on-merchant_id.
--
--   2. invoices — the canonical invoice record. Stores both our internal
--      audit fields AND the LHDN-side state (UUID, submission status,
--      document hash, last error). Issuer + buyer details are denormalized
--      snapshots so the invoice survives later edits to merchant or
--      client rows. Deliberately keeps `merchant_id` (NOT `vertical`-gated
--      at the schema level) — a future non-MY merchant could use the
--      same table for plain printed receipts; the LHDN-specific columns
--      are nullable so non-LHDN invoices coexist cleanly.
--
--   3. invoice_line_items — separate table (rather than JSONB column on
--      invoices) so per-line analytics + tax breakdown reporting stays
--      queryable without JSONB extraction.
--
-- Document types supported: invoice (regular), credit_note (refunds),
-- debit_note (additional charges), refund_note, self_billed_invoice
-- (clinic paying a contractor). MVP only ships the regular invoice flow;
-- the schema accepts the others so they ship without future migrations.
--
-- Submission statuses follow the LHDN-side state machine:
--   draft → submitting → submitted → (valid | invalid | rejected)
--                                 ↘ failed (network/API error)
--   valid → cancelled (within LHDN's cancellation window)

-- ─── 1. merchant_myinvois_configs ────────────────────────────────────────
CREATE TABLE merchant_myinvois_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID NOT NULL UNIQUE
    REFERENCES merchants(id) ON DELETE CASCADE,

  -- Master toggle. When false, no submissions fire even if the rest is
  -- configured. Lets a clinic pause MyInvois without losing creds.
  enabled BOOLEAN NOT NULL DEFAULT false,

  -- 'sandbox' for testing against api.myinvois.hasil.gov.my pre-prod;
  -- 'production' for real submissions to api.myinvois.hasil.gov.my.
  environment VARCHAR(20) NOT NULL DEFAULT 'sandbox',

  -- Tax Identification Number (TIN). LHDN-issued, format varies by
  -- entity type. Required when enabled. Validated at the API layer.
  tin VARCHAR(20),

  -- Business registration number — ROB (sole prop / partnership) or
  -- ROC (Sdn Bhd / company). For individual practitioners, can be
  -- the NRIC instead, in which case business_registration_type='NRIC'.
  business_registration_number VARCHAR(50),
  business_registration_type VARCHAR(20),

  -- Optional secondary registrations for tax handling.
  sst_registration_number VARCHAR(50),
  tourism_tax_registration_number VARCHAR(50),

  -- MSIC industry classification code per LHDN. Dental clinic = 86202;
  -- Other personal services (aesthetic) = 96090. Required for submission.
  msic_industry_code VARCHAR(10),

  -- Free-text business activity description as filed with LHDN.
  business_activity_description TEXT,

  -- OAuth2 client credentials issued to the clinic by the MyInvois
  -- developer portal (https://sdk.myinvois.hasil.gov.my/). MVP stores
  -- as plaintext — same approach as ipay88 keys; rotation to encrypted
  -- storage is queued tech debt (PDPA pgcrypto roadmap).
  client_id VARCHAR(255),
  client_secret TEXT,

  -- Per-clinic X.509 digital certificate (PFX/PKCS#12) issued by a
  -- Malaysian CA — MSC Trustgate, Pos Digicert, DigiCert MY, or
  -- GlobalSign. Required for signing all submitted documents.
  -- ~RM150–300/year, 1–4 week procurement lead time per clinic.
  -- Annual renewal — schema captures expiry so we can warn 30 days out.
  -- Stored base64-encoded; PDPA-grade encryption (pgcrypto) is queued
  -- tech debt — ipay88 keys use the same plaintext-MVP pattern.
  digital_certificate_pfx_base64 TEXT,
  digital_certificate_password TEXT,
  cert_subject_cn VARCHAR(255),
  cert_issuer_name VARCHAR(255),
  cert_expires_at TIMESTAMPTZ,

  -- Cached access token to avoid re-authenticating on every submission.
  -- Refreshed when expires_at is within 60 seconds of now.
  cached_access_token TEXT,
  token_expires_at TIMESTAMPTZ,
  last_token_refresh_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by_user_id UUID REFERENCES merchant_users(id) ON DELETE SET NULL,
  updated_by_user_id UUID REFERENCES merchant_users(id) ON DELETE SET NULL
);

ALTER TABLE merchant_myinvois_configs
  ADD CONSTRAINT merchant_myinvois_configs_environment_check
  CHECK (environment IN ('sandbox', 'production'));

ALTER TABLE merchant_myinvois_configs
  ADD CONSTRAINT merchant_myinvois_configs_business_registration_type_check
  CHECK (
    business_registration_type IS NULL
    OR business_registration_type IN ('BRN', 'NRIC', 'PASSPORT', 'ARMY')
  );

-- When enabled=true the core identifiers must be present. App-layer
-- enforcement is primary, but a CHECK gives us belt + braces.
ALTER TABLE merchant_myinvois_configs
  ADD CONSTRAINT merchant_myinvois_configs_enabled_requires_creds
  CHECK (
    enabled = false
    OR (
      tin IS NOT NULL
      AND business_registration_number IS NOT NULL
      AND business_registration_type IS NOT NULL
      AND msic_industry_code IS NOT NULL
      AND client_id IS NOT NULL
      AND client_secret IS NOT NULL
    )
  );


-- ─── 2. invoices ─────────────────────────────────────────────────────────
CREATE TABLE invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID NOT NULL
    REFERENCES merchants(id) ON DELETE CASCADE,
  client_id UUID NOT NULL
    REFERENCES clients(id) ON DELETE RESTRICT,

  -- Optional link back to the booking that triggered this invoice.
  -- Most invoices come from a booking; manual invoices for products /
  -- standalone services don't have one.
  booking_id UUID REFERENCES bookings(id) ON DELETE SET NULL,

  -- Per-merchant sequential invoice number, generated by the app. LHDN
  -- expects a unique invoice ID per merchant — this is what we send.
  -- Format suggestion: INV-2026-0001 (year + zero-padded sequence).
  internal_invoice_number VARCHAR(50) NOT NULL,

  -- Document type — only 'invoice' on MVP. Schema supports the others
  -- (credit_note, debit_note, refund_note, self_billed_invoice) so they
  -- can be added without future migration.
  document_type VARCHAR(30) NOT NULL DEFAULT 'invoice',

  -- For credit/debit/refund notes: the original invoice they amend.
  original_invoice_id UUID REFERENCES invoices(id) ON DELETE RESTRICT,

  -- ─── Issuer (clinic) snapshot at issue time ────────────────────────────
  -- Denormalized so the invoice's record stays stable if the merchant
  -- later renames itself or updates its TIN. Required by MyInvois audit.
  issuer_name VARCHAR(255) NOT NULL,
  issuer_tin VARCHAR(20) NOT NULL,
  issuer_business_registration_number VARCHAR(50) NOT NULL,
  issuer_business_registration_type VARCHAR(20) NOT NULL,
  issuer_sst_registration_number VARCHAR(50),
  issuer_msic_code VARCHAR(10) NOT NULL,
  issuer_address_line1 VARCHAR(255),
  issuer_address_line2 VARCHAR(255),
  issuer_postal_code VARCHAR(10),
  issuer_city VARCHAR(100),
  issuer_state VARCHAR(50),
  issuer_country CHAR(2) NOT NULL DEFAULT 'MY',
  issuer_phone VARCHAR(20),
  -- LHDN requires an email on every supplier; non-nullable.
  issuer_email VARCHAR(255) NOT NULL,

  -- ─── Buyer (client) snapshot ───────────────────────────────────────────
  -- For private individuals, TIN is often unavailable — LHDN allows a
  -- placeholder TIN ('EI00000000010' = generic individual buyer) when
  -- the buyer hasn't registered. Capture it explicitly so audits show
  -- whether we used the placeholder vs a real TIN.
  buyer_name VARCHAR(255) NOT NULL,
  buyer_tin VARCHAR(20),
  buyer_id_type VARCHAR(20),    -- 'NRIC' | 'BRN' | 'PASSPORT' | 'ARMY'
  buyer_id_number VARCHAR(50),
  buyer_address_line1 VARCHAR(255),
  buyer_address_line2 VARCHAR(255),
  buyer_postal_code VARCHAR(10),
  buyer_city VARCHAR(100),
  buyer_state VARCHAR(50),
  buyer_country CHAR(2) DEFAULT 'MY',
  buyer_phone VARCHAR(20),
  buyer_email VARCHAR(255),

  -- ─── Document metadata ─────────────────────────────────────────────────
  currency CHAR(3) NOT NULL DEFAULT 'MYR',
  -- Exchange rate to MYR. 1.0 for MYR-denominated invoices.
  exchange_rate NUMERIC(10, 6) NOT NULL DEFAULT 1.0,
  issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  payment_mode VARCHAR(20),      -- 'cash' | 'card' | 'eft' | ...
  payment_terms TEXT,            -- "Due on receipt" | "Net 30" | ...

  -- ─── Totals ────────────────────────────────────────────────────────────
  -- Computed from line items at submission time and stored here for
  -- fast queryability. NUMERIC(14,2) handles up to ~$1T per invoice.
  subtotal_amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
  tax_amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
  discount_amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
  total_amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
  -- Per-tax-category breakdown for SST audit. Shape:
  --   { "01": { "rate": 6, "taxable": 100, "tax": 6 }, "E": { "taxable": 50, "tax": 0 } }
  tax_breakdown JSONB,

  -- ─── LHDN submission state ─────────────────────────────────────────────
  submission_status VARCHAR(20) NOT NULL DEFAULT 'draft',
  environment VARCHAR(20) NOT NULL DEFAULT 'sandbox',

  -- LHDN returns TWO ids on submission: a batch-level submissionUid
  -- (covers all documents in one POST) and a per-document uuid. We
  -- store both — submission_uid is what we poll on for status, uuid
  -- identifies the specific invoice for cancel / refund-note linking.
  lhdn_submission_uid VARCHAR(50),
  lhdn_uuid VARCHAR(50),
  -- The "longId" returned alongside the uuid after validation —
  -- combined into the public-validation URL for the QR code.
  lhdn_long_id VARCHAR(100),
  -- Computed once we have uuid + longId:
  --   {portal}/{uuid}/share/{longId}
  -- where portal = preprod.myinvois.hasil.gov.my (sandbox)
  --                or myinvois.hasil.gov.my (production)
  lhdn_qr_url TEXT,

  submitted_at TIMESTAMPTZ,
  validated_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  cancellation_reason TEXT,

  -- Last LHDN error on validation failure / rejection — surfaces in UI
  -- so the dentist knows why the submission failed.
  lhdn_error_code VARCHAR(50),
  lhdn_error_message TEXT,

  -- Cached signed payload — stored for resubmission, audit, and
  -- diagnostic display. LHDN accepts JSON or XML; default flow is
  -- JSON (UBL 2.1 mapped to JSON per LHDN spec). Up to ~300 KB per
  -- doc per LHDN limit.
  submitted_document_payload TEXT,
  -- SHA-256 (hex, lowercase) of the canonical minified signed payload.
  -- Sent in the documentHash field of the submit body; LHDN re-hashes
  -- and rejects on mismatch.
  document_hash VARCHAR(128),
  -- Full last-known LHDN response — submission ack + status payload
  -- + per-line validation feedback. Stored for audit / debug.
  lhdn_response_payload JSONB,

  last_status_check_at TIMESTAMPTZ,

  -- ─── Audit ─────────────────────────────────────────────────────────────
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by_user_id UUID REFERENCES merchant_users(id) ON DELETE SET NULL,

  -- One internal invoice number per merchant.
  CONSTRAINT invoices_merchant_internal_number_unique
    UNIQUE (merchant_id, internal_invoice_number)
);

ALTER TABLE invoices
  ADD CONSTRAINT invoices_document_type_check
  CHECK (document_type IN (
    'invoice',
    'credit_note',
    'debit_note',
    'refund_note',
    'self_billed_invoice'
  ));

ALTER TABLE invoices
  ADD CONSTRAINT invoices_submission_status_check
  CHECK (submission_status IN (
    'draft',
    'submitting',
    'submitted',
    'valid',
    'invalid',
    'cancelled',
    'rejected',
    'failed'
  ));

ALTER TABLE invoices
  ADD CONSTRAINT invoices_environment_check
  CHECK (environment IN ('sandbox', 'production'));

ALTER TABLE invoices
  ADD CONSTRAINT invoices_issuer_business_registration_type_check
  CHECK (issuer_business_registration_type IN ('BRN', 'NRIC', 'PASSPORT', 'ARMY'));

ALTER TABLE invoices
  ADD CONSTRAINT invoices_buyer_id_type_check
  CHECK (
    buyer_id_type IS NULL
    OR buyer_id_type IN ('BRN', 'NRIC', 'PASSPORT', 'ARMY')
  );

CREATE INDEX invoices_merchant_status_idx
  ON invoices(merchant_id, submission_status, issued_at);
CREATE INDEX invoices_merchant_issued_at_idx
  ON invoices(merchant_id, issued_at);
CREATE INDEX invoices_client_idx
  ON invoices(client_id, issued_at);
CREATE INDEX invoices_booking_idx
  ON invoices(booking_id) WHERE booking_id IS NOT NULL;
-- Used by the status-poller to find pending invoices.
CREATE INDEX invoices_pending_check_idx
  ON invoices(submission_status, last_status_check_at)
  WHERE submission_status IN ('submitted', 'submitting');


-- ─── 3. invoice_line_items ───────────────────────────────────────────────
CREATE TABLE invoice_line_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID NOT NULL
    REFERENCES invoices(id) ON DELETE CASCADE,
  -- Within-invoice ordering. Exposed in LHDN payload + UI.
  line_number SMALLINT NOT NULL,

  -- Optional links back to GlowOS catalog entities — useful for analytics
  -- but not required for submission.
  service_id UUID REFERENCES services(id) ON DELETE SET NULL,
  booking_id UUID REFERENCES bookings(id) ON DELETE SET NULL,

  description VARCHAR(500) NOT NULL,
  -- LHDN classification code (5-digit). Required by MyInvois. Default
  -- '022' = Others, but specific codes exist for medical/dental services.
  classification_code VARCHAR(10),

  quantity NUMERIC(12, 4) NOT NULL DEFAULT 1,
  unit_of_measure VARCHAR(10),   -- e.g. 'EA' (each), 'HR', 'SET'
  unit_price NUMERIC(14, 4) NOT NULL,
  subtotal NUMERIC(14, 2) NOT NULL,
  discount_amount NUMERIC(14, 2) NOT NULL DEFAULT 0,

  -- Tax category code per LHDN:
  --   '01' = Sales Tax · '02' = Service Tax · '03' = Tourism Tax
  --   '04' = High-Value Goods Tax · 'E' = Tax exemption · 'Z' = Zero-rated
  tax_category VARCHAR(10) NOT NULL DEFAULT 'E',
  tax_rate_pct NUMERIC(6, 3) NOT NULL DEFAULT 0,
  tax_amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
  total_amount NUMERIC(14, 2) NOT NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- One line number per invoice (no duplicates within an invoice).
  CONSTRAINT invoice_line_items_invoice_line_unique
    UNIQUE (invoice_id, line_number)
);

CREATE INDEX invoice_line_items_invoice_idx
  ON invoice_line_items(invoice_id, line_number);
CREATE INDEX invoice_line_items_service_idx
  ON invoice_line_items(service_id) WHERE service_id IS NOT NULL;
