CREATE TABLE "contraception_days" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"method_id" text NOT NULL,
	"date" text NOT NULL,
	"status" text NOT NULL,
	"notes" text,
	"created_at_ms" bigint NOT NULL,
	"updated_at_ms" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contraception_methods" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"method" text NOT NULL,
	"label" text,
	"start_date" text NOT NULL,
	"end_date" text,
	"schedule" jsonb,
	"notes" text,
	"created_at_ms" bigint NOT NULL,
	"updated_at_ms" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "period_cycles" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"start_date" text NOT NULL,
	"end_date" text,
	"flow_intensity" text DEFAULT 'medium' NOT NULL,
	"notes" text,
	"created_at_ms" bigint NOT NULL,
	"updated_at_ms" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "period_day_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"date" text NOT NULL,
	"flow" text,
	"symptoms" jsonb,
	"mood" jsonb,
	"temperature_c" double precision,
	"lh_test" text,
	"mucus" text,
	"intimacy" boolean DEFAULT false NOT NULL,
	"ovulation_pain" boolean DEFAULT false NOT NULL,
	"weight_kg" double precision,
	"notes" text,
	"created_at_ms" bigint NOT NULL,
	"updated_at_ms" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "period_settings" (
	"user_id" text PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"prediction_cycle_count" bigint,
	"luteal_phase_days" bigint DEFAULT 14 NOT NULL,
	"contraception_in_use" boolean DEFAULT false NOT NULL,
	"created_at_ms" bigint NOT NULL,
	"updated_at_ms" bigint NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contraception_days" ADD CONSTRAINT "contraception_days_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contraception_days" ADD CONSTRAINT "contraception_days_method_id_contraception_methods_id_fk" FOREIGN KEY ("method_id") REFERENCES "public"."contraception_methods"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contraception_methods" ADD CONSTRAINT "contraception_methods_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "period_cycles" ADD CONSTRAINT "period_cycles_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "period_day_logs" ADD CONSTRAINT "period_day_logs_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "period_settings" ADD CONSTRAINT "period_settings_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "contraception_days_user_method_date_idx" ON "contraception_days" USING btree ("user_id","method_id","date");--> statement-breakpoint
CREATE INDEX "contraception_days_user_date_idx" ON "contraception_days" USING btree ("user_id","date");--> statement-breakpoint
CREATE INDEX "contraception_methods_user_idx" ON "contraception_methods" USING btree ("user_id","start_date");--> statement-breakpoint
CREATE UNIQUE INDEX "period_cycles_user_start_idx" ON "period_cycles" USING btree ("user_id","start_date");--> statement-breakpoint
CREATE UNIQUE INDEX "period_day_logs_user_date_idx" ON "period_day_logs" USING btree ("user_id","date");