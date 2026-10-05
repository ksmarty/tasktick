CREATE TABLE "reminder_dispatches" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"source" text NOT NULL,
	"source_id" text NOT NULL,
	"occurrence_key" text NOT NULL,
	"fire_at_ms" bigint NOT NULL,
	"sent_at_ms" bigint NOT NULL,
	"created_at_ms" bigint NOT NULL,
	"updated_at_ms" bigint NOT NULL
);
--> statement-breakpoint
ALTER TABLE "reminder_dispatches" ADD CONSTRAINT "reminder_dispatches_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "reminder_dispatches_claim_idx" ON "reminder_dispatches" USING btree ("user_id","source","source_id","occurrence_key");--> statement-breakpoint
CREATE INDEX "reminder_dispatches_user_idx" ON "reminder_dispatches" USING btree ("user_id");