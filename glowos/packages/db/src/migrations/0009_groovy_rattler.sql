CREATE TABLE IF NOT EXISTS "brand_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"invitee_email" varchar(255) NOT NULL,
	"token" varchar(64) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"accepted_by_user_id" uuid,
	"canceled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "brand_invites_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "brand_invites_group_id_idx" ON "brand_invites" ("group_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "brand_invites_token_idx" ON "brand_invites" ("token");