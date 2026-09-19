CREATE TABLE "import_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"source" text NOT NULL,
	"source_key" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"created_at_ms" bigint NOT NULL,
	"updated_at_ms" bigint NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "reduced_motion" text DEFAULT 'system' NOT NULL;--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "reduce_motion_low_power" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "apprise_url" text;--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "apprise_key" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "apprise_tags" jsonb;--> statement-breakpoint
ALTER TABLE "import_keys" ADD CONSTRAINT "import_keys_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "import_keys_user_source_idx" ON "import_keys" USING btree ("user_id","source","source_key");