CREATE TABLE `reminder_dispatches` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`source` text NOT NULL,
	`source_id` text NOT NULL,
	`occurrence_key` text NOT NULL,
	`fire_at_ms` integer NOT NULL,
	`sent_at_ms` integer NOT NULL,
	`created_at_ms` integer NOT NULL,
	`updated_at_ms` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `reminder_dispatches_claim_idx` ON `reminder_dispatches` (`user_id`,`source`,`source_id`,`occurrence_key`);--> statement-breakpoint
CREATE INDEX `reminder_dispatches_user_idx` ON `reminder_dispatches` (`user_id`);