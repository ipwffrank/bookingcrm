-- Migration 0022: per-merchant invoice/tax settings + atomic sequence counter
--
-- Adds the merchant-side configuration that the universal receipt/invoice
-- generator (slice 1, this session) reads on every issue. Six new columns
-- on `merchants`:
--
--   - invoice_prefix              — string prepended to the sequential
--     invoice number (e.g. 'LMK' → 'LMK-000001'). Defaults to 'INV'.
--   - tax_label                   — human-readable tax line label shown on
--     the receipt ('GST', 'SST', 'Service Tax'). Null = no tax line.
--   - tax_rate_pct                — tax rate as a percentage (e.g. 8.00).
--   - tax_registration_number     — clinic's GST/SST registration number,
--     printed under the tax label on the receipt.
--   - invoice_footer_text         — clinic-customizable thank-you / terms
--     line printed at the bottom of every receipt.
--   - next_invoice_sequence       — atomic counter. Incremented by
--     `UPDATE merchants SET next_invoice_sequence = next_invoice_sequence + 1
--     WHERE id = $1 RETURNING next_invoice_sequence - 1 AS issued_sequence;`
--     so two simultaneous issuances can't collide on a number. Starts at 1.
--
-- Default invoice format: '{invoice_prefix}-{seq:000000}' (six-digit
-- zero-padded sequence). Format is hard-coded in app for now; merchant
-- configurability can come later via a `invoice_number_format` template.
--
-- All fields are nullable except next_invoice_sequence, which has a
-- default of 1 so existing rows pick up the counter immediately.

ALTER TABLE merchants
  ADD COLUMN invoice_prefix VARCHAR(20) NOT NULL DEFAULT 'INV',
  ADD COLUMN tax_label VARCHAR(20),
  ADD COLUMN tax_rate_pct NUMERIC(5, 2),
  ADD COLUMN tax_registration_number VARCHAR(50),
  ADD COLUMN invoice_footer_text TEXT,
  ADD COLUMN next_invoice_sequence INTEGER NOT NULL DEFAULT 1;

ALTER TABLE merchants
  ADD CONSTRAINT merchants_tax_rate_pct_check
  CHECK (tax_rate_pct IS NULL OR (tax_rate_pct >= 0 AND tax_rate_pct <= 100));

ALTER TABLE merchants
  ADD CONSTRAINT merchants_next_invoice_sequence_check
  CHECK (next_invoice_sequence >= 1);
