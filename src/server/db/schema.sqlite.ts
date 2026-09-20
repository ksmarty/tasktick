/**
 * Canonical SQLite schema (default deployment target).
 *
 * ## Portability rules — `schema.pg.ts` is a mechanical mirror of this file
 *
 * The same table/column *names* and the same JS types must be produced by both
 * dialects so the repository layer can be dialect-agnostic. Therefore:
 *
 *  - timestamps  -> `integer` epoch milliseconds  (pg: `bigint({ mode: 'number' })`)
 *  - booleans    -> `integer({ mode: 'boolean' })` (pg: `boolean`)
 *  - json blobs  -> `text({ mode: 'json' }).$type<T>()` (pg: `jsonb`)
 *  - dates       -> `text` holding `YYYY-MM-DD`   (pg: `text`)
 *  - enums       -> `text().$type<Union>()`, never a native pg enum (no migration pain)
 *
 * Never use `sql` with dialect-specific SQL in this file, and never rely on
 * SQLite-only column affinities. Anything you add here must be mirrored.
 */
import { sqliteTable, text, integer, real, index, uniqueIndex, primaryKey } from 'drizzle-orm/sqlite-core';
import type {
  CalendarProvider,
  EventStatus,
  EventTransparency,
  HabitFrequency,
  HabitGoalType,
  Priority,
  RecurrenceMode,
  SyncProvider,
  SyncState,
  TaskStatus,
  FocusKind,
} from '@/lib/types';

/* -------------------------------------------------------------------------- */
/* shared column groups                                                       */
/* -------------------------------------------------------------------------- */

const now = () => Date.now();

const timestamps = {
  createdAt: integer('created_at_ms').notNull().$defaultFn(now),
  updatedAt: integer('updated_at_ms').notNull().$defaultFn(now),
};

/** Sync bookkeeping shared by every CalDAV-mirrored row. */
const syncColumns = {
  /** `local` = created in this app, `caldav` = came from a remote collection. */
  syncProvider: text('sync_provider').$type<SyncProvider>().notNull().default('local'),
  /** Dirty tracking: drives what the push half of the sync engine uploads. */
  syncState: text('sync_state').$type<SyncState>().notNull().default('synced'),
  /** iCalendar UID. Stable for the lifetime of the object across all replicas. */
  externalUid: text('external_uid'),
  /** Absolute CalDAV object URL, e.g. `https://cal.example.com/cal/abc.ics`. */
  externalHref: text('external_href'),
  /** HTTP ETag of the last known remote revision — the basis of optimistic locking. */
  externalEtag: text('external_etag'),
  /** iCalendar SEQUENCE, used to break ties on concurrent edits. */
  remoteSequence: integer('remote_sequence'),
  /** iCalendar LAST-MODIFIED, secondary tie-breaker. */
  remoteLastModified: text('remote_last_modified'),
  lastSyncedAtMs: integer('last_synced_at_ms'),
};

/* -------------------------------------------------------------------------- */
/* auth (better-auth managed models)                                          */
/* -------------------------------------------------------------------------- */

/**
 * Column *property* names here are part of the better-auth contract — its
 * Drizzle adapter resolves fields by property name. Do not rename them.
 */
export const user = sqliteTable(
  'user',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    email: text('email').notNull(),
    emailVerified: integer('email_verified', { mode: 'boolean' }).notNull().default(false),
    image: text('image'),
    createdAt: integer('created_at_ms', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date()),
    updatedAt: integer('updated_at_ms', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date()),
    /** First registered account becomes admin; required for invites + instance config. */
    isAdmin: integer('is_admin', { mode: 'boolean' }).notNull().default(false),
    /** IANA zone, used as the default for new tasks/events. */
    timezone: text('timezone').notNull().default('UTC'),
    banned: integer('banned', { mode: 'boolean' }).notNull().default(false),
  },
  (t) => [uniqueIndex('user_email_idx').on(t.email)],
);

export const session = sqliteTable(
  'session',
  {
    id: text('id').primaryKey(),
    expiresAt: integer('expires_at_ms', { mode: 'timestamp_ms' }).notNull(),
    token: text('token').notNull(),
    createdAt: integer('created_at_ms', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date()),
    updatedAt: integer('updated_at_ms', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date()),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
  },
  (t) => [uniqueIndex('session_token_idx').on(t.token), index('session_user_idx').on(t.userId)],
);

export const account = sqliteTable(
  'account',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: integer('access_token_expires_at_ms', { mode: 'timestamp_ms' }),
    refreshTokenExpiresAt: integer('refresh_token_expires_at_ms', { mode: 'timestamp_ms' }),
    scope: text('scope'),
    /** argon2/scrypt hash for the credential provider. Never a raw password. */
    password: text('password'),
    createdAt: integer('created_at_ms', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date()),
    updatedAt: integer('updated_at_ms', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date()),
  },
  (t) => [index('account_user_idx').on(t.userId), index('account_provider_idx').on(t.providerId, t.accountId)],
);

export const verification = sqliteTable(
  'verification',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: integer('expires_at_ms', { mode: 'timestamp_ms' }).notNull(),
    createdAt: integer('created_at_ms', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date()),
    updatedAt: integer('updated_at_ms', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date()),
  },
  (t) => [index('verification_identifier_idx').on(t.identifier)],
);

/** Invite-gated registration once the first admin exists. */
export const invites = sqliteTable(
  'invites',
  {
    id: text('id').primaryKey(),
    email: text('email').notNull(),
    token: text('token').notNull(),
    isAdmin: integer('is_admin', { mode: 'boolean' }).notNull().default(false),
    createdByUserId: text('created_by_user_id').references(() => user.id, { onDelete: 'set null' }),
    expiresAtMs: integer('expires_at_ms').notNull(),
    acceptedAtMs: integer('accepted_at_ms'),
    ...timestamps,
  },
  (t) => [uniqueIndex('invites_token_idx').on(t.token), index('invites_email_idx').on(t.email)],
);

/* -------------------------------------------------------------------------- */
/* per-user preferences                                                       */
/* -------------------------------------------------------------------------- */

export const userSettings = sqliteTable(
  'user_settings',
  {
    userId: text('user_id')
      .primaryKey()
      .references(() => user.id, { onDelete: 'cascade' }),
    timezone: text('timezone').notNull().default('UTC'),
    /** 0 = Sunday, 1 = Monday. */
    weekStartsOn: integer('week_starts_on').notNull().default(1),
    /** `light` | `dark` | `system` */
    theme: text('theme').notNull().default('system'),
    /** Accent colour token name from the iOS palette. */
    accent: text('accent').notNull().default('blue'),
    /** `12h` | `24h` */
    timeFormat: text('time_format').notNull().default('24h'),
    defaultListId: text('default_list_id'),
    /** Index into the "smart list" order array; JSON. */
    smartListOrder: text('smart_list_order', { mode: 'json' }).$type<string[]>(),
    /** Minutes; Pomodoro configuration. */
    pomodoroFocus: integer('pomodoro_focus').notNull().default(25),
    pomodoroShortBreak: integer('pomodoro_short_break').notNull().default(5),
    pomodoroLongBreak: integer('pomodoro_long_break').notNull().default(15),
    pomodoroLongBreakEvery: integer('pomodoro_long_break_every').notNull().default(4),
    pomodoroAutoStartBreaks: integer('pomodoro_auto_start_breaks', { mode: 'boolean' }).notNull().default(true),
    /** Push notification master switch. */
    notificationsEnabled: integer('notifications_enabled', { mode: 'boolean' }).notNull().default(true),
    /** Daily agenda digest, `HH:mm` local or null when disabled. */
    dailyDigestAt: text('daily_digest_at'),
    /** Reminder offsets in minutes applied to new tasks, JSON array. */
    defaultReminders: text('default_reminders', { mode: 'json' }).$type<number[]>(),
    /**
     * In-app reduced-motion preference: `system` follows the OS, `reduce` forces
     * it on regardless of the OS. An OS `reduce` is always honoured, so there is
     * no "force motion" value.
     */
    reducedMotion: text('reduced_motion').notNull().default('system'),
    /** Opt-in to the (heuristic) low-power-mode inference; never a stored result. */
    reduceMotionLowPower: integer('reduce_motion_low_power', { mode: 'boolean' }).notNull().default(false),
    /** Apprise API base URL, e.g. `https://apprise.example.com`; null = disabled. */
    appriseUrl: text('apprise_url'),
    /** Apprise API key, encrypted at rest and never returned to the client. */
    appriseKey: text('apprise_key').notNull().default(''),
    /** Optional Apprise tags to target, JSON array of strings. */
    appriseTags: text('apprise_tags', { mode: 'json' }).$type<string[]>(),
    ...timestamps,
  },
);

/* -------------------------------------------------------------------------- */
/* lists, tags, tasks                                                         */
/* -------------------------------------------------------------------------- */

export const lists = sqliteTable(
  'lists',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    color: text('color').notNull().default('blue'),
    emoji: text('emoji'),
    /** Fractional index (`a0`, `a0V`, ...) so reordering never rewrites siblings. */
    sortOrder: text('sort_order').notNull().default('a0'),
    archived: integer('archived', { mode: 'boolean' }).notNull().default(false),
    /** Exactly one list per user is the Inbox; it cannot be deleted or archived. */
    isInbox: integer('is_inbox', { mode: 'boolean' }).notNull().default(false),
    ...timestamps,
    deletedAtMs: integer('deleted_at_ms'),
  },
  (t) => [index('lists_user_idx').on(t.userId, t.archived)],
);

export const tags = sqliteTable(
  'tags',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    color: text('color').notNull().default('gray'),
    ...timestamps,
  },
  (t) => [uniqueIndex('tags_user_name_idx').on(t.userId, t.name)],
);

export const tasks = sqliteTable(
  'tasks',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    listId: text('list_id').references(() => lists.id, { onDelete: 'set null' }),
    /** Subtasks form a two-level tree: a subtask never has subtasks of its own. */
    parentId: text('parent_id'),

    title: text('title').notNull(),
    notes: text('notes'),
    url: text('url'),

    status: text('status').$type<TaskStatus>().notNull().default('todo'),
    priority: text('priority').$type<Priority>().notNull().default('none'),

    /**
     * Two parallel representations of "when":
     *  - timed    -> `dueAtMs` + `timezone`
     *  - all-day  -> `dueDate` (`YYYY-MM-DD`, floating, no timezone)
     * A task may have both (all-day date with an optional time), which is how
     * TickTick models "due Tuesday, remind me at 09:00".
     */
    dueAtMs: integer('due_at_ms'),
    dueDate: text('due_date'),
    startAtMs: integer('start_at_ms'),
    startDate: text('start_date'),
    isAllDay: integer('is_all_day', { mode: 'boolean' }).notNull().default(false),
    timezone: text('timezone'),

    completedAtMs: integer('completed_at_ms'),

    /** RFC 5545 RRULE body, e.g. `FREQ=WEEKLY;BYDAY=MO,WE;INTERVAL=2`. */
    recurrenceRule: text('recurrence_rule'),
    /** Whether the next occurrence is computed from the due date or from completion. */
    recurrenceMode: text('recurrence_mode').$type<RecurrenceMode>().notNull().default('due'),
    /** For completed recurring tasks: which occurrence this row represents. */
    recurrenceId: text('recurrence_id'),

    estimateMinutes: integer('estimate_minutes'),
    spentMinutes: integer('spent_minutes').notNull().default(0),
    sortOrder: text('sort_order').notNull().default('a0'),
    isPinned: integer('is_pinned', { mode: 'boolean' }).notNull().default(false),

    /**
     * When set, the task is mirrored into a calendar collection as a VTODO
     * (CalDAV) and rendered as an event-like block in the calendar views.
     */
    calendarId: text('calendar_id').references(() => calendars.id, { onDelete: 'set null' }),

    ...syncColumns,
    ...timestamps,
    /** Soft delete: the row survives as a tombstone so the delete can propagate. */
    deletedAtMs: integer('deleted_at_ms'),
  },
  (t) => [
    index('tasks_user_status_idx').on(t.userId, t.status),
    index('tasks_list_idx').on(t.listId, t.sortOrder),
    index('tasks_due_idx').on(t.userId, t.dueAtMs),
    index('tasks_due_date_idx').on(t.userId, t.dueDate),
    index('tasks_parent_idx').on(t.parentId),
    index('tasks_sync_idx').on(t.userId, t.syncState),
    uniqueIndex('tasks_external_uid_idx').on(t.userId, t.externalUid),
  ],
);

export const taskTags = sqliteTable(
  'task_tags',
  {
    taskId: text('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    tagId: text('tag_id')
      .notNull()
      .references(() => tags.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.taskId, t.tagId] }), index('task_tags_tag_idx').on(t.tagId)],
);

/** Immutable log of every completion — powers streaks and productivity stats. */
export const taskCompletions = sqliteTable(
  'task_completions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    taskId: text('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    completedAtMs: integer('completed_at_ms').notNull(),
    /** The occurrence that was completed (all-day date or scheduled instant). */
    occurrenceDate: text('occurrence_date'),
  },
  (t) => [index('task_completions_user_idx').on(t.userId, t.completedAtMs), index('task_completions_task_idx').on(t.taskId)],
);

export const taskReminders = sqliteTable(
  'task_reminders',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    taskId: text('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    /** Negative = minutes before due. Mutually exclusive with `absoluteAtMs`. */
    offsetMinutes: integer('offset_minutes'),
    /** Used for "remind me at 09:00 on the due date" style triggers. */
    absoluteAtMs: integer('absolute_at_ms'),
    /** Precomputed fire time so the dispatcher can index on a single column. */
    fireAtMs: integer('fire_at_ms').notNull(),
    sent: integer('sent', { mode: 'boolean' }).notNull().default(false),
    sentAtMs: integer('sent_at_ms'),
    ...timestamps,
  },
  (t) => [index('task_reminders_fire_idx').on(t.sent, t.fireAtMs), index('task_reminders_task_idx').on(t.taskId)],
);

/* -------------------------------------------------------------------------- */
/* habits                                                                     */
/* -------------------------------------------------------------------------- */

export const habits = sqliteTable(
  'habits',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    icon: text('icon'),
    color: text('color').notNull().default('blue'),
    /** `boolean` = once a day; `count` = N times per period; `duration` = minutes. */
    goalType: text('goal_type').$type<HabitGoalType>().notNull().default('boolean'),
    goalTarget: real('goal_target').notNull().default(1),
    unit: text('unit'),
    frequency: text('frequency').$type<HabitFrequency>().notNull().default('daily'),
    /** CSV of weekdays 0-6, only meaningful when `frequency = custom`. */
    weekDays: text('week_days'),
    timesPerPeriod: integer('times_per_period').notNull().default(1),
    startDate: text('start_date').notNull(),
    /** Reminder times as minutes since local midnight (0–1439), ascending. */
    reminders: text('reminders', { mode: 'json' }).$type<number[] | null>(),
    archived: integer('archived', { mode: 'boolean' }).notNull().default(false),
    sortOrder: text('sort_order').notNull().default('a0'),
    ...timestamps,
    deletedAtMs: integer('deleted_at_ms'),
  },
  (t) => [index('habits_user_idx').on(t.userId, t.archived)],
);

export const habitEntries = sqliteTable(
  'habit_entries',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    habitId: text('habit_id')
      .notNull()
      .references(() => habits.id, { onDelete: 'cascade' }),
    /** `YYYY-MM-DD` local to the habit's owner. One row per habit per day. */
    date: text('date').notNull(),
    /** For `count` goals: how many units were logged. */
    count: real('count').notNull().default(1),
    /** For `duration` goals: minutes. */
    value: real('value'),
    note: text('note'),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('habit_entries_habit_date_idx').on(t.habitId, t.date),
    index('habit_entries_user_date_idx').on(t.userId, t.date),
  ],
);

/* -------------------------------------------------------------------------- */
/* calendars + events                                                         */
/* -------------------------------------------------------------------------- */

export const caldavAccounts = sqliteTable(
  'caldav_accounts',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /** Discovered principal/calendar-home URL after well-known resolution. */
    serverUrl: text('server_url').notNull(),
    username: text('username').notNull(),
    /** AES-256-GCM ciphertext, key derived from BETTER_AUTH_SECRET. Never plaintext. */
    passwordEncrypted: text('password_encrypted').notNull(),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    syncIntervalMinutes: integer('sync_interval_minutes').notNull().default(15),
    /** `auto` | `pull` | `push` (read-only mirrors). */
    direction: text('direction').notNull().default('auto'),
    lastSyncAtMs: integer('last_sync_at_ms'),
    /** `idle` | `running` | `success` | `error` */
    lastSyncStatus: text('last_sync_status').notNull().default('idle'),
    lastError: text('last_error'),
    consecutiveFailures: integer('consecutive_failures').notNull().default(0),
    ...timestamps,
    deletedAtMs: integer('deleted_at_ms'),
  },
  (t) => [index('caldav_accounts_user_idx').on(t.userId, t.enabled)],
);

export const calendars = sqliteTable(
  'calendars',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    color: text('color').notNull().default('blue'),
    timezone: text('timezone').notNull().default('UTC'),
    provider: text('provider').$type<CalendarProvider>().notNull().default('local'),
    caldavAccountId: text('caldav_account_id').references(() => caldavAccounts.id, { onDelete: 'cascade' }),
    /** Remote collection URL (`calendar-home/<uuid>/`). */
    remoteHref: text('remote_href'),
    /** CTag from the last successful collection sync — cheap "anything changed?" probe. */
    remoteCtag: text('remote_ctag'),
    /** RFC 6578 `sync-token` enabling delta sync instead of full enumeration. */
    remoteSyncToken: text('remote_sync_token'),
    /** Whether the remote collection advertises VTODO support. */
    supportsVtodo: integer('supports_vtodo', { mode: 'boolean' }).notNull().default(false),
    isVisible: integer('is_visible', { mode: 'boolean' }).notNull().default(true),
    /**
     * Whether this calendar's events join the task list.
     *
     * Deliberately separate from `isVisible`: a calendar can be drawn on the
     * calendar screen and still be kept out of the task list, which is the
     * distinction a user drawing a line between "my schedule" and "my work"
     * is asking for. Defaults on so an existing calendar keeps appearing where
     * it always did.
     */
    showInTasks: integer('show_in_tasks', { mode: 'boolean' }).notNull().default(true),
    isDefault: integer('is_default', { mode: 'boolean' }).notNull().default(false),
    readOnly: integer('read_only', { mode: 'boolean' }).notNull().default(false),
    sortOrder: text('sort_order').notNull().default('a0'),
    lastSyncedAtMs: integer('last_synced_at_ms'),
    lastSyncError: text('last_sync_error'),
    colorOverride: text('color_override'),
    ...timestamps,
    deletedAtMs: integer('deleted_at_ms'),
  },
  (t) => [
    index('calendars_user_idx').on(t.userId, t.isVisible),
    uniqueIndex('calendars_remote_href_idx').on(t.userId, t.remoteHref),
  ],
);

export const calendarEvents = sqliteTable(
  'calendar_events',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    calendarId: text('calendar_id')
      .notNull()
      .references(() => calendars.id, { onDelete: 'cascade' }),

    /** iCalendar UID, shared by every override of a recurring series. */
    uid: text('uid').notNull(),
    /** For a modified single instance: the original occurrence start (RFC 5545 RECURRENCE-ID). */
    recurrenceId: text('recurrence_id'),

    summary: text('summary').notNull().default(''),
    description: text('description'),
    location: text('location'),
    url: text('url'),

    startMs: integer('start_ms'),
    endMs: integer('end_ms'),
    /** All-day events use floating dates and ignore the timezone. */
    startDate: text('start_date'),
    endDate: text('end_date'),
    isAllDay: integer('is_all_day', { mode: 'boolean' }).notNull().default(false),
    timezone: text('timezone').notNull().default('UTC'),

    rrule: text('rrule'),
    /** JSON string[] of excluded occurrence start instants (EXDATE). */
    exdates: text('exdates', { mode: 'json' }).$type<string[]>(),
    rdates: text('rdates', { mode: 'json' }).$type<string[]>(),

    status: text('status').$type<EventStatus>().notNull().default('confirmed'),
    transparency: text('transparency').$type<EventTransparency>().notNull().default('opaque'),

    organizer: text('organizer', { mode: 'json' }).$type<{ name?: string; email?: string } | null>(),
    attendees: text('attendees', { mode: 'json' }).$type<
      { name?: string; email: string; status?: string; role?: string }[] | null
    >(),
    categories: text('categories', { mode: 'json' }).$type<string[] | null>(),
    /** Minutes-before offsets, same semantics as task reminders. */
    reminders: text('reminders', { mode: 'json' }).$type<number[] | null>(),

    color: text('color'),
    /** Original VCALENDAR text, retained so we can round-trip unknown properties. */
    rawIcs: text('raw_ics'),

    ...syncColumns,
    ...timestamps,
    deletedAtMs: integer('deleted_at_ms'),
  },
  (t) => [
    index('calendar_events_range_idx').on(t.userId, t.startMs),
    index('calendar_events_calendar_idx').on(t.calendarId, t.startMs),
    index('calendar_events_sync_idx').on(t.userId, t.syncState),
    uniqueIndex('calendar_events_uid_idx').on(t.calendarId, t.uid, t.recurrenceId),
  ],
);

/* -------------------------------------------------------------------------- */
/* sync observability                                                         */
/* -------------------------------------------------------------------------- */

export const syncLogs = sqliteTable(
  'sync_logs',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    accountId: text('account_id').references(() => caldavAccounts.id, { onDelete: 'cascade' }),
    calendarId: text('calendar_id').references(() => calendars.id, { onDelete: 'cascade' }),
    /** `full` | `incremental` | `push` | `discover` */
    kind: text('kind').notNull(),
    /** `running` | `success` | `error` | `skipped` */
    status: text('status').notNull(),
    startedAtMs: integer('started_at_ms').notNull(),
    finishedAtMs: integer('finished_at_ms'),
    pulled: integer('pulled').notNull().default(0),
    pushed: integer('pushed').notNull().default(0),
    deletedRemote: integer('deleted_remote').notNull().default(0),
    deletedLocal: integer('deleted_local').notNull().default(0),
    conflicts: integer('conflicts').notNull().default(0),
    error: text('error'),
  },
  (t) => [index('sync_logs_user_idx').on(t.userId, t.startedAtMs), index('sync_logs_account_idx').on(t.accountId, t.startedAtMs)],
);

/**
 * Audit trail of every two-sided conflict the engine resolved. Kept forever so
 * a user can see exactly what the merge heuristic did on their behalf.
 */
export const syncConflicts = sqliteTable(
  'sync_conflicts',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    accountId: text('account_id').references(() => caldavAccounts.id, { onDelete: 'cascade' }),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    entityTitle: text('entity_title'),
    /** `local-wins` | `remote-wins` | `merged` | `duplicated` */
    resolution: text('resolution').notNull(),
    localSnapshot: text('local_snapshot', { mode: 'json' }),
    remoteSnapshot: text('remote_snapshot', { mode: 'json' }),
    resolvedAtMs: integer('resolved_at_ms').notNull(),
    ...timestamps,
  },
  (t) => [index('sync_conflicts_user_idx').on(t.userId, t.resolvedAtMs)],
);

/* -------------------------------------------------------------------------- */
/* notifications, sharing, focus                                              */
/* -------------------------------------------------------------------------- */

export const pushSubscriptions = sqliteTable(
  'push_subscriptions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    endpoint: text('endpoint').notNull(),
    p256dh: text('p256dh').notNull(),
    auth: text('auth').notNull(),
    userAgent: text('user_agent'),
    failureCount: integer('failure_count').notNull().default(0),
    lastUsedAtMs: integer('last_used_at_ms'),
    ...timestamps,
  },
  (t) => [uniqueIndex('push_subscriptions_endpoint_idx').on(t.endpoint), index('push_subscriptions_user_idx').on(t.userId)],
);

/** Bearer token for the read-only `webcal://` ICS subscription feed. */
export const icalTokens = sqliteTable(
  'ical_tokens',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    token: text('token').notNull(),
    name: text('name').notNull().default('Subscription'),
    /** JSON string[] of list ids to include; null = everything. */
    listIds: text('list_ids', { mode: 'json' }).$type<string[] | null>(),
    includeTasks: integer('include_tasks', { mode: 'boolean' }).notNull().default(true),
    includeEvents: integer('include_events', { mode: 'boolean' }).notNull().default(true),
    lastUsedAtMs: integer('last_used_at_ms'),
    revokedAtMs: integer('revoked_at_ms'),
    ...timestamps,
  },
  (t) => [uniqueIndex('ical_tokens_token_idx').on(t.token), index('ical_tokens_user_idx').on(t.userId)],
);

/**
 * API token for the public GraphQL endpoint.
 *
 * Exactly one per account, so `userId` is the primary key rather than a
 * surrogate id. Only a keyed hash of the token is stored — never the plaintext
 * — so a stolen database cannot be replayed against the API. Cycling rewrites
 * the row in place, which is what makes "one token per account" structural
 * rather than a rule the repository has to remember.
 */
export const apiTokens = sqliteTable(
  'api_tokens',
  {
    userId: text('user_id')
      .primaryKey()
      .references(() => user.id, { onDelete: 'cascade' }),
    /** Keyed HMAC-SHA256 of the plaintext token. The plaintext is never stored. */
    tokenHash: text('token_hash').notNull(),
    /** First characters of the plaintext, so the UI can identify a token. */
    tokenPrefix: text('token_prefix').notNull(),
    /** Last time the token authenticated a request; best-effort. */
    lastUsedAtMs: integer('last_used_at_ms'),
    ...timestamps,
  },
  (t) => [uniqueIndex('api_tokens_hash_idx').on(t.tokenHash)],
);

export const focusSessions = sqliteTable(
  'focus_sessions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    taskId: text('task_id').references(() => tasks.id, { onDelete: 'set null' }),
    kind: text('kind').$type<FocusKind>().notNull().default('focus'),
    startedAtMs: integer('started_at_ms').notNull(),
    endedAtMs: integer('ended_at_ms'),
    plannedSeconds: integer('planned_seconds').notNull(),
    actualSeconds: integer('actual_seconds').notNull().default(0),
    completed: integer('completed', { mode: 'boolean' }).notNull().default(false),
    note: text('note'),
    ...timestamps,
  },
  (t) => [index('focus_sessions_user_idx').on(t.userId, t.startedAtMs), index('focus_sessions_task_idx').on(t.taskId)],
);

/** User-defined filters behind the "Smart list" sidebar entries. */
export const savedFilters = sqliteTable(
  'saved_filters',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    icon: text('icon'),
    color: text('color').notNull().default('gray'),
    /** Serialised `TaskFilter` from `@/lib/types`. */
    query: text('query', { mode: 'json' }).notNull(),
    sortOrder: text('sort_order').notNull().default('a0'),
    ...timestamps,
  },
  (t) => [index('saved_filters_user_idx').on(t.userId, t.sortOrder)],
);

/* -------------------------------------------------------------------------- */
/* import provenance                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Maps an item in an external export to the row it created.
 *
 * This is what makes re-importing the same file idempotent even after the user
 * has renamed or edited an imported task: the natural key is the *source's* own
 * id, not the content, so it survives edits. Kept in its own table rather than a
 * marker column on `tasks`/`lists` because the CalDAV columns there already own
 * identity for mirrored rows and an importer must not collide with them.
 *
 * Nothing reads this table except the import service.
 */
export const importKeys = sqliteTable(
  'import_keys',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    /** Importer namespace, e.g. `ticktick`. */
    source: text('source').notNull(),
    /** Stable key from the source document, e.g. `task:<taskId>`. */
    sourceKey: text('source_key').notNull(),
    /** `task` | `list` — what kind of row `entityId` points at. */
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    ...timestamps,
  },
  (t) => [uniqueIndex('import_keys_user_source_idx').on(t.userId, t.source, t.sourceKey)],
);

/* -------------------------------------------------------------------------- */
/* inferred row types                                                         */
/* -------------------------------------------------------------------------- */

export type UserRow = typeof user.$inferSelect;
export type SessionRow = typeof session.$inferSelect;
export type ListRow = typeof lists.$inferSelect;
export type TaskRow = typeof tasks.$inferSelect;
export type TagRow = typeof tags.$inferSelect;
export type HabitRow = typeof habits.$inferSelect;
export type HabitEntryRow = typeof habitEntries.$inferSelect;
export type CalendarRow = typeof calendars.$inferSelect;
export type CalendarEventRow = typeof calendarEvents.$inferSelect;
export type CaldavAccountRow = typeof caldavAccounts.$inferSelect;
export type SyncLogRow = typeof syncLogs.$inferSelect;
export type SyncConflictRow = typeof syncConflicts.$inferSelect;
export type FocusSessionRow = typeof focusSessions.$inferSelect;
export type SavedFilterRow = typeof savedFilters.$inferSelect;
export type ImportKeyRow = typeof importKeys.$inferSelect;
export type UserSettingsRow = typeof userSettings.$inferSelect;
export type TaskReminderRow = typeof taskReminders.$inferSelect;
export type PushSubscriptionRow = typeof pushSubscriptions.$inferSelect;
export type IcalTokenRow = typeof icalTokens.$inferSelect;
export type ApiTokenRow = typeof apiTokens.$inferSelect;
export type InviteRow = typeof invites.$inferSelect;
