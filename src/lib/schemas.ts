/**
 * Request validation schemas.
 *
 * Shared by the API routes and the client, so a payload the UI can build is
 * always a payload the server accepts. Zod 4.
 */
import { z } from 'zod';
import { ACCENT_COLORS } from './types';

/** Derived from the single source of truth in `./types`, so it cannot drift. */
export const accentColor = z.enum(ACCENT_COLORS);

export const priority = z.enum(['none', 'low', 'medium', 'high']);
export const taskStatus = z.enum(['todo', 'completed', 'wont_do']);
export const recurrenceMode = z.enum(['due', 'completion']);

const dateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected a YYYY-MM-DD date');

const timeOnly = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Expected an HH:mm time');

/** Nullable helpers so a client can explicitly clear a field. */
const nullableDate = dateOnly.nullable();
const nullableTime = timeOnly.nullable();

/**
 * An Apprise endpoint base URL. Only the shape is checked — never a fetch — and
 * http(s) is required because the transport is a plain `fetch` POST.
 */
export const appriseUrl = z
  .string()
  .trim()
  .max(500)
  .refine((value) => /^https?:\/\//i.test(value), 'Apprise URL must start with http:// or https://');

/* -------------------------------------------------------------------------- */
/* tasks                                                                      */
/* -------------------------------------------------------------------------- */

export const reminderInput = z.object({
  offsetMinutes: z.number().int().min(-100_800).max(100_800).nullable().optional(),
  absoluteAtMs: z.number().int().nonnegative().nullable().optional(),
});

export const createTaskSchema = z
  .object({
    title: z.string().min(1, 'A title is required').max(2000),
    notes: z.string().max(50_000).nullable().optional(),
    url: z.string().max(2000).nullable().optional(),
    listId: z.string().nullable().optional(),
    parentId: z.string().nullable().optional(),

    priority: priority.optional(),
    status: taskStatus.optional(),

    dueDate: nullableDate.optional(),
    dueTime: nullableTime.optional(),
    dueAtMs: z.number().int().nullable().optional(),
    startDate: nullableDate.optional(),
    startTime: nullableTime.optional(),
    startAtMs: z.number().int().nullable().optional(),
    timezone: z.string().max(64).nullable().optional(),

    recurrenceRule: z.string().max(500).nullable().optional(),
    recurrenceMode: recurrenceMode.optional(),
    estimateMinutes: z.number().int().min(0).max(100_000).nullable().optional(),

    tagIds: z.array(z.string()).max(50).optional(),
    tagNames: z.array(z.string().min(1).max(60)).max(50).optional(),

    reminders: z.array(reminderInput).max(20).optional(),

    calendarId: z.string().nullable().optional(),
    sortOrder: z.string().max(32).optional(),
    isPinned: z.boolean().optional(),
  })
  .strict();

export const updateTaskSchema = z
  .object({
    title: z.string().min(1).max(2000).optional(),
    notes: z.string().max(50_000).nullable().optional(),
    url: z.string().max(2000).nullable().optional(),
    listId: z.string().nullable().optional(),
    priority: priority.optional(),
    status: taskStatus.optional(),

    dueDate: nullableDate.optional(),
    dueTime: nullableTime.optional(),
    dueAtMs: z.number().int().nullable().optional(),
    startDate: nullableDate.optional(),
    startTime: nullableTime.optional(),
    startAtMs: z.number().int().nullable().optional(),
    timezone: z.string().max(64).nullable().optional(),
    clearDue: z.boolean().optional(),

    recurrenceRule: z.string().max(500).nullable().optional(),
    recurrenceMode: recurrenceMode.optional(),
    clearRecurrence: z.boolean().optional(),
    estimateMinutes: z.number().int().min(0).max(100_000).nullable().optional(),

    tagIds: z.array(z.string()).max(50).optional(),
    tagNames: z.array(z.string().min(1).max(60)).max(50).optional(),

    reminders: z.array(reminderInput).max(20).optional(),
    clearReminders: z.boolean().optional(),

    calendarId: z.string().nullable().optional(),
    sortOrder: z.string().max(32).optional(),
    isPinned: z.boolean().optional(),
  })
  .strict();

/** Query string for the task list endpoints. */
export const taskQuerySchema = z.object({
  text: z.string().max(200).optional(),
  listIds: z.array(z.string()).optional(),
  tagIds: z.array(z.string()).optional(),
  priorities: z.array(priority).optional(),
  statuses: z.array(taskStatus).optional(),
  dueWindow: z.enum(['overdue', 'today', 'tomorrow', 'next7days', 'next30days', 'all', 'noDate']).optional(),
  dueFrom: dateOnly.optional(),
  dueTo: dateOnly.optional(),
  hasRecurrence: z.boolean().optional(),
  isPinned: z.boolean().optional(),
  includeCompleted: z.boolean().optional(),
  sort: z.enum(['smart', 'due', 'created', 'updated', 'priority', 'title', 'manual']).optional(),
  includeSubtasks: z.boolean().optional(),
  limit: z.number().int().min(1).max(2000).optional(),
  offset: z.number().int().min(0).optional(),
});

export const reorderTasksSchema = z.object({
  /** The full ordered id list for the target list. */
  orderedIds: z.array(z.string()).min(1).max(2000),
});

export const bulkActionSchema = z.object({
  ids: z.array(z.string()).min(1).max(500),
  action: z.enum(['complete', 'delete', 'move', 'priority', 'addTag', 'removeTag']),
  listId: z.string().nullable().optional(),
  priority: priority.optional(),
  tagId: z.string().optional(),
});

export const moveTaskSchema = z.object({
  beforeSortOrder: z.string().nullable(),
  afterSortOrder: z.string().nullable(),
});

/* -------------------------------------------------------------------------- */
/* lists + tags                                                               */
/* -------------------------------------------------------------------------- */

export const createListSchema = z
  .object({
    name: z.string().min(1).max(200),
    description: z.string().max(2000).nullable().optional(),
    color: accentColor.optional(),
    emoji: z.string().max(16).nullable().optional(),
  })
  .strict();

export const updateListSchema = createListSchema.partial().extend({ archived: z.boolean().optional() }).strict();

export const reorderSchema = z.object({ orderedIds: z.array(z.string()).min(1).max(1000) });

export const createTagSchema = z
  .object({
    name: z.string().min(1).max(60),
    color: accentColor.optional(),
  })
  .strict();

export const updateTagSchema = createTagSchema.partial().strict();

export const mergeTagsSchema = z.object({ sourceId: z.string(), targetId: z.string() });

/* -------------------------------------------------------------------------- */
/* habits                                                                     */
/* -------------------------------------------------------------------------- */

export const habitFrequency = z.enum(['daily', 'weekly', 'monthly', 'custom']);
export const habitGoalType = z.enum(['boolean', 'count', 'duration']);

export const createHabitSchema = z
  .object({
    name: z.string().min(1).max(200),
    description: z.string().max(2000).nullable().optional(),
    icon: z.string().max(64).nullable().optional(),
    color: accentColor.optional(),
    goalType: habitGoalType.optional(),
    goalTarget: z.number().min(0).max(1_000_000).optional(),
    unit: z.string().max(24).nullable().optional(),
    frequency: habitFrequency.optional(),
    weekDays: z.array(z.number().int().min(0).max(6)).max(7).nullable().optional(),
    timesPerPeriod: z.number().int().min(1).max(100).optional(),
    startDate: dateOnly.optional(),
    reminderAt: timeOnly.nullable().optional(),
  })
  .strict();

export const updateHabitSchema = createHabitSchema
  .partial()
  .extend({ archived: z.boolean().optional() })
  .strict();

export const checkInSchema = z
  .object({
    date: dateOnly.optional(),
    /** `null` or `0` clears the entry. */
    count: z.number().min(0).max(1_000_000).nullable().optional(),
    value: z.number().min(0).max(1_000_000).nullable().optional(),
    note: z.string().max(2000).nullable().optional(),
    /** Adds to the existing count instead of replacing it. */
    delta: z.number().min(-1_000_000).max(1_000_000).optional(),
  })
  .strict();

/* -------------------------------------------------------------------------- */
/* calendars + events                                                         */
/* -------------------------------------------------------------------------- */

export const createCalendarSchema = z
  .object({
    name: z.string().min(1).max(200),
    description: z.string().max(2000).nullable().optional(),
    color: accentColor.optional(),
    timezone: z.string().max(64).optional(),
    isVisible: z.boolean().optional(),
    isDefault: z.boolean().optional(),
  })
  .strict();

export const updateCalendarSchema = createCalendarSchema
  .partial()
  .extend({ readOnly: z.boolean().optional(), colorOverride: z.string().max(32).nullable().optional() })
  .strict();

const attendee = z.object({
  name: z.string().max(200).optional(),
  email: z.string().max(320),
  status: z.string().max(32).optional(),
  role: z.string().max(32).optional(),
});

export const createEventSchema = z
  .object({
    calendarId: z.string().min(1),
    summary: z.string().max(2000),
    description: z.string().max(50_000).nullable().optional(),
    location: z.string().max(2000).nullable().optional(),
    url: z.string().max(2000).nullable().optional(),
    startMs: z.number().int().nullable().optional(),
    endMs: z.number().int().nullable().optional(),
    startDate: nullableDate.optional(),
    endDate: nullableDate.optional(),
    startTime: timeOnly.optional(),
    endTime: timeOnly.optional(),
    isAllDay: z.boolean().optional(),
    timezone: z.string().max(64).nullable().optional(),
    rrule: z.string().max(500).nullable().optional(),
    exdates: z.array(z.string().max(64)).max(500).nullable().optional(),
    status: z.enum(['confirmed', 'tentative', 'cancelled']).optional(),
    transparency: z.enum(['opaque', 'transparent']).optional(),
    attendees: z.array(attendee).max(200).nullable().optional(),
    reminders: z.array(z.number().int().min(-100_800).max(100_800)).max(20).nullable().optional(),
    color: z.string().max(32).nullable().optional(),
  })
  .strict();

export const updateEventSchema = createEventSchema.partial().extend({ clearRecurrence: z.boolean().optional() }).strict();

/* -------------------------------------------------------------------------- */
/* settings + caldav                                                          */
/* -------------------------------------------------------------------------- */

export const updateSettingsSchema = z
  .object({
    timezone: z.string().max(64).optional(),
    weekStartsOn: z.union([z.literal(0), z.literal(1)]).optional(),
    theme: z.enum(['light', 'dark', 'system']).optional(),
    accent: accentColor.optional(),
    timeFormat: z.enum(['12h', '24h']).optional(),
    defaultListId: z.string().nullable().optional(),
    smartListOrder: z.array(z.string()).max(40).nullable().optional(),
    pomodoroFocus: z.number().int().min(1).max(180).optional(),
    pomodoroShortBreak: z.number().int().min(1).max(60).optional(),
    pomodoroLongBreak: z.number().int().min(1).max(120).optional(),
    pomodoroLongBreakEvery: z.number().int().min(1).max(12).optional(),
    pomodoroAutoStartBreaks: z.boolean().optional(),
    notificationsEnabled: z.boolean().optional(),
    dailyDigestAt: timeOnly.nullable().optional(),
    defaultReminders: z.array(z.number().int()).max(10).nullable().optional(),
    reducedMotion: z.enum(['system', 'reduce']).optional(),
    reduceMotionLowPower: z.boolean().optional(),
    /**
     * Apprise endpoint and key. The URL shape is validated here, but it is never
     * fetched on save: a self-hosted gateway may be unreachable from the server
     * at that moment, and a save must not fail for it.
     */
    appriseUrl: appriseUrl.nullable().optional(),
    appriseKey: z.string().max(500).nullable().optional(),
    appriseTags: z.array(z.string().trim().min(1).max(64)).max(20).nullable().optional(),
  })
  .strict();

export const createAccountSchema = z
  .object({
    name: z.string().min(1).max(200),
    serverUrl: z.string().url().max(500),
    username: z.string().min(1).max(320),
    password: z.string().min(1).max(500),
    syncIntervalMinutes: z.number().int().min(1).max(1440).optional(),
    direction: z.enum(['auto', 'pull', 'push']).optional(),
  })
  .strict();

export const updateAccountSchema = createAccountSchema
  .partial()
  .extend({ enabled: z.boolean().optional() })
  .strict();

export const syncRequestSchema = z
  .object({
    kind: z.enum(['full', 'incremental', 'push', 'discover']).optional(),
    calendarId: z.string().optional(),
  })
  .strict();

/* -------------------------------------------------------------------------- */
/* focus + push + invites                                                     */
/* -------------------------------------------------------------------------- */

export const startFocusSchema = z
  .object({
    taskId: z.string().nullable().optional(),
    kind: z.enum(['focus', 'short_break', 'long_break']).optional(),
    plannedSeconds: z.number().int().min(1).max(24 * 3600),
  })
  .strict();

export const finishFocusSchema = z
  .object({
    completed: z.boolean(),
    actualSeconds: z.number().int().min(0).max(24 * 3600).optional(),
    note: z.string().max(2000).nullable().optional(),
  })
  .strict();

export const pushSubscribeSchema = z
  .object({
    endpoint: z.string().url().max(2000),
    keys: z.object({ p256dh: z.string().max(500), auth: z.string().max(500) }),
    userAgent: z.string().max(500).nullable().optional(),
  })
  .strict();

export const pushUnsubscribeSchema = z.object({ endpoint: z.string().url().max(2000) }).strict();

export const createInviteSchema = z
  .object({
    email: z.string().email().max(320),
    isAdmin: z.boolean().optional(),
    /** Days until expiry. */
    expiresInDays: z.number().int().min(1).max(365).optional(),
  })
  .strict();

export const createIcalTokenSchema = z
  .object({
    name: z.string().max(120).optional(),
    includeTasks: z.boolean().optional(),
    includeEvents: z.boolean().optional(),
    listIds: z.array(z.string()).max(200).nullable().optional(),
  })
  .strict();

/* -------------------------------------------------------------------------- */
/* auth flows                                                                 */
/* -------------------------------------------------------------------------- */

/** Passed through to better-auth's sign-up endpoint alongside its own fields. */
export const registerExtrasSchema = z.object({ inviteToken: z.string().max(200).optional() }).strict();

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1).max(500),
    newPassword: z.string().min(8).max(200),
  })
  .strict();
