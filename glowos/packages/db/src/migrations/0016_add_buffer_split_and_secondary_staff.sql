ALTER TABLE "services" ADD COLUMN "pre_buffer_minutes" integer DEFAULT 0 NOT NULL;
ALTER TABLE "services" ADD COLUMN "post_buffer_minutes" integer DEFAULT 0 NOT NULL;
ALTER TABLE "bookings" ADD COLUMN "secondary_staff_id" uuid;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_secondary_staff_id_staff_id_fk" FOREIGN KEY ("secondary_staff_id") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;
