CREATE TABLE `contraception_days` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`method_id` text NOT NULL,
	`date` text NOT NULL,
	`status` text NOT NULL,
	`notes` text,
	`created_at_ms` integer NOT NULL,
	`updated_at_ms` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`method_id`) REFERENCES `contraception_methods`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `contraception_days_user_method_date_idx` ON `contraception_days` (`user_id`,`method_id`,`date`);--> statement-breakpoint
CREATE INDEX `contraception_days_user_date_idx` ON `contraception_days` (`user_id`,`date`);--> statement-breakpoint
CREATE TABLE `contraception_methods` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`method` text NOT NULL,
	`label` text,
	`start_date` text NOT NULL,
	`end_date` text,
	`schedule` text,
	`notes` text,
	`created_at_ms` integer NOT NULL,
	`updated_at_ms` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `contraception_methods_user_idx` ON `contraception_methods` (`user_id`,`start_date`);--> statement-breakpoint
CREATE TABLE `period_cycles` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text,
	`flow_intensity` text DEFAULT 'medium' NOT NULL,
	`notes` text,
	`created_at_ms` integer NOT NULL,
	`updated_at_ms` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `period_cycles_user_start_idx` ON `period_cycles` (`user_id`,`start_date`);--> statement-breakpoint
CREATE TABLE `period_day_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`date` text NOT NULL,
	`flow` text,
	`symptoms` text,
	`mood` text,
	`temperature_c` real,
	`lh_test` text,
	`mucus` text,
	`intimacy` integer DEFAULT false NOT NULL,
	`ovulation_pain` integer DEFAULT false NOT NULL,
	`weight_kg` real,
	`notes` text,
	`created_at_ms` integer NOT NULL,
	`updated_at_ms` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `period_day_logs_user_date_idx` ON `period_day_logs` (`user_id`,`date`);--> statement-breakpoint
CREATE TABLE `period_settings` (
	`user_id` text PRIMARY KEY NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`prediction_cycle_count` integer,
	`luteal_phase_days` integer DEFAULT 14 NOT NULL,
	`contraception_in_use` integer DEFAULT false NOT NULL,
	`created_at_ms` integer NOT NULL,
	`updated_at_ms` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
