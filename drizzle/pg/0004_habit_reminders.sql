ALTER TABLE "habits" ADD COLUMN "reminders" jsonb;--> statement-breakpoint
ALTER TABLE "habits" DROP COLUMN "reminder_at_ms";