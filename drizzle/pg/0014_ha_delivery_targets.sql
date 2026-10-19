CREATE TABLE "ha_delivery_targets" (
	"user_id" text PRIMARY KEY NOT NULL,
	"webhook_url" text NOT NULL,
	"registered_at_ms" bigint NOT NULL,
	"created_at_ms" bigint NOT NULL,
	"updated_at_ms" bigint NOT NULL
);
--> statement-breakpoint
DROP TABLE "ha_deliveries" CASCADE;--> statement-breakpoint
ALTER TABLE "ha_delivery_targets" ADD CONSTRAINT "ha_delivery_targets_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;