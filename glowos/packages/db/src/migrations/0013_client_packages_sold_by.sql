ALTER TABLE "client_packages"
  ADD COLUMN "sold_by_staff_id" uuid REFERENCES "staff"("id") ON DELETE SET NULL;
