CREATE TABLE "short_links" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "code" varchar(16) NOT NULL UNIQUE,
  "full_url" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "expires_at" timestamp with time zone
);
CREATE INDEX "short_links_code_idx" ON "short_links" ("code");
