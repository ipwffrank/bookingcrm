CREATE TABLE IF NOT EXISTS "automation_sends" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"automation_id" uuid NOT NULL,
	"merchant_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"booking_id" uuid,
	"dedupe_key" varchar(255) NOT NULL,
	"channel" varchar(20) NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "automation_sends_dedupe_unique" UNIQUE("automation_id","dedupe_key")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "automations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"merchant_id" uuid NOT NULL,
	"kind" varchar(20) NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"message_template" text DEFAULT '' NOT NULL,
	"promo_code" varchar(50),
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_run_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "automations_merchant_kind_unique" UNIQUE("merchant_id","kind")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "automation_sends" ADD CONSTRAINT "automation_sends_automation_id_automations_id_fk" FOREIGN KEY ("automation_id") REFERENCES "public"."automations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "automations" ADD CONSTRAINT "automations_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "automation_sends_client_idx" ON "automation_sends" ("merchant_id","client_id","sent_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "automations_merchant_kind_idx" ON "automations" ("merchant_id","kind");