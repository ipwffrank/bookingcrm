CREATE TABLE IF NOT EXISTS "loyalty_programs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"merchant_id" uuid NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"points_per_dollar" integer DEFAULT 1 NOT NULL,
	"points_per_visit" integer DEFAULT 0 NOT NULL,
	"points_per_dollar_redeem" integer DEFAULT 100 NOT NULL,
	"min_redeem_points" integer DEFAULT 100 NOT NULL,
	"earn_expiry_months" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "loyalty_programs_merchant_unique" UNIQUE("merchant_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "loyalty_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"merchant_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"kind" varchar(20) NOT NULL,
	"amount" integer NOT NULL,
	"earned_from_sgd" numeric(10, 2),
	"redeemed_sgd" numeric(10, 2),
	"booking_id" uuid,
	"reason" text,
	"actor_user_id" uuid,
	"actor_name" varchar(255),
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "loyalty_programs" ADD CONSTRAINT "loyalty_programs_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "loyalty_transactions" ADD CONSTRAINT "loyalty_transactions_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "loyalty_transactions" ADD CONSTRAINT "loyalty_transactions_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "loyalty_transactions" ADD CONSTRAINT "loyalty_transactions_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "loyalty_transactions" ADD CONSTRAINT "loyalty_transactions_actor_user_id_merchant_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."merchant_users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "loyalty_transactions_client_idx" ON "loyalty_transactions" ("merchant_id","client_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "loyalty_transactions_booking_idx" ON "loyalty_transactions" ("booking_id");