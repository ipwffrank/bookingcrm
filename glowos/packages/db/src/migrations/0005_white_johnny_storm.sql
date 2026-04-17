CREATE TABLE IF NOT EXISTS "merchant_closures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"merchant_id" uuid NOT NULL,
	"date" date NOT NULL,
	"title" varchar(255) NOT NULL,
	"is_full_day" boolean DEFAULT true NOT NULL,
	"start_time" time,
	"end_time" time,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "google_id" varchar(255);--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "stripe_customer_id" varchar(255);--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "avatar_url" varchar(500);--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "merchant_closures" ADD CONSTRAINT "merchant_closures_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "closures_merchant_date_idx" ON "merchant_closures" ("merchant_id","date");--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_google_id_unique" UNIQUE("google_id");--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_stripe_customer_id_unique" UNIQUE("stripe_customer_id");