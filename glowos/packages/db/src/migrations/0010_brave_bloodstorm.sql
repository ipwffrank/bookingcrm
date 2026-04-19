CREATE TABLE IF NOT EXISTS "booking_edits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid,
	"booking_group_id" uuid,
	"edited_by_user_id" uuid NOT NULL,
	"edited_by_role" varchar(20) NOT NULL,
	"field_name" text NOT NULL,
	"old_value" jsonb,
	"new_value" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "booking_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"merchant_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"total_price_sgd" numeric(10, 2) NOT NULL,
	"payment_method" varchar(20) NOT NULL,
	"notes" text,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "group_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "booking_edits" ADD CONSTRAINT "booking_edits_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "booking_edits" ADD CONSTRAINT "booking_edits_booking_group_id_booking_groups_id_fk" FOREIGN KEY ("booking_group_id") REFERENCES "public"."booking_groups"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "booking_edits" ADD CONSTRAINT "booking_edits_edited_by_user_id_merchant_users_id_fk" FOREIGN KEY ("edited_by_user_id") REFERENCES "public"."merchant_users"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "booking_groups" ADD CONSTRAINT "booking_groups_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "booking_groups" ADD CONSTRAINT "booking_groups_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "booking_groups" ADD CONSTRAINT "booking_groups_created_by_user_id_merchant_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."merchant_users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "booking_edits_booking_idx" ON "booking_edits" ("booking_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "booking_edits_group_idx" ON "booking_edits" ("booking_group_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "booking_groups_merchant_idx" ON "booking_groups" ("merchant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "booking_groups_client_idx" ON "booking_groups" ("client_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bookings_group_idx" ON "bookings" ("group_id");
DO $$ BEGIN
 ALTER TABLE "bookings" ADD CONSTRAINT "bookings_group_id_booking_groups_id_fk"
   FOREIGN KEY ("group_id") REFERENCES "booking_groups"("id")
   ON DELETE SET NULL ON UPDATE NO ACTION;
EXCEPTION
 WHEN duplicate_object THEN NULL;
END $$;