CREATE TABLE IF NOT EXISTS "clinical_record_access_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"merchant_id" uuid NOT NULL,
	"record_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"user_id" uuid,
	"user_email" varchar(255) NOT NULL,
	"action" varchar(20) NOT NULL,
	"ip_address" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "clinical_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"merchant_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"type" varchar(40) NOT NULL,
	"title" varchar(255),
	"body" text NOT NULL,
	"service_id" uuid,
	"booking_id" uuid,
	"recorded_by_user_id" uuid,
	"recorded_by_name" varchar(255) NOT NULL,
	"recorded_by_email" varchar(255) NOT NULL,
	"amends_id" uuid,
	"amendment_reason" text,
	"attachments" jsonb,
	"signed_consent" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "clinical_record_access_log" ADD CONSTRAINT "clinical_record_access_log_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "clinical_record_access_log" ADD CONSTRAINT "clinical_record_access_log_record_id_clinical_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."clinical_records"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "clinical_record_access_log" ADD CONSTRAINT "clinical_record_access_log_user_id_merchant_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."merchant_users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "clinical_records" ADD CONSTRAINT "clinical_records_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "clinical_records" ADD CONSTRAINT "clinical_records_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "clinical_records" ADD CONSTRAINT "clinical_records_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "clinical_records" ADD CONSTRAINT "clinical_records_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "clinical_records" ADD CONSTRAINT "clinical_records_recorded_by_user_id_merchant_users_id_fk" FOREIGN KEY ("recorded_by_user_id") REFERENCES "public"."merchant_users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "clinical_record_access_log_record_idx" ON "clinical_record_access_log" ("record_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "clinical_record_access_log_client_idx" ON "clinical_record_access_log" ("merchant_id","client_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "clinical_records_client_idx" ON "clinical_records" ("merchant_id","client_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "clinical_records_amends_idx" ON "clinical_records" ("amends_id");