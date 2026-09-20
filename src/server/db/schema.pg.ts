/**
 * Postgres mirror of the canonical SQLite schema (opt-in deployment target).
 *
 * This file is a *mechanical* mirror of `schema.sqlite.ts`: the same table names,
 * the same column *property* names, the same *DB column* names and the same JS
 * types, in the same order. `src/server/db/schema.ts` casts this module to the
 * SQLite schema type, so any drift here silently produces wrong SQL at runtime —
 * `tests/schema-parity.test.ts` is enforced by CI to make that impossible.
 *
 * ## Portability mapping — applied column by column, never anything else
 *
 *  - timestamps  -> `integer` epoch milliseconds  (sqlite)  = `bigint({ mode: 'number' })`
 *  - booleans    -> `integer({ mode: 'boolean' })` (sqlite) = `boolean`
 *  - json blobs  -> `text({ mode: 'json' }).$type<T>()` (sqlite) = `jsonb().$type<T>()`
 *  - dates       -> `text` holding `YYYY-MM-DD`   (both dialects, unchanged)
 *  - enums       -> `text().$type<Union>()` in both dialects; a native pg enum
 *                   type is deliberately avoided so schema changes need no
 *                   `ALTER TYPE` dance
 *  - reals       -> `real` (sqlite) = `doublePrecision`
 *
 * The better-auth timestamp columns (`user.createdAt`, `session.expiresAt`, ...) use
 * `timestamp({ withTimezone: true, mode: 'date' })`, which maps to a JS `Date` exactly
 * like sqlite's `integer(..., { mode: 'timestamp_ms' })`. The shared `timestamps`
 * helper group, by contrast, is epoch milliseconds in *both* dialects — plain
 * `integer` in sqlite, `bigint({ mode: 'number' })` here.
 * The `_ms` suffix in those DB column names is kept verbatim: the two schemas must
 * agree on column names or queries compiled for one dialect break on the other.
 *
 * Never use `sql` with dialect-specific SQL in this file.
 */
import { pgTable, text, bigint, boolean, jsonb, doublePrecision, timestamp, index, uniqueIndex, primaryKey } from 'drizzle-orm/pg-core';
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

/** Epoch milliseconds, exactly like the sqlite group — not a `timestamptz`. */
const now = () => Date.now();

const timestamps = {
  createdAt: bigint('created_at_ms', { mode: 'number' }).notNull().$defaultFn(now),
  updatedAt: bigint('updated_at_ms', { mode: 'number' }).notNull().$defaultFn(now),
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
  remoteSequence: bigint('remote_sequence', { mode: 'number' }),
  /** iCalendar LAST-MODIFIED, secondary tie-breaker. */
  remoteLastModified: text('remote_last_modified'),
  lastSyncedAtMs: bigint('last_synced_at_ms', { mode: 'number' }),
};

/* -------------------------------------------------------------------------- */
/* auth (better-auth managed models)                                          */
/* -------------------------------------------------------------------------- */

/**
 * Column *property* names here are part of the better-auth contract — its
 * Drizzle adapter resolves fields by property name. Do not rename them.
 */
export const user = pgTable(
  'user',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    email: text('email').notNull(),
    emailVerified: boolean('email_verified').notNull().default(false),
    image: text('image'),
    createdAt: timestamp('created_at_ms', { withTimezone: true, mode: 'date' }).notNull().$defaultFn(() => new Date()),
    updatedAt: timestamp('updated_at_ms', { withTimezone: true, mode: 'date' }).notNull().$defaultFn(() => new Date()),
    /** First registered account becomes admin; required for invites + instance config. */
    isAdmin: boolean('is_admin').notNull().default(false),
    /** IANA zone, used as the default for new tasks/events. */
    timezone: text('timezone').notNull().default('UTC'),
    banned: boolean('banned').notNull().default(false),
  },
  (t) => [uniqueIndex('user_email_idx').on(t.email)],
);

export const session = pgTable(
  'session',
  {
    id: text('id').primaryKey(),
    expiresAt: timestamp('expires_at_ms', { withTimezone: true, mode: 'date' }).notNull(),
    token: text('token').notNull(),
    createdAt: timestamp('created_at_ms', { withTimezone: true, mode: 'date' }).notNull().$defaultFn(() => new Date()),
    updatedAt: timestamp('updated_at_ms', { withTimezone: true, mode: 'date' }).notNull().$defaultFn(() => new Date()),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
  },
  (t) => [uniqueIndex('session_token_idx').on(t.token), index('session_user_idx').on(t.userId)],
);

export const account = pgTable(
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
    accessTokenExpiresAt: timestamp('access_token_expires_at_ms', { withTimezone: true, mode: 'date' }),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at_ms', { withTimezone: true, mode: 'date' }),
    scope: text('scope'),
    /** argon2/scrypt hash for the credential provider. Never a raw password. */
    password: text('password'),
    createdAt: timestamp('created_at_ms', { withTimezone: true, mode: 'date' }).notNull().$defaultFn(() => new Date()),
    updatedAt: timestamp('updated_at_ms', { withTimezone: true, mode: 'date' }).notNull().$defaultFn(() => new Date()),
  },
  (t) => [index('account_user_idx').on(t.userId), index('account_provider_idx').on(t.providerId, t.accountId)],
);

export const verification = pgTable(
  'verification',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expires_at_ms', { withTimezone: true, mode: 'date' }).notNull(),
    createdAt: timestamp('created_at_ms', { withTimezone: true, mode: 'date' }).notNull().$defaultFn(() => new Date()),
    updatedAt: timestamp('updated_at_ms', { withTimezone: true, mode: 'date' }).notNull().$defaultFn(() => new Date()),
  },
  (t) => [index('verification_identifier_idx').on(t.identifier)],
);

/** Invite-gated registration once the first admin exists. */
export const invites = pgTable(
  'invites',
  {
    id: text('id').primaryKey(),
    email: text('email').notNull(),
    token: text('token').notNull(),
    isAdmin: boolean('is_admin').notNull().default(false),
    createdByUserId: text('created_by_user_id').references(() => user.id, { onDelete: 'set null' }),
    expiresAtMs: bigint('expires_at_ms', { mode: 'number' }).notNull(),
    acceptedAtMs: bigint('accepted_at_ms', { mode: 'number' }),
    ...timestamps,
  },
  (t) => [uniqueIndex('invites_token_idx').on(t.token), index('invites_email_idx').on(t.email)],
);

/* -------------------------------------------------------------------------- */
/* per-user preferences                                                       */
/* -------------------------------------------------------------------------- */

export const userSettings = pgTable(
  'user_settings',
  {
    userId: text('user_id')
      .primaryKey()
      .references(() => user.id, { onDelete: 'cascade' }),
    timezone: text('timezone').notNull().default('UTC'),
    /** 0 = Sunday, 1 = Monday. */
    weekStartsOn: bigint('week_starts_on', { mode: 'number' }).notNull().default(1),
    /** `light` | `dark` | `system` */
    theme: text('theme').notNull().default('system'),
    /** Accent colour token name from the iOS palette. */
    accent: text('accent').notNull().default('blue'),
    /** `12h` | `24h` */
    timeFormat: text('time_format').notNull().default('24h'),
    defaultListId: text('default_list_id'),
    /** Index into the "smart list" order array; JSON. */
    smartListOrder: jsonb('smart_list_order').$type<string[]>(),
    /** Minutes; Pomodoro configuration. */
    pomodoroFocus: bigint('pomodoro_focus', { mode: 'number' }).notNull().default(25),
    pomodoroShortBreak: bigint('pomodoro_short_break', { mode: 'number' }).notNull().default(5),
    pomodoroLongBreak: bigint('pomodoro_long_break', { mode: 'number' }).notNull().default(15),
    pomodoroLongBreakEvery: bigint('pomodoro_long_break_every', { mode: 'number' }).notNull().default(4),
    pomodoroAutoStartBreaks: boolean('pomodoro_auto_start_breaks').notNull().default(true),
    /** Push notification master switch. */
    notificationsEnabled: boolean('notifications_enabled').notNull().default(true),
    /** Daily agenda digest, `HH:mm` local or null when disabled. */
    dailyDigestAt: text('daily_digest_at'),
    /** Reminder offsets in minutes applied to new tasks, JSON array. */
    defaultReminders: jsonb('default_reminders').$type<number[]>(),
    /**
     * In-app reduced-motion preference: `system` follows the OS, `reduce` forces
     * it on regardless of the OS. An OS `reduce` is always honoured, so there is
     * no "force motion" value.
     */
    reducedMotion: text('reduced_motion').notNull().default('system'),
    /** Opt-in to the (heuristic) low-power-mode inference; never a stored result. */
    reduceMotionLowPower: boolean('reduce_motion_low_power').notNull().default(false),
    /** Apprise API base URL, e.g. `https://apprise.example.com`; null = disabled. */
    appriseUrl: text('apprise_url'),
    /** Apprise API key, encrypted at rest and never returned to the client. */
    appriseKey: text('apprise_key').notNull().default(''),
    /** Optional Apprise tags to target, JSON array of strings. */
    appriseTags: jsonb('apprise_tags').$type<string[]>(),
    ...timestamps,
  },
);

/* -------------------------------------------------------------------------- */
/* lists, tags, tasks                                                         */
/* -------------------------------------------------------------------------- */

export const lists = pgTable(
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
    archived: boolean('archived').notNull().default(false),
    /** Exactly one list per user is the Inbox; it cannot be deleted or archived. */
    isInbox: boolean('is_inbox').notNull().default(false),
    ...timestamps,
    deletedAtMs: bigint('deleted_at_ms', { mode: 'number' }),
  },
  (t) => [index('lists_user_idx').on(t.userId, t.archived)],
);

export const tags = pgTable(
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

export const tasks = pgTable(
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
    dueAtMs: bigint('due_at_ms', { mode: 'number' }),
    dueDate: text('due_date'),
    startAtMs: bigint('start_at_ms', { mode: 'number' }),
    startDate: text('start_date'),
    isAllDay: boolean('is_all_day').notNull().default(false),
    timezone: text('timezone'),

    completedAtMs: bigint('completed_at_ms', { mode: 'number' }),

    /** RFC 5545 RRULE body, e.g. `FREQ=WEEKLY;BYDAY=MO,WE;INTERVAL=2`. */
    recurrenceRule: text('recurrence_rule'),
    /** Whether the next occurrence is computed from the due date or from completion. */
    recurrenceMode: text('recurrence_mode').$type<RecurrenceMode>().notNull().default('due'),
    /** For completed recurring tasks: which occurrence this row represents. */
    recurrenceId: text('recurrence_id'),

    estimateMinutes: bigint('estimate_minutes', { mode: 'number' }),
    spentMinutes: bigint('spent_minutes', { mode: 'number' }).notNull().default(0),
    sortOrder: text('sort_order').notNull().default('a0'),
    isPinned: boolean('is_pinned').notNull().default(false),

    /**
     * When set, the task is mirrored into a calendar collection as a VTODO
     * (CalDAV) and rendered as an event-like block in the calendar views.
     */
    calendarId: text('calendar_id').references(() => calendars.id, { onDelete: 'set null' }),

    ...syncColumns,
    ...timestamps,
    /** Soft delete: the row survives as a tombstone so the delete can propagate. */
    deletedAtMs: bigint('deleted_at_ms', { mode: 'number' }),
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

export const taskTags = pgTable(
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
export const taskCompletions = pgTable(
  'task_completions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    taskId: text('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    completedAtMs: bigint('completed_at_ms', { mode: 'number' }).notNull(),
    /** The occurrence that was completed (all-day date or scheduled instant). */
    occurrenceDate: text('occurrence_date'),
  },
  (t) => [index('task_completions_user_idx').on(t.userId, t.completedAtMs), index('task_completions_task_idx').on(t.taskId)],
);

export const taskReminders = pgTable(
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
    offsetMinutes: bigint('offset_minutes', { mode: 'number' }),
    /** Used for "remind me at 09:00 on the due date" style triggers. */
    absoluteAtMs: bigint('absolute_at_ms', { mode: 'number' }),
    /** Precomputed fire time so the dispatcher can index on a single column. */
    fireAtMs: bigint('fire_at_ms', { mode: 'number' }).notNull(),
    sent: boolean('sent').notNull().default(false),
    sentAtMs: bigint('sent_at_ms', { mode: 'number' }),
    ...timestamps,
  },
  (t) => [index('task_reminders_fire_idx').on(t.sent, t.fireAtMs), index('task_reminders_task_idx').on(t.taskId)],
);

/* -------------------------------------------------------------------------- */
/* habits                                                                     */
/* -------------------------------------------------------------------------- */

export const habits = pgTable(
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
    goalTarget: doublePrecision('goal_target').notNull().default(1),
    unit: text('unit'),
    frequency: text('frequency').$type<HabitFrequency>().notNull().default('daily'),
    /** CSV of weekdays 0-6, only meaningful when `frequency = custom`. */
    weekDays: text('week_days'),
    timesPerPeriod: bigint('times_per_period', { mode: 'number' }).notNull().default(1),
    startDate: text('start_date').notNull(),
    /** Reminder times as minutes since local midnight (0–1439), ascending. */
    reminders: jsonb('reminders').$type<number[] | null>(),
    archived: boolean('archived').notNull().default(false),
    sortOrder: text('sort_order').notNull().default('a0'),
    ...timestamps,
    deletedAtMs: bigint('deleted_at_ms', { mode: 'number' }),
  },
  (t) => [index('habits_user_idx').on(t.userId, t.archived)],
);

export const habitEntries = pgTable(
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
    count: doublePrecision('count').notNull().default(1),
    /** For `duration` goals: minutes. */
    value: doublePrecision('value'),
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

export const caldavAccounts = pgTable(
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
    enabled: boolean('enabled').notNull().default(true),
    syncIntervalMinutes: bigint('sync_interval_minutes', { mode: 'number' }).notNull().default(15),
    /** `auto` | `pull` | `push` (read-only mirrors). */
    direction: text('direction').notNull().default('auto'),
    lastSyncAtMs: bigint('last_sync_at_ms', { mode: 'number' }),
    /** `idle` | `running` | `success` | `error` */
    lastSyncStatus: text('last_sync_status').notNull().default('idle'),
    lastError: text('last_error'),
    consecutiveFailures: bigint('consecutive_failures', { mode: 'number' }).notNull().default(0),
    ...timestamps,
    deletedAtMs: bigint('deleted_at_ms', { mode: 'number' }),
  },
  (t) => [index('caldav_accounts_user_idx').on(t.userId, t.enabled)],
);

export const calendars = pgTable(
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
    supportsVtodo: boolean('supports_vtodo').notNull().default(false),
    isVisible: boolean('is_visible').notNull().default(true),
    /**
     * Whether this calendar's events join the task list.
     *
     * Deliberately separate from `isVisible`: a calendar can be drawn on the
     * calendar screen and still be kept out of the task list, which is the
     * distinction a user drawing a line between "my schedule" and "my work"
     * is asking for. Defaults on so an existing calendar keeps appearing where
     * it always did.
     */
    showInTasks: boolean('show_in_tasks').notNull().default(true),
    isDefault: boolean('is_default').notNull().default(false),
    readOnly: boolean('read_only').notNull().default(false),
    sortOrder: text('sort_order').notNull().default('a0'),
    lastSyncedAtMs: bigint('last_synced_at_ms', { mode: 'number' }),
    lastSyncError: text('last_sync_error'),
    colorOverride: text('color_override'),
    ...timestamps,
    deletedAtMs: bigint('deleted_at_ms', { mode: 'number' }),
  },
  (t) => [
    index('calendars_user_idx').on(t.userId, t.isVisible),
    uniqueIndex('calendars_remote_href_idx').on(t.userId, t.remoteHref),
  ],
);

export const calendarEvents = pgTable(
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

    startMs: bigint('start_ms', { mode: 'number' }),
    endMs: bigint('end_ms', { mode: 'number' }),
    /** All-day events use floating dates and ignore the timezone. */
    startDate: text('start_date'),
    endDate: text('end_date'),
    isAllDay: boolean('is_all_day').notNull().default(false),
    timezone: text('timezone').notNull().default('UTC'),

    rrule: text('rrule'),
    /** JSON string[] of excluded occurrence start instants (EXDATE). */
    exdates: jsonb('exdates').$type<string[]>(),
    rdates: jsonb('rdates').$type<string[]>(),

    status: text('status').$type<EventStatus>().notNull().default('confirmed'),
    transparency: text('transparency').$type<EventTransparency>().notNull().default('opaque'),

    organizer: jsonb('organizer').$type<{ name?: string; email?: string } | null>(),
    attendees: jsonb('attendees').$type<
      { name?: string; email: string; status?: string; role?: string }[] | null
    >(),
    categories: jsonb('categories').$type<string[] | null>(),
    /** Minutes-before offsets, same semantics as task reminders. */
    reminders: jsonb('reminders').$type<number[] | null>(),

    color: text('color'),
    /** Original VCALENDAR text, retained so we can round-trip unknown properties. */
    rawIcs: text('raw_ics'),

    ...syncColumns,
    ...timestamps,
    deletedAtMs: bigint('deleted_at_ms', { mode: 'number' }),
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

export const syncLogs = pgTable(
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
    startedAtMs: bigint('started_at_ms', { mode: 'number' }).notNull(),
    finishedAtMs: bigint('finished_at_ms', { mode: 'number' }),
    pulled: bigint('pulled', { mode: 'number' }).notNull().default(0),
    pushed: bigint('pushed', { mode: 'number' }).notNull().default(0),
    deletedRemote: bigint('deleted_remote', { mode: 'number' }).notNull().default(0),
    deletedLocal: bigint('deleted_local', { mode: 'number' }).notNull().default(0),
    conflicts: bigint('conflicts', { mode: 'number' }).notNull().default(0),
    error: text('error'),
  },
  (t) => [index('sync_logs_user_idx').on(t.userId, t.startedAtMs), index('sync_logs_account_idx').on(t.accountId, t.startedAtMs)],
);

/**
 * Audit trail of every two-sided conflict the engine resolved. Kept forever so
 * a user can see exactly what the merge heuristic did on their behalf.
 */
export const syncConflicts = pgTable(
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
    localSnapshot: jsonb('local_snapshot'),
    remoteSnapshot: jsonb('remote_snapshot'),
    resolvedAtMs: bigint('resolved_at_ms', { mode: 'number' }).notNull(),
    ...timestamps,
  },
  (t) => [index('sync_conflicts_user_idx').on(t.userId, t.resolvedAtMs)],
);

/* -------------------------------------------------------------------------- */
/* notifications, sharing, focus                                              */
/* -------------------------------------------------------------------------- */

export const pushSubscriptions = pgTable(
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
    failureCount: bigint('failure_count', { mode: 'number' }).notNull().default(0),
    lastUsedAtMs: bigint('last_used_at_ms', { mode: 'number' }),
    ...timestamps,
  },
  (t) => [uniqueIndex('push_subscriptions_endpoint_idx').on(t.endpoint), index('push_subscriptions_user_idx').on(t.userId)],
);

/** Bearer token for the read-only `webcal://` ICS subscription feed. */
export const icalTokens = pgTable(
  'ical_tokens',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    token: text('token').notNull(),
    name: text('name').notNull().default('Subscription'),
    /** JSON string[] of list ids to include; null = everything. */
    listIds: jsonb('list_ids').$type<string[] | null>(),
    includeTasks: boolean('include_tasks').notNull().default(true),
    includeEvents: boolean('include_events').notNull().default(true),
    lastUsedAtMs: bigint('last_used_at_ms', { mode: 'number' }),
    revokedAtMs: bigint('revoked_at_ms', { mode: 'number' }),
    ...timestamps,
  },
  (t) => [uniqueIndex('ical_tokens_token_idx').on(t.token), index('ical_tokens_user_idx').on(t.userId)],
);

/** Mirror of `api_tokens` in `schema.sqlite.ts` — see there for the rationale. */
export const apiTokens = pgTable(
  'api_tokens',
  {
    userId: text('user_id')
      .primaryKey()
      .references(() => user.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    tokenPrefix: text('token_prefix').notNull(),
    lastUsedAtMs: bigint('last_used_at_ms', { mode: 'number' }),
    ...timestamps,
  },
  (t) => [uniqueIndex('api_tokens_hash_idx').on(t.tokenHash)],
);

export const focusSessions = pgTable(
  'focus_sessions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    taskId: text('task_id').references(() => tasks.id, { onDelete: 'set null' }),
    kind: text('kind').$type<FocusKind>().notNull().default('focus'),
    startedAtMs: bigint('started_at_ms', { mode: 'number' }).notNull(),
    endedAtMs: bigint('ended_at_ms', { mode: 'number' }),
    plannedSeconds: bigint('planned_seconds', { mode: 'number' }).notNull(),
    actualSeconds: bigint('actual_seconds', { mode: 'number' }).notNull().default(0),
    completed: boolean('completed').notNull().default(false),
    note: text('note'),
    ...timestamps,
  },
  (t) => [index('focus_sessions_user_idx').on(t.userId, t.startedAtMs), index('focus_sessions_task_idx').on(t.taskId)],
);

/** User-defined filters behind the "Smart list" sidebar entries. */
export const savedFilters = pgTable(
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
    query: jsonb('query').notNull(),
    sortOrder: text('sort_order').notNull().default('a0'),
    ...timestamps,
  },
  (t) => [index('saved_filters_user_idx').on(t.userId, t.sortOrder)],
);

/* -------------------------------------------------------------------------- */
/* import provenance                                                          */
/* -------------------------------------------------------------------------- */

/** Mirror of `import_keys` in `schema.sqlite.ts` — see there for the rationale. */
export const importKeys = pgTable(
  'import_keys',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    source: text('source').notNull(),
    sourceKey: text('source_key').notNull(),
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
