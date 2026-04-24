CREATE TABLE IF NOT EXISTS "treatment_quotes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"merchant_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"consult_booking_id" uuid,
	"service_id" uuid NOT NULL,
	"service_name" varchar(255) NOT NULL,
	"price_sgd" numeric(10, 2) NOT NULL,
	"notes" text,
	"issued_by_staff_id" uuid,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"valid_until" timestamp with time zone NOT NULL,
	"accept_token" varchar(64) NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"accepted_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"converted_booking_id" uuid,
	"reminder_sent_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancelled_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "treatment_quotes_accept_token_unique" UNIQUE("accept_token")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "treatment_quotes" ADD CONSTRAINT "treatment_quotes_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "treatment_quotes" ADD CONSTRAINT "treatment_quotes_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "treatment_quotes" ADD CONSTRAINT "treatment_quotes_consult_booking_id_bookings_id_fk" FOREIGN KEY ("consult_booking_id") REFERENCES "public"."bookings"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "treatment_quotes" ADD CONSTRAINT "treatment_quotes_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "treatment_quotes" ADD CONSTRAINT "treatment_quotes_issued_by_staff_id_merchant_users_id_fk" FOREIGN KEY ("issued_by_staff_id") REFERENCES "public"."merchant_users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "treatment_quotes" ADD CONSTRAINT "treatment_quotes_converted_booking_id_bookings_id_fk" FOREIGN KEY ("converted_booking_id") REFERENCES "public"."bookings"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tq_merchant_idx" ON "treatment_quotes" ("merchant_id","issued_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tq_client_idx" ON "treatment_quotes" ("client_id","issued_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tq_status_idx" ON "treatment_quotes" ("status","valid_until");