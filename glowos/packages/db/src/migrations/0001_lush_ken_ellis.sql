CREATE TABLE IF NOT EXISTS "group_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"profile_sharing_level" varchar(20) DEFAULT 'none' NOT NULL,
	"shared_marketing" boolean DEFAULT false NOT NULL,
	"shared_hr" boolean DEFAULT false NOT NULL,
	"cross_branch_staff" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "group_settings_group_id_unique" UNIQUE("group_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "group_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"email" varchar(255) NOT NULL,
	"password_hash" text NOT NULL,
	"name" varchar(255) NOT NULL,
	"role" varchar(20) DEFAULT 'group_owner' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "group_users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "staff_merchants" (
	"staff_id" uuid NOT NULL,
	"merchant_id" uuid NOT NULL,
	CONSTRAINT "staff_merchants_staff_id_merchant_id_pk" PRIMARY KEY("staff_id","merchant_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "consult_outcomes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"recommended_service_id" uuid,
	"notes" text,
	"follow_up_booking_id" uuid,
	"created_by_staff_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "post_service_sequences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"receipt_sent_at" timestamp with time zone,
	"balance_notif_sent_at" timestamp with time zone,
	"rebook_cta_sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "post_service_sequences_booking_id_unique" UNIQUE("booking_id")
);
--> statement-breakpoint
ALTER TABLE "merchants" ADD COLUMN "group_id" uuid;--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN "slot_type" varchar(20) DEFAULT 'standard' NOT NULL;--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN "requires_consult_first" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN "consult_service_id" uuid;--> statement-breakpoint
ALTER TABLE "staff" ADD COLUMN "bio" text;--> statement-breakpoint
ALTER TABLE "staff" ADD COLUMN "specialty_tags" text[];--> statement-breakpoint
ALTER TABLE "staff" ADD COLUMN "credentials" text;--> statement-breakpoint
ALTER TABLE "staff" ADD COLUMN "is_publicly_visible" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "acquisition_source" varchar(30) DEFAULT 'online_booking' NOT NULL;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "preferred_contact_channel" varchar(20) DEFAULT 'whatsapp' NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "group_settings" ADD CONSTRAINT "group_settings_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "group_users" ADD CONSTRAINT "group_users_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "staff_merchants" ADD CONSTRAINT "staff_merchants_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "staff_merchants" ADD CONSTRAINT "staff_merchants_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "consult_outcomes" ADD CONSTRAINT "consult_outcomes_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "consult_outcomes" ADD CONSTRAINT "consult_outcomes_recommended_service_id_services_id_fk" FOREIGN KEY ("recommended_service_id") REFERENCES "public"."services"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "consult_outcomes" ADD CONSTRAINT "consult_outcomes_created_by_staff_id_staff_id_fk" FOREIGN KEY ("created_by_staff_id") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "post_service_sequences" ADD CONSTRAINT "post_service_sequences_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
