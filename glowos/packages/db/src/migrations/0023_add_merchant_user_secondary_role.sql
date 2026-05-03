-- Migration 0023: secondary role on merchant_users
--
-- Some staff genuinely hold two roles — a clinician who is also the
-- manager or owner of the firm, for example. The original single-role
-- column forced a choice that misrepresents their authority and locks
-- them out of either the clinical-record UI or the operational settings.
--
-- This migration adds an optional `secondary_role` column. When set,
-- the user's effective permissions are the UNION of both roles' grants
-- (computed in the application layer — see services/api/src/middleware/
-- auth.ts). NULL is the default and means "no secondary role" — i.e.
-- exactly the prior behaviour.
--
-- Constraints:
--   - secondary_role takes the same enum as role (owner/manager/clinician/staff)
--   - secondary_role MUST differ from role when both are set — having the
--     same role twice is meaningless and would invite confusion.
--
-- No backfill needed — existing rows get NULL and continue to behave
-- exactly as before.

ALTER TABLE merchant_users
  ADD COLUMN secondary_role VARCHAR(20);

ALTER TABLE merchant_users
  ADD CONSTRAINT merchant_users_secondary_role_check
  CHECK (secondary_role IS NULL OR secondary_role IN ('owner', 'manager', 'clinician', 'staff'));

ALTER TABLE merchant_users
  ADD CONSTRAINT merchant_users_secondary_role_distinct
  CHECK (secondary_role IS NULL OR secondary_role <> role);
