ALTER TABLE "period_day_logs" ADD COLUMN "intimacy_protection" text;--> statement-breakpoint
ALTER TABLE "period_settings" ADD COLUMN "body_signs" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "period_settings" ADD COLUMN "hidden_today_categories" jsonb;