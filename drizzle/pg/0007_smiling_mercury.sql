ALTER TABLE "period_day_logs" ADD COLUMN "intimacy_occurrences" jsonb;--> statement-breakpoint
ALTER TABLE "period_settings" ADD COLUMN "symptom_options" jsonb;--> statement-breakpoint
ALTER TABLE "period_settings" ADD COLUMN "mood_options" jsonb;