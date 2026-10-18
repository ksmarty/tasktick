CREATE TABLE `ha_deliveries` (
	`user_id` text PRIMARY KEY NOT NULL,
	`sources` text NOT NULL,
	`registered_at_ms` integer NOT NULL,
	`created_at_ms` integer NOT NULL,
	`updated_at_ms` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
