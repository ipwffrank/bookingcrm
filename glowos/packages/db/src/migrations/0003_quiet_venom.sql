CREATE TABLE IF NOT EXISTS "ipay88_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"merchant_id" uuid NOT NULL,
	"booking_id" uuid,
	"booking_group_id" uuid,
	"ref_no" varchar(20) NOT NULL,
	"amount_myr" numeric(10, 2) NOT NULL,
	"currency" varchar(5) NOT NULL,
	"payment_id" varchar(10),
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"ipay88_trans_id" varchar(50),
	"ipay88_auth_code" varchar(50),
	"ipay88_err_desc" text,
	"last_callback_payload" jsonb,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ipay88_transactions_ref_no_unique" UNIQUE("ref_no")
);
--> statement-breakpoint
ALTER TABLE "merchants" ADD COLUMN "payment_gateway" varchar(20) DEFAULT 'stripe' NOT NULL;--> statement-breakpoint
ALTER TABLE "merchants" ADD COLUMN "ipay88_merchant_code" varchar(20);--> statement-breakpoint
ALTER TABLE "merchants" ADD COLUMN "ipay88_merchant_key" text;--> statement-breakpoint
ALTER TABLE "merchants" ADD COLUMN "ipay88_currency" varchar(5);--> statement-breakpoint
ALTER TABLE "merchants" ADD COLUMN "ipay88_environment" varchar(20) DEFAULT 'sandbox' NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ipay88_transactions" ADD CONSTRAINT "ipay88_transactions_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ipay88_transactions" ADD CONSTRAINT "ipay88_transactions_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ipay88_transactions" ADD CONSTRAINT "ipay88_transactions_booking_group_id_booking_groups_id_fk" FOREIGN KEY ("booking_group_id") REFERENCES "public"."booking_groups"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ipay88_tx_merchant_idx" ON "ipay88_transactions" ("merchant_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ipay88_tx_booking_idx" ON "ipay88_transactions" ("booking_id");