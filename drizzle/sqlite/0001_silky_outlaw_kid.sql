CREATE TABLE `import_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`source` text NOT NULL,
	`source_key` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`created_at_ms` integer NOT NULL,
	`updated_at_ms` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `import_keys_user_source_idx` ON `import_keys` (`user_id`,`source`,`source_key`);--> statement-breakpoint
ALTER TABLE `user_settings` ADD `reduced_motion` text DEFAULT 'system' NOT NULL;--> statement-breakpoint
ALTER TABLE `user_settings` ADD `reduce_motion_low_power` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `user_settings` ADD `apprise_url` text;--> statement-breakpoint
ALTER TABLE `user_settings` ADD `apprise_key` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `user_settings` ADD `apprise_tags` text;