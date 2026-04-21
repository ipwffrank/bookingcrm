CREATE TABLE "waitlist" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "merchant_id" uuid NOT NULL REFERENCES "merchants"("id") ON DELETE CASCADE,
  "client_id"   uuid NOT NULL REFERENCES "clients"("id")   ON DELETE CASCADE,
  "service_id"  uuid NOT NULL REFERENCES "services"("id")  ON DELETE RESTRICT,
  "staff_id"    uuid NOT NULL REFERENCES "staff"("id")     ON DELETE RESTRICT,
  "target_date" date NOT NULL,
  "window_start" varchar(5) NOT NULL,
  "window_end"   varchar(5) NOT NULL,
  "status" varchar(20) NOT NULL DEFAULT 'pending',
  "notified_at" timestamp with time zone,
  "hold_expires_at" timestamp with time zone,
  "notified_booking_slot_id" uuid,
  "cancel_token" varchar(64) NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX "waitlist_merchant_idx" ON "waitlist" ("merchant_id");
CREATE INDEX "waitlist_match_idx" ON "waitlist"
  ("merchant_id", "staff_id", "target_date", "status");
