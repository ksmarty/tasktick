CREATE TABLE "ha_deliveries" (
	"user_id" text PRIMARY KEY NOT NULL,
	"sources" jsonb NOT NULL,
	"registered_at_ms" bigint NOT NULL,
	"created_at_ms" bigint NOT NULL,
	"updated_at_ms" bigint NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ha_deliveries" ADD CONSTRAINT "ha_deliveries_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;