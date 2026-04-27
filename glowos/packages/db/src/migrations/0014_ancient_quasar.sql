ALTER TABLE "bookings" ADD COLUMN "discount_sgd" numeric(10, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "loyalty_points_redeemed" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "loyalty_redemption_tx_id" uuid;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_loyalty_redemption_tx_id_loyalty_transactions_id_fk" FOREIGN KEY ("loyalty_redemption_tx_id") REFERENCES "public"."loyalty_transactions"("id") ON DELETE SET NULL ON UPDATE NO ACTION;