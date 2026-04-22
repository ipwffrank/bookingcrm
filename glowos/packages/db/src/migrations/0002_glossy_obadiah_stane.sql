CREATE TABLE IF NOT EXISTS "super_admin_audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_user_id" uuid,
	"actor_email" varchar(255) NOT NULL,
	"action" varchar(40) NOT NULL,
	"target_merchant_id" uuid,
	"method" varchar(10),
	"path" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "whatsapp_inbound_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"merchant_id" uuid,
	"from_phone" varchar(20) NOT NULL,
	"body" text NOT NULL,
	"matched_client_id" uuid,
	"twilio_message_sid" varchar(255),
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "whatsapp_inbound_log_twilio_message_sid_unique" UNIQUE("twilio_message_sid")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "super_admin_audit_log" ADD CONSTRAINT "super_admin_audit_log_actor_user_id_merchant_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."merchant_users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "super_admin_audit_log" ADD CONSTRAINT "super_admin_audit_log_target_merchant_id_merchants_id_fk" FOREIGN KEY ("target_merchant_id") REFERENCES "public"."merchants"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "whatsapp_inbound_log" ADD CONSTRAINT "whatsapp_inbound_log_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "whatsapp_inbound_log" ADD CONSTRAINT "whatsapp_inbound_log_matched_client_id_clients_id_fk" FOREIGN KEY ("matched_client_id") REFERENCES "public"."clients"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "saal_actor_idx" ON "super_admin_audit_log" ("actor_user_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "saal_target_idx" ON "super_admin_audit_log" ("target_merchant_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "wil_merchant_received_idx" ON "whatsapp_inbound_log" ("merchant_id","received_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "wil_from_phone_idx" ON "whatsapp_inbound_log" ("from_phone");