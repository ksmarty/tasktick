CREATE TABLE `ha_delivery_targets` (
	`user_id` text PRIMARY KEY NOT NULL,
	`webhook_url` text NOT NULL,
	`registered_at_ms` integer NOT NULL,
	`created_at_ms` integer NOT NULL,
	`updated_at_ms` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
DROP TABLE `ha_deliveries`;