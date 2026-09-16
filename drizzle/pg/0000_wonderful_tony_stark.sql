CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at_ms" timestamp with time zone,
	"refresh_token_expires_at_ms" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at_ms" timestamp with time zone NOT NULL,
	"updated_at_ms" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "caldav_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"server_url" text NOT NULL,
	"username" text NOT NULL,
	"password_encrypted" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"sync_interval_minutes" bigint DEFAULT 15 NOT NULL,
	"direction" text DEFAULT 'auto' NOT NULL,
	"last_sync_at_ms" bigint,
	"last_sync_status" text DEFAULT 'idle' NOT NULL,
	"last_error" text,
	"consecutive_failures" bigint DEFAULT 0 NOT NULL,
	"created_at_ms" bigint NOT NULL,
	"updated_at_ms" bigint NOT NULL,
	"deleted_at_ms" bigint
);
--> statement-breakpoint
CREATE TABLE "calendar_events" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"calendar_id" text NOT NULL,
	"uid" text NOT NULL,
	"recurrence_id" text,
	"summary" text DEFAULT '' NOT NULL,
	"description" text,
	"location" text,
	"url" text,
	"start_ms" bigint,
	"end_ms" bigint,
	"start_date" text,
	"end_date" text,
	"is_all_day" boolean DEFAULT false NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"rrule" text,
	"exdates" jsonb,
	"rdates" jsonb,
	"status" text DEFAULT 'confirmed' NOT NULL,
	"transparency" text DEFAULT 'opaque' NOT NULL,
	"organizer" jsonb,
	"attendees" jsonb,
	"categories" jsonb,
	"reminders" jsonb,
	"color" text,
	"raw_ics" text,
	"sync_provider" text DEFAULT 'local' NOT NULL,
	"sync_state" text DEFAULT 'synced' NOT NULL,
	"external_uid" text,
	"external_href" text,
	"external_etag" text,
	"remote_sequence" bigint,
	"remote_last_modified" text,
	"last_synced_at_ms" bigint,
	"created_at_ms" bigint NOT NULL,
	"updated_at_ms" bigint NOT NULL,
	"deleted_at_ms" bigint
);
--> statement-breakpoint
CREATE TABLE "calendars" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"color" text DEFAULT 'blue' NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"provider" text DEFAULT 'local' NOT NULL,
	"caldav_account_id" text,
	"remote_href" text,
	"remote_ctag" text,
	"remote_sync_token" text,
	"supports_vtodo" boolean DEFAULT false NOT NULL,
	"is_visible" boolean DEFAULT true NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"read_only" boolean DEFAULT false NOT NULL,
	"sort_order" text DEFAULT 'a0' NOT NULL,
	"last_synced_at_ms" bigint,
	"last_sync_error" text,
	"color_override" text,
	"created_at_ms" bigint NOT NULL,
	"updated_at_ms" bigint NOT NULL,
	"deleted_at_ms" bigint
);
--> statement-breakpoint
CREATE TABLE "focus_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"task_id" text,
	"kind" text DEFAULT 'focus' NOT NULL,
	"started_at_ms" bigint NOT NULL,
	"ended_at_ms" bigint,
	"planned_seconds" bigint NOT NULL,
	"actual_seconds" bigint DEFAULT 0 NOT NULL,
	"completed" boolean DEFAULT false NOT NULL,
	"note" text,
	"created_at_ms" bigint NOT NULL,
	"updated_at_ms" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "habit_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"habit_id" text NOT NULL,
	"date" text NOT NULL,
	"count" double precision DEFAULT 1 NOT NULL,
	"value" double precision,
	"note" text,
	"created_at_ms" bigint NOT NULL,
	"updated_at_ms" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "habits" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"icon" text,
	"color" text DEFAULT 'blue' NOT NULL,
	"goal_type" text DEFAULT 'boolean' NOT NULL,
	"goal_target" double precision DEFAULT 1 NOT NULL,
	"unit" text,
	"frequency" text DEFAULT 'daily' NOT NULL,
	"week_days" text,
	"times_per_period" bigint DEFAULT 1 NOT NULL,
	"start_date" text NOT NULL,
	"reminder_at_ms" bigint,
	"archived" boolean DEFAULT false NOT NULL,
	"sort_order" text DEFAULT 'a0' NOT NULL,
	"created_at_ms" bigint NOT NULL,
	"updated_at_ms" bigint NOT NULL,
	"deleted_at_ms" bigint
);
--> statement-breakpoint
CREATE TABLE "ical_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"token" text NOT NULL,
	"name" text DEFAULT 'Subscription' NOT NULL,
	"list_ids" jsonb,
	"include_tasks" boolean DEFAULT true NOT NULL,
	"include_events" boolean DEFAULT true NOT NULL,
	"last_used_at_ms" bigint,
	"revoked_at_ms" bigint,
	"created_at_ms" bigint NOT NULL,
	"updated_at_ms" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invites" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"token" text NOT NULL,
	"is_admin" boolean DEFAULT false NOT NULL,
	"created_by_user_id" text,
	"expires_at_ms" bigint NOT NULL,
	"accepted_at_ms" bigint,
	"created_at_ms" bigint NOT NULL,
	"updated_at_ms" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lists" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"color" text DEFAULT 'blue' NOT NULL,
	"emoji" text,
	"sort_order" text DEFAULT 'a0' NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	"is_inbox" boolean DEFAULT false NOT NULL,
	"created_at_ms" bigint NOT NULL,
	"updated_at_ms" bigint NOT NULL,
	"deleted_at_ms" bigint
);
--> statement-breakpoint
CREATE TABLE "push_subscriptions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"user_agent" text,
	"failure_count" bigint DEFAULT 0 NOT NULL,
	"last_used_at_ms" bigint,
	"created_at_ms" bigint NOT NULL,
	"updated_at_ms" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "saved_filters" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"icon" text,
	"color" text DEFAULT 'gray' NOT NULL,
	"query" jsonb NOT NULL,
	"sort_order" text DEFAULT 'a0' NOT NULL,
	"created_at_ms" bigint NOT NULL,
	"updated_at_ms" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at_ms" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at_ms" timestamp with time zone NOT NULL,
	"updated_at_ms" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_conflicts" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"account_id" text,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"entity_title" text,
	"resolution" text NOT NULL,
	"local_snapshot" jsonb,
	"remote_snapshot" jsonb,
	"resolved_at_ms" bigint NOT NULL,
	"created_at_ms" bigint NOT NULL,
	"updated_at_ms" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"account_id" text,
	"calendar_id" text,
	"kind" text NOT NULL,
	"status" text NOT NULL,
	"started_at_ms" bigint NOT NULL,
	"finished_at_ms" bigint,
	"pulled" bigint DEFAULT 0 NOT NULL,
	"pushed" bigint DEFAULT 0 NOT NULL,
	"deleted_remote" bigint DEFAULT 0 NOT NULL,
	"deleted_local" bigint DEFAULT 0 NOT NULL,
	"conflicts" bigint DEFAULT 0 NOT NULL,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "tags" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"color" text DEFAULT 'gray' NOT NULL,
	"created_at_ms" bigint NOT NULL,
	"updated_at_ms" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_completions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"task_id" text NOT NULL,
	"completed_at_ms" bigint NOT NULL,
	"occurrence_date" text
);
--> statement-breakpoint
CREATE TABLE "task_reminders" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"task_id" text NOT NULL,
	"offset_minutes" bigint,
	"absolute_at_ms" bigint,
	"fire_at_ms" bigint NOT NULL,
	"sent" boolean DEFAULT false NOT NULL,
	"sent_at_ms" bigint,
	"created_at_ms" bigint NOT NULL,
	"updated_at_ms" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_tags" (
	"task_id" text NOT NULL,
	"tag_id" text NOT NULL,
	CONSTRAINT "task_tags_task_id_tag_id_pk" PRIMARY KEY("task_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"list_id" text,
	"parent_id" text,
	"title" text NOT NULL,
	"notes" text,
	"url" text,
	"status" text DEFAULT 'todo' NOT NULL,
	"priority" text DEFAULT 'none' NOT NULL,
	"due_at_ms" bigint,
	"due_date" text,
	"start_at_ms" bigint,
	"start_date" text,
	"is_all_day" boolean DEFAULT false NOT NULL,
	"timezone" text,
	"completed_at_ms" bigint,
	"recurrence_rule" text,
	"recurrence_mode" text DEFAULT 'due' NOT NULL,
	"recurrence_id" text,
	"estimate_minutes" bigint,
	"spent_minutes" bigint DEFAULT 0 NOT NULL,
	"sort_order" text DEFAULT 'a0' NOT NULL,
	"is_pinned" boolean DEFAULT false NOT NULL,
	"calendar_id" text,
	"sync_provider" text DEFAULT 'local' NOT NULL,
	"sync_state" text DEFAULT 'synced' NOT NULL,
	"external_uid" text,
	"external_href" text,
	"external_etag" text,
	"remote_sequence" bigint,
	"remote_last_modified" text,
	"last_synced_at_ms" bigint,
	"created_at_ms" bigint NOT NULL,
	"updated_at_ms" bigint NOT NULL,
	"deleted_at_ms" bigint
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at_ms" timestamp with time zone NOT NULL,
	"updated_at_ms" timestamp with time zone NOT NULL,
	"is_admin" boolean DEFAULT false NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"banned" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_settings" (
	"user_id" text PRIMARY KEY NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"week_starts_on" bigint DEFAULT 1 NOT NULL,
	"theme" text DEFAULT 'system' NOT NULL,
	"accent" text DEFAULT 'blue' NOT NULL,
	"time_format" text DEFAULT '24h' NOT NULL,
	"default_list_id" text,
	"smart_list_order" jsonb,
	"pomodoro_focus" bigint DEFAULT 25 NOT NULL,
	"pomodoro_short_break" bigint DEFAULT 5 NOT NULL,
	"pomodoro_long_break" bigint DEFAULT 15 NOT NULL,
	"pomodoro_long_break_every" bigint DEFAULT 4 NOT NULL,
	"pomodoro_auto_start_breaks" boolean DEFAULT true NOT NULL,
	"notifications_enabled" boolean DEFAULT true NOT NULL,
	"daily_digest_at" text,
	"default_reminders" jsonb,
	"created_at_ms" bigint NOT NULL,
	"updated_at_ms" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at_ms" timestamp with time zone NOT NULL,
	"created_at_ms" timestamp with time zone NOT NULL,
	"updated_at_ms" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "caldav_accounts" ADD CONSTRAINT "caldav_accounts_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_calendar_id_calendars_id_fk" FOREIGN KEY ("calendar_id") REFERENCES "public"."calendars"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendars" ADD CONSTRAINT "calendars_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendars" ADD CONSTRAINT "calendars_caldav_account_id_caldav_accounts_id_fk" FOREIGN KEY ("caldav_account_id") REFERENCES "public"."caldav_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "focus_sessions" ADD CONSTRAINT "focus_sessions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "focus_sessions" ADD CONSTRAINT "focus_sessions_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "habit_entries" ADD CONSTRAINT "habit_entries_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "habit_entries" ADD CONSTRAINT "habit_entries_habit_id_habits_id_fk" FOREIGN KEY ("habit_id") REFERENCES "public"."habits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "habits" ADD CONSTRAINT "habits_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ical_tokens" ADD CONSTRAINT "ical_tokens_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lists" ADD CONSTRAINT "lists_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_filters" ADD CONSTRAINT "saved_filters_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_conflicts" ADD CONSTRAINT "sync_conflicts_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_conflicts" ADD CONSTRAINT "sync_conflicts_account_id_caldav_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."caldav_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_logs" ADD CONSTRAINT "sync_logs_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_logs" ADD CONSTRAINT "sync_logs_account_id_caldav_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."caldav_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_logs" ADD CONSTRAINT "sync_logs_calendar_id_calendars_id_fk" FOREIGN KEY ("calendar_id") REFERENCES "public"."calendars"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tags" ADD CONSTRAINT "tags_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_completions" ADD CONSTRAINT "task_completions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_completions" ADD CONSTRAINT "task_completions_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_reminders" ADD CONSTRAINT "task_reminders_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_reminders" ADD CONSTRAINT "task_reminders_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_tags" ADD CONSTRAINT "task_tags_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_tags" ADD CONSTRAINT "task_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_list_id_lists_id_fk" FOREIGN KEY ("list_id") REFERENCES "public"."lists"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_calendar_id_calendars_id_fk" FOREIGN KEY ("calendar_id") REFERENCES "public"."calendars"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_user_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "account_provider_idx" ON "account" USING btree ("provider_id","account_id");--> statement-breakpoint
CREATE INDEX "caldav_accounts_user_idx" ON "caldav_accounts" USING btree ("user_id","enabled");--> statement-breakpoint
CREATE INDEX "calendar_events_range_idx" ON "calendar_events" USING btree ("user_id","start_ms");--> statement-breakpoint
CREATE INDEX "calendar_events_calendar_idx" ON "calendar_events" USING btree ("calendar_id","start_ms");--> statement-breakpoint
CREATE INDEX "calendar_events_sync_idx" ON "calendar_events" USING btree ("user_id","sync_state");--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_events_uid_idx" ON "calendar_events" USING btree ("calendar_id","uid","recurrence_id");--> statement-breakpoint
CREATE INDEX "calendars_user_idx" ON "calendars" USING btree ("user_id","is_visible");--> statement-breakpoint
CREATE UNIQUE INDEX "calendars_remote_href_idx" ON "calendars" USING btree ("user_id","remote_href");--> statement-breakpoint
CREATE INDEX "focus_sessions_user_idx" ON "focus_sessions" USING btree ("user_id","started_at_ms");--> statement-breakpoint
CREATE INDEX "focus_sessions_task_idx" ON "focus_sessions" USING btree ("task_id");--> statement-breakpoint
CREATE UNIQUE INDEX "habit_entries_habit_date_idx" ON "habit_entries" USING btree ("habit_id","date");--> statement-breakpoint
CREATE INDEX "habit_entries_user_date_idx" ON "habit_entries" USING btree ("user_id","date");--> statement-breakpoint
CREATE INDEX "habits_user_idx" ON "habits" USING btree ("user_id","archived");--> statement-breakpoint
CREATE UNIQUE INDEX "ical_tokens_token_idx" ON "ical_tokens" USING btree ("token");--> statement-breakpoint
CREATE INDEX "ical_tokens_user_idx" ON "ical_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invites_token_idx" ON "invites" USING btree ("token");--> statement-breakpoint
CREATE INDEX "invites_email_idx" ON "invites" USING btree ("email");--> statement-breakpoint
CREATE INDEX "lists_user_idx" ON "lists" USING btree ("user_id","archived");--> statement-breakpoint
CREATE UNIQUE INDEX "push_subscriptions_endpoint_idx" ON "push_subscriptions" USING btree ("endpoint");--> statement-breakpoint
CREATE INDEX "push_subscriptions_user_idx" ON "push_subscriptions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "saved_filters_user_idx" ON "saved_filters" USING btree ("user_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "session_token_idx" ON "session" USING btree ("token");--> statement-breakpoint
CREATE INDEX "session_user_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sync_conflicts_user_idx" ON "sync_conflicts" USING btree ("user_id","resolved_at_ms");--> statement-breakpoint
CREATE INDEX "sync_logs_user_idx" ON "sync_logs" USING btree ("user_id","started_at_ms");--> statement-breakpoint
CREATE INDEX "sync_logs_account_idx" ON "sync_logs" USING btree ("account_id","started_at_ms");--> statement-breakpoint
CREATE UNIQUE INDEX "tags_user_name_idx" ON "tags" USING btree ("user_id","name");--> statement-breakpoint
CREATE INDEX "task_completions_user_idx" ON "task_completions" USING btree ("user_id","completed_at_ms");--> statement-breakpoint
CREATE INDEX "task_completions_task_idx" ON "task_completions" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "task_reminders_fire_idx" ON "task_reminders" USING btree ("sent","fire_at_ms");--> statement-breakpoint
CREATE INDEX "task_reminders_task_idx" ON "task_reminders" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "task_tags_tag_idx" ON "task_tags" USING btree ("tag_id");--> statement-breakpoint
CREATE INDEX "tasks_user_status_idx" ON "tasks" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "tasks_list_idx" ON "tasks" USING btree ("list_id","sort_order");--> statement-breakpoint
CREATE INDEX "tasks_due_idx" ON "tasks" USING btree ("user_id","due_at_ms");--> statement-breakpoint
CREATE INDEX "tasks_due_date_idx" ON "tasks" USING btree ("user_id","due_date");--> statement-breakpoint
CREATE INDEX "tasks_parent_idx" ON "tasks" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "tasks_sync_idx" ON "tasks" USING btree ("user_id","sync_state");--> statement-breakpoint
CREATE UNIQUE INDEX "tasks_external_uid_idx" ON "tasks" USING btree ("user_id","external_uid");--> statement-breakpoint
CREATE UNIQUE INDEX "user_email_idx" ON "user" USING btree ("email");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");