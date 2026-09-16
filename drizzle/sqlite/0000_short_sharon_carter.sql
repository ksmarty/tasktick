CREATE TABLE `account` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`user_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`id_token` text,
	`access_token_expires_at_ms` integer,
	`refresh_token_expires_at_ms` integer,
	`scope` text,
	`password` text,
	`created_at_ms` integer NOT NULL,
	`updated_at_ms` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `account_user_idx` ON `account` (`user_id`);--> statement-breakpoint
CREATE INDEX `account_provider_idx` ON `account` (`provider_id`,`account_id`);--> statement-breakpoint
CREATE TABLE `caldav_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`server_url` text NOT NULL,
	`username` text NOT NULL,
	`password_encrypted` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`sync_interval_minutes` integer DEFAULT 15 NOT NULL,
	`direction` text DEFAULT 'auto' NOT NULL,
	`last_sync_at_ms` integer,
	`last_sync_status` text DEFAULT 'idle' NOT NULL,
	`last_error` text,
	`consecutive_failures` integer DEFAULT 0 NOT NULL,
	`created_at_ms` integer NOT NULL,
	`updated_at_ms` integer NOT NULL,
	`deleted_at_ms` integer,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `caldav_accounts_user_idx` ON `caldav_accounts` (`user_id`,`enabled`);--> statement-breakpoint
CREATE TABLE `calendar_events` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`calendar_id` text NOT NULL,
	`uid` text NOT NULL,
	`recurrence_id` text,
	`summary` text DEFAULT '' NOT NULL,
	`description` text,
	`location` text,
	`url` text,
	`start_ms` integer,
	`end_ms` integer,
	`start_date` text,
	`end_date` text,
	`is_all_day` integer DEFAULT false NOT NULL,
	`timezone` text DEFAULT 'UTC' NOT NULL,
	`rrule` text,
	`exdates` text,
	`rdates` text,
	`status` text DEFAULT 'confirmed' NOT NULL,
	`transparency` text DEFAULT 'opaque' NOT NULL,
	`organizer` text,
	`attendees` text,
	`categories` text,
	`reminders` text,
	`color` text,
	`raw_ics` text,
	`sync_provider` text DEFAULT 'local' NOT NULL,
	`sync_state` text DEFAULT 'synced' NOT NULL,
	`external_uid` text,
	`external_href` text,
	`external_etag` text,
	`remote_sequence` integer,
	`remote_last_modified` text,
	`last_synced_at_ms` integer,
	`created_at_ms` integer NOT NULL,
	`updated_at_ms` integer NOT NULL,
	`deleted_at_ms` integer,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`calendar_id`) REFERENCES `calendars`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `calendar_events_range_idx` ON `calendar_events` (`user_id`,`start_ms`);--> statement-breakpoint
CREATE INDEX `calendar_events_calendar_idx` ON `calendar_events` (`calendar_id`,`start_ms`);--> statement-breakpoint
CREATE INDEX `calendar_events_sync_idx` ON `calendar_events` (`user_id`,`sync_state`);--> statement-breakpoint
CREATE UNIQUE INDEX `calendar_events_uid_idx` ON `calendar_events` (`calendar_id`,`uid`,`recurrence_id`);--> statement-breakpoint
CREATE TABLE `calendars` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`color` text DEFAULT 'blue' NOT NULL,
	`timezone` text DEFAULT 'UTC' NOT NULL,
	`provider` text DEFAULT 'local' NOT NULL,
	`caldav_account_id` text,
	`remote_href` text,
	`remote_ctag` text,
	`remote_sync_token` text,
	`supports_vtodo` integer DEFAULT false NOT NULL,
	`is_visible` integer DEFAULT true NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`read_only` integer DEFAULT false NOT NULL,
	`sort_order` text DEFAULT 'a0' NOT NULL,
	`last_synced_at_ms` integer,
	`last_sync_error` text,
	`color_override` text,
	`created_at_ms` integer NOT NULL,
	`updated_at_ms` integer NOT NULL,
	`deleted_at_ms` integer,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`caldav_account_id`) REFERENCES `caldav_accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `calendars_user_idx` ON `calendars` (`user_id`,`is_visible`);--> statement-breakpoint
CREATE UNIQUE INDEX `calendars_remote_href_idx` ON `calendars` (`user_id`,`remote_href`);--> statement-breakpoint
CREATE TABLE `focus_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`task_id` text,
	`kind` text DEFAULT 'focus' NOT NULL,
	`started_at_ms` integer NOT NULL,
	`ended_at_ms` integer,
	`planned_seconds` integer NOT NULL,
	`actual_seconds` integer DEFAULT 0 NOT NULL,
	`completed` integer DEFAULT false NOT NULL,
	`note` text,
	`created_at_ms` integer NOT NULL,
	`updated_at_ms` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `focus_sessions_user_idx` ON `focus_sessions` (`user_id`,`started_at_ms`);--> statement-breakpoint
CREATE INDEX `focus_sessions_task_idx` ON `focus_sessions` (`task_id`);--> statement-breakpoint
CREATE TABLE `habit_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`habit_id` text NOT NULL,
	`date` text NOT NULL,
	`count` real DEFAULT 1 NOT NULL,
	`value` real,
	`note` text,
	`created_at_ms` integer NOT NULL,
	`updated_at_ms` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`habit_id`) REFERENCES `habits`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `habit_entries_habit_date_idx` ON `habit_entries` (`habit_id`,`date`);--> statement-breakpoint
CREATE INDEX `habit_entries_user_date_idx` ON `habit_entries` (`user_id`,`date`);--> statement-breakpoint
CREATE TABLE `habits` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`icon` text,
	`color` text DEFAULT 'blue' NOT NULL,
	`goal_type` text DEFAULT 'boolean' NOT NULL,
	`goal_target` real DEFAULT 1 NOT NULL,
	`unit` text,
	`frequency` text DEFAULT 'daily' NOT NULL,
	`week_days` text,
	`times_per_period` integer DEFAULT 1 NOT NULL,
	`start_date` text NOT NULL,
	`reminder_at_ms` integer,
	`archived` integer DEFAULT false NOT NULL,
	`sort_order` text DEFAULT 'a0' NOT NULL,
	`created_at_ms` integer NOT NULL,
	`updated_at_ms` integer NOT NULL,
	`deleted_at_ms` integer,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `habits_user_idx` ON `habits` (`user_id`,`archived`);--> statement-breakpoint
CREATE TABLE `ical_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token` text NOT NULL,
	`name` text DEFAULT 'Subscription' NOT NULL,
	`list_ids` text,
	`include_tasks` integer DEFAULT true NOT NULL,
	`include_events` integer DEFAULT true NOT NULL,
	`last_used_at_ms` integer,
	`revoked_at_ms` integer,
	`created_at_ms` integer NOT NULL,
	`updated_at_ms` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ical_tokens_token_idx` ON `ical_tokens` (`token`);--> statement-breakpoint
CREATE INDEX `ical_tokens_user_idx` ON `ical_tokens` (`user_id`);--> statement-breakpoint
CREATE TABLE `invites` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`token` text NOT NULL,
	`is_admin` integer DEFAULT false NOT NULL,
	`created_by_user_id` text,
	`expires_at_ms` integer NOT NULL,
	`accepted_at_ms` integer,
	`created_at_ms` integer NOT NULL,
	`updated_at_ms` integer NOT NULL,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invites_token_idx` ON `invites` (`token`);--> statement-breakpoint
CREATE INDEX `invites_email_idx` ON `invites` (`email`);--> statement-breakpoint
CREATE TABLE `lists` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`color` text DEFAULT 'blue' NOT NULL,
	`emoji` text,
	`sort_order` text DEFAULT 'a0' NOT NULL,
	`archived` integer DEFAULT false NOT NULL,
	`is_inbox` integer DEFAULT false NOT NULL,
	`created_at_ms` integer NOT NULL,
	`updated_at_ms` integer NOT NULL,
	`deleted_at_ms` integer,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `lists_user_idx` ON `lists` (`user_id`,`archived`);--> statement-breakpoint
CREATE TABLE `push_subscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`endpoint` text NOT NULL,
	`p256dh` text NOT NULL,
	`auth` text NOT NULL,
	`user_agent` text,
	`failure_count` integer DEFAULT 0 NOT NULL,
	`last_used_at_ms` integer,
	`created_at_ms` integer NOT NULL,
	`updated_at_ms` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `push_subscriptions_endpoint_idx` ON `push_subscriptions` (`endpoint`);--> statement-breakpoint
CREATE INDEX `push_subscriptions_user_idx` ON `push_subscriptions` (`user_id`);--> statement-breakpoint
CREATE TABLE `saved_filters` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`icon` text,
	`color` text DEFAULT 'gray' NOT NULL,
	`query` text NOT NULL,
	`sort_order` text DEFAULT 'a0' NOT NULL,
	`created_at_ms` integer NOT NULL,
	`updated_at_ms` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `saved_filters_user_idx` ON `saved_filters` (`user_id`,`sort_order`);--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY NOT NULL,
	`expires_at_ms` integer NOT NULL,
	`token` text NOT NULL,
	`created_at_ms` integer NOT NULL,
	`updated_at_ms` integer NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`user_id` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_token_idx` ON `session` (`token`);--> statement-breakpoint
CREATE INDEX `session_user_idx` ON `session` (`user_id`);--> statement-breakpoint
CREATE TABLE `sync_conflicts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`account_id` text,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`entity_title` text,
	`resolution` text NOT NULL,
	`local_snapshot` text,
	`remote_snapshot` text,
	`resolved_at_ms` integer NOT NULL,
	`created_at_ms` integer NOT NULL,
	`updated_at_ms` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`account_id`) REFERENCES `caldav_accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `sync_conflicts_user_idx` ON `sync_conflicts` (`user_id`,`resolved_at_ms`);--> statement-breakpoint
CREATE TABLE `sync_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`account_id` text,
	`calendar_id` text,
	`kind` text NOT NULL,
	`status` text NOT NULL,
	`started_at_ms` integer NOT NULL,
	`finished_at_ms` integer,
	`pulled` integer DEFAULT 0 NOT NULL,
	`pushed` integer DEFAULT 0 NOT NULL,
	`deleted_remote` integer DEFAULT 0 NOT NULL,
	`deleted_local` integer DEFAULT 0 NOT NULL,
	`conflicts` integer DEFAULT 0 NOT NULL,
	`error` text,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`account_id`) REFERENCES `caldav_accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`calendar_id`) REFERENCES `calendars`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `sync_logs_user_idx` ON `sync_logs` (`user_id`,`started_at_ms`);--> statement-breakpoint
CREATE INDEX `sync_logs_account_idx` ON `sync_logs` (`account_id`,`started_at_ms`);--> statement-breakpoint
CREATE TABLE `tags` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`color` text DEFAULT 'gray' NOT NULL,
	`created_at_ms` integer NOT NULL,
	`updated_at_ms` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tags_user_name_idx` ON `tags` (`user_id`,`name`);--> statement-breakpoint
CREATE TABLE `task_completions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`task_id` text NOT NULL,
	`completed_at_ms` integer NOT NULL,
	`occurrence_date` text,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `task_completions_user_idx` ON `task_completions` (`user_id`,`completed_at_ms`);--> statement-breakpoint
CREATE INDEX `task_completions_task_idx` ON `task_completions` (`task_id`);--> statement-breakpoint
CREATE TABLE `task_reminders` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`task_id` text NOT NULL,
	`offset_minutes` integer,
	`absolute_at_ms` integer,
	`fire_at_ms` integer NOT NULL,
	`sent` integer DEFAULT false NOT NULL,
	`sent_at_ms` integer,
	`created_at_ms` integer NOT NULL,
	`updated_at_ms` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `task_reminders_fire_idx` ON `task_reminders` (`sent`,`fire_at_ms`);--> statement-breakpoint
CREATE INDEX `task_reminders_task_idx` ON `task_reminders` (`task_id`);--> statement-breakpoint
CREATE TABLE `task_tags` (
	`task_id` text NOT NULL,
	`tag_id` text NOT NULL,
	PRIMARY KEY(`task_id`, `tag_id`),
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `task_tags_tag_idx` ON `task_tags` (`tag_id`);--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`list_id` text,
	`parent_id` text,
	`title` text NOT NULL,
	`notes` text,
	`url` text,
	`status` text DEFAULT 'todo' NOT NULL,
	`priority` text DEFAULT 'none' NOT NULL,
	`due_at_ms` integer,
	`due_date` text,
	`start_at_ms` integer,
	`start_date` text,
	`is_all_day` integer DEFAULT false NOT NULL,
	`timezone` text,
	`completed_at_ms` integer,
	`recurrence_rule` text,
	`recurrence_mode` text DEFAULT 'due' NOT NULL,
	`recurrence_id` text,
	`estimate_minutes` integer,
	`spent_minutes` integer DEFAULT 0 NOT NULL,
	`sort_order` text DEFAULT 'a0' NOT NULL,
	`is_pinned` integer DEFAULT false NOT NULL,
	`calendar_id` text,
	`sync_provider` text DEFAULT 'local' NOT NULL,
	`sync_state` text DEFAULT 'synced' NOT NULL,
	`external_uid` text,
	`external_href` text,
	`external_etag` text,
	`remote_sequence` integer,
	`remote_last_modified` text,
	`last_synced_at_ms` integer,
	`created_at_ms` integer NOT NULL,
	`updated_at_ms` integer NOT NULL,
	`deleted_at_ms` integer,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`list_id`) REFERENCES `lists`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`calendar_id`) REFERENCES `calendars`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `tasks_user_status_idx` ON `tasks` (`user_id`,`status`);--> statement-breakpoint
CREATE INDEX `tasks_list_idx` ON `tasks` (`list_id`,`sort_order`);--> statement-breakpoint
CREATE INDEX `tasks_due_idx` ON `tasks` (`user_id`,`due_at_ms`);--> statement-breakpoint
CREATE INDEX `tasks_due_date_idx` ON `tasks` (`user_id`,`due_date`);--> statement-breakpoint
CREATE INDEX `tasks_parent_idx` ON `tasks` (`parent_id`);--> statement-breakpoint
CREATE INDEX `tasks_sync_idx` ON `tasks` (`user_id`,`sync_state`);--> statement-breakpoint
CREATE UNIQUE INDEX `tasks_external_uid_idx` ON `tasks` (`user_id`,`external_uid`);--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer DEFAULT false NOT NULL,
	`image` text,
	`created_at_ms` integer NOT NULL,
	`updated_at_ms` integer NOT NULL,
	`is_admin` integer DEFAULT false NOT NULL,
	`timezone` text DEFAULT 'UTC' NOT NULL,
	`banned` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_email_idx` ON `user` (`email`);--> statement-breakpoint
CREATE TABLE `user_settings` (
	`user_id` text PRIMARY KEY NOT NULL,
	`timezone` text DEFAULT 'UTC' NOT NULL,
	`week_starts_on` integer DEFAULT 1 NOT NULL,
	`theme` text DEFAULT 'system' NOT NULL,
	`accent` text DEFAULT 'blue' NOT NULL,
	`time_format` text DEFAULT '24h' NOT NULL,
	`default_list_id` text,
	`smart_list_order` text,
	`pomodoro_focus` integer DEFAULT 25 NOT NULL,
	`pomodoro_short_break` integer DEFAULT 5 NOT NULL,
	`pomodoro_long_break` integer DEFAULT 15 NOT NULL,
	`pomodoro_long_break_every` integer DEFAULT 4 NOT NULL,
	`pomodoro_auto_start_breaks` integer DEFAULT true NOT NULL,
	`notifications_enabled` integer DEFAULT true NOT NULL,
	`daily_digest_at` text,
	`default_reminders` text,
	`created_at_ms` integer NOT NULL,
	`updated_at_ms` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `verification` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at_ms` integer NOT NULL,
	`created_at_ms` integer NOT NULL,
	`updated_at_ms` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `verification_identifier_idx` ON `verification` (`identifier`);