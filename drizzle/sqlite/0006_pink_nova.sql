ALTER TABLE `period_day_logs` ADD `intimacy_protection` text;--> statement-breakpoint
ALTER TABLE `period_settings` ADD `body_signs` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `period_settings` ADD `hidden_today_categories` text;