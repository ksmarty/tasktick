/**
 * Dialect-agnostic domain types.
 *
 * These are the *only* types the UI, API routes and sync engine are allowed to
 * depend on. Drizzle row types stay inside `src/server/**` so that swapping the
 * SQLite schema for the Postgres mirror never leaks into application code.
 */

/* -------------------------------------------------------------------------- */
/* primitives                                                                 */
/* -------------------------------------------------------------------------- */

/** Epoch milliseconds. */
export type Millis = number;

/** Floating calendar day, `YYYY-MM-DD`, with no timezone attached. */
export type DateOnly = string;

/** `HH:mm`, 24-hour, no seconds. */
export type TimeOnly = string;

/**
 * The accent palette. Declared `as const` so the literal union can be derived
 * from it — that single declaration is what keeps `AccentColor`, the Zod enum in
 * `lib/schemas.ts`, and the CSS token names in `globals.css` from drifting.
 */
export const ACCENT_COLORS = [
  'blue',
  'indigo',
  'purple',
  'pink',
  'red',
  'orange',
  'yellow',
  'green',
  'teal',
  'cyan',
  'gray',
  'brown',
] as const;

export type AccentColor = (typeof ACCENT_COLORS)[number];

/* -------------------------------------------------------------------------- */
/* tasks                                                                      */
/* -------------------------------------------------------------------------- */

export type TaskStatus = 'todo' | 'completed' | 'wont_do';
export type Priority = 'none' | 'low' | 'medium' | 'high';

/** TickTick-style numeric priorities, used only when serialising to iCalendar. */
export const PRIORITY_TO_ICAL: Record<Priority, number> = {
  none: 0,
  low: 9, // RFC 5545: 9 = low
  medium: 5,
  high: 1,
};

export const ICAL_TO_PRIORITY: Record<number, Priority> = {
  0: 'none',
  1: 'high',
  2: 'high',
  3: 'high',
  4: 'high',
  5: 'medium',
  6: 'medium',
  7: 'low',
  8: 'low',
  9: 'low',
};

export type RecurrenceMode = 'due' | 'completion';

export interface SubTask {
  id: string;
  title: string;
  status: TaskStatus;
  completedAtMs: Millis | null;
  sortOrder: string;
}

export interface Reminder {
  id: string;
  /** Minutes before the due instant. Mutually exclusive with `absoluteAtMs`. */
  offsetMinutes: number | null;
  absoluteAtMs: Millis | null;
  fireAtMs: Millis;
  sent: boolean;
}

export interface Task {
  id: string;
  userId: string;
  listId: string | null;
  parentId: string | null;

  title: string;
  notes: string | null;
  url: string | null;

  status: TaskStatus;
  priority: Priority;

  dueAtMs: Millis | null;
  dueDate: DateOnly | null;
  startAtMs: Millis | null;
  startDate: DateOnly | null;
  isAllDay: boolean;
  timezone: string | null;

  completedAtMs: Millis | null;

  recurrenceRule: string | null;
  recurrenceMode: RecurrenceMode;
  recurrenceId: string | null;

  estimateMinutes: number | null;
  spentMinutes: number;
  sortOrder: string;
  isPinned: boolean;

  calendarId: string | null;

  syncProvider: SyncProvider;
  syncState: SyncState;
  externalUid: string | null;
  externalHref: string | null;
  externalEtag: string | null;
  lastSyncedAtMs: Millis | null;

  createdAt: Millis;
  updatedAt: Millis;
  deletedAtMs: Millis | null;

  /* ---- hydrated relations (present on read, optional on write) ---- */

  tagIds?: string[];
  tags?: Tag[];
  subtasks?: SubTask[];
  reminders?: Reminder[];
  /** Populated by the recurrence expander for a projected occurrence. */
  occurrenceAtMs?: Millis | null;
  /** True when the row came from expanding an RRULE rather than the DB directly. */
  isProjection?: boolean;
}

/* -------------------------------------------------------------------------- */
/* lists + tags + filters                                                     */
/* -------------------------------------------------------------------------- */

export interface List {
  id: string;
  userId: string;
  name: string;
  description: string | null;
  color: AccentColor;
  emoji: string | null;
  sortOrder: string;
  archived: boolean;
  isInbox: boolean;
  createdAt: Millis;
  updatedAt: Millis;
  /** Computed counts for the sidebar. */
  taskCount?: number;
  openTaskCount?: number;
}

export interface Tag {
  id: string;
  userId: string;
  name: string;
  color: AccentColor;
  taskCount?: number;
}

/** The serialisable shape of a smart list / saved filter. */
export interface TaskFilter {
  /** Free-text query matched against title + notes. */
  text?: string;
  listIds?: string[];
  tagIds?: string[];
  priorities?: Priority[];
  statuses?: TaskStatus[];
  /** Inclusive lower bound on the task's sort instant. */
  dueFrom?: DateOnly;
  /** Inclusive upper bound on the task's sort instant. */
  dueTo?: DateOnly;
  /** Relative window, e.g. `today` | `next7days` | `overdue` | `all`. */
  dueWindow?: DueWindow;
  hasRecurrence?: boolean;
  isPinned?: boolean;
  includeCompleted?: boolean;
}

export type DueWindow = 'overdue' | 'today' | 'tomorrow' | 'next7days' | 'next30days' | 'all' | 'noDate';

export type SmartListId =
  | 'today'
  | 'tomorrow'
  | 'next7days'
  | 'inbox'
  | 'all'
  | 'completed'
  | 'calendar'
  | 'pomodoro'
  | 'matrix'
  | 'habits'
  | 'search';

export interface SavedFilter {
  id: string;
  userId: string;
  name: string;
  icon: string | null;
  color: AccentColor;
  query: TaskFilter;
  sortOrder: string;
}

/* -------------------------------------------------------------------------- */
/* calendar                                                                   */
/* -------------------------------------------------------------------------- */

export type SyncProvider = 'local' | 'caldav' | 'ical';
export type SyncState = 'synced' | 'dirty' | 'pending_delete' | 'conflict';
export type CalendarProvider = 'local' | 'caldav' | 'ical';
export type EventStatus = 'confirmed' | 'tentative' | 'cancelled';
export type EventTransparency = 'opaque' | 'transparent';

export interface Calendar {
  id: string;
  userId: string;
  name: string;
  description: string | null;
  color: AccentColor;
  timezone: string;
  provider: CalendarProvider;
  caldavAccountId: string | null;
  remoteHref: string | null;
  remoteCtag: string | null;
  remoteSyncToken: string | null;
  supportsVtodo: boolean;
  isVisible: boolean;
  isDefault: boolean;
  readOnly: boolean;
  sortOrder: string;
  lastSyncedAtMs: Millis | null;
  lastSyncError: string | null;
  colorOverride: string | null;
  createdAt: Millis;
  updatedAt: Millis;
}

export interface Attendee {
  name?: string;
  email: string;
  /** RFC 5545 PARTSTAT: `ACCEPTED` | `DECLINED` | `TENTATIVE` | `NEEDS-ACTION`. */
  status?: string;
  role?: string;
}

export interface CalendarEvent {
  id: string;
  userId: string;
  calendarId: string;

  uid: string;
  recurrenceId: string | null;

  summary: string;
  description: string | null;
  location: string | null;
  url: string | null;

  startMs: Millis | null;
  endMs: Millis | null;
  startDate: DateOnly | null;
  endDate: DateOnly | null;
  isAllDay: boolean;
  timezone: string;

  rrule: string | null;
  exdates: string[] | null;
  rdates: string[] | null;

  status: EventStatus;
  transparency: EventTransparency;

  organizer: { name?: string; email?: string } | null;
  attendees: Attendee[] | null;
  categories: string[] | null;
  reminders: number[] | null;

  color: string | null;
  rawIcs: string | null;

  syncProvider: SyncProvider;
  syncState: SyncState;
  externalHref: string | null;
  externalEtag: string | null;
  remoteSequence: number | null;
  lastSyncedAtMs: Millis | null;

  createdAt: Millis;
  updatedAt: Millis;
  deletedAtMs: Millis | null;
}

/**
 * A single rendered block in the calendar. Both tasks and events are projected
 * into this shape so the grid renders one homogeneous list.
 */
export interface CalendarItem {
  /** `${kind}:${id}` — unique across both source tables. */
  key: string;
  kind: 'event' | 'task';
  id: string;
  title: string;
  startMs: Millis;
  /** Exclusive end. */
  endMs: Millis;
  isAllDay: boolean;
  color: AccentColor;
  calendarId: string | null;
  calendarName?: string;
  location?: string | null;
  /** Tasks only. */
  completed?: boolean;
  priority?: Priority;
  listId?: string | null;
  /** Recurring-series instance metadata. */
  seriesUid?: string | null;
  isRecurringInstance?: boolean;
  readonly?: boolean;
}

/* -------------------------------------------------------------------------- */
/* habits                                                                     */
/* -------------------------------------------------------------------------- */

export type HabitGoalType = 'boolean' | 'count' | 'duration';
export type HabitFrequency = 'daily' | 'weekly' | 'monthly' | 'custom';

export interface Habit {
  id: string;
  userId: string;
  name: string;
  description: string | null;
  icon: string | null;
  color: AccentColor;
  goalType: HabitGoalType;
  goalTarget: number;
  unit: string | null;
  frequency: HabitFrequency;
  /** Weekdays 0-6; only used when `frequency === 'custom'`. */
  weekDays: number[] | null;
  timesPerPeriod: number;
  startDate: DateOnly;
  reminderAtMs: Millis | null;
  archived: boolean;
  sortOrder: string;
  createdAt: Millis;
  updatedAt: Millis;

  /* ---- derived, computed per requested window ---- */
  /** Current consecutive-period streak, in periods. */
  streak?: number;
  longestStreak?: number;
  /** Completion ratio 0..1 for the requested window. */
  completionRate?: number;
  /** `date -> count` map for the requested window. */
  entries?: Record<DateOnly, number>;
  /** Whether the habit is done for the current period. */
  doneToday?: boolean;
  /** Units logged in the current period vs `goalTarget`. */
  progress?: number;
}

/* -------------------------------------------------------------------------- */
/* sync                                                                       */
/* -------------------------------------------------------------------------- */

export type SyncDirection = 'auto' | 'pull' | 'push';

export interface CaldavAccount {
  id: string;
  userId: string;
  name: string;
  serverUrl: string;
  username: string;
  enabled: boolean;
  syncIntervalMinutes: number;
  direction: SyncDirection;
  lastSyncAtMs: Millis | null;
  lastSyncStatus: 'idle' | 'running' | 'success' | 'error';
  lastError: string | null;
  consecutiveFailures: number;
  /** Never exposes the ciphertext — the API only reports whether one exists. */
  hasPassword: boolean;
}

export interface SyncLogEntry {
  id: string;
  accountId: string | null;
  calendarId: string | null;
  kind: 'full' | 'incremental' | 'push' | 'discover';
  status: 'running' | 'success' | 'error' | 'skipped';
  startedAtMs: Millis;
  finishedAtMs: Millis | null;
  pulled: number;
  pushed: number;
  deletedRemote: number;
  deletedLocal: number;
  conflicts: number;
  error: string | null;
}

export interface SyncConflict {
  id: string;
  entityType: string;
  entityId: string;
  entityTitle: string | null;
  resolution: 'local-wins' | 'remote-wins' | 'merged' | 'duplicated';
  localSnapshot: unknown;
  remoteSnapshot: unknown;
  resolvedAtMs: Millis;
}

export interface SyncResult {
  kind: 'full' | 'incremental' | 'push' | 'discover';
  status: 'success' | 'error' | 'skipped';
  pulled: number;
  pushed: number;
  deletedRemote: number;
  deletedLocal: number;
  conflicts: number;
  error?: string;
  /** Collections discovered during a `discover` run. */
  calendars?: { href: string; displayName: string; color: string | null; supportsVtodo: boolean; readOnly: boolean }[];
}

/* -------------------------------------------------------------------------- */
/* focus / pomodoro                                                           */
/* -------------------------------------------------------------------------- */

export type FocusKind = 'focus' | 'short_break' | 'long_break';

export interface FocusSession {
  id: string;
  userId: string;
  taskId: string | null;
  kind: FocusKind;
  startedAtMs: Millis;
  endedAtMs: Millis | null;
  plannedSeconds: number;
  actualSeconds: number;
  completed: boolean;
  note: string | null;
}

/* -------------------------------------------------------------------------- */
/* settings                                                                   */
/* -------------------------------------------------------------------------- */

export interface UserSettings {
  timezone: string;
  weekStartsOn: number;
  theme: 'light' | 'dark' | 'system';
  accent: AccentColor;
  timeFormat: '12h' | '24h';
  defaultListId: string | null;
  smartListOrder: string[] | null;
  pomodoroFocus: number;
  pomodoroShortBreak: number;
  pomodoroLongBreak: number;
  pomodoroLongBreakEvery: number;
  pomodoroAutoStartBreaks: boolean;
  notificationsEnabled: boolean;
  dailyDigestAt: string | null;
  defaultReminders: number[] | null;
  /** `system` follows the OS; `reduce` forces reduced motion on. */
  reducedMotion: ReducedMotionPreference;
  /** Opt-in to inferring Low Power Mode from throttled animation frames. */
  reduceMotionLowPower: boolean;
  /** Apprise API base URL; null when Apprise delivery is off. */
  appriseUrl: string | null;
  /** True when an Apprise key is stored. The key itself is write-only. */
  appriseKeyConfigured: boolean;
  /** Optional Apprise tags, or null when none are targeted. */
  appriseTags: string[] | null;
}

/** The reduced-motion preference. An OS request to reduce is always honoured. */
export type ReducedMotionPreference = 'system' | 'reduce';

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  image: string | null;
  isAdmin: boolean;
  timezone: string;
}

/* -------------------------------------------------------------------------- */
/* API envelope                                                               */
/* -------------------------------------------------------------------------- */

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string; code?: string };

/* -------------------------------------------------------------------------- */
/* view models                                                                */
/* -------------------------------------------------------------------------- */

export interface CalendarViewRange {
  /** Inclusive start instant. */
  startMs: Millis;
  /** Exclusive end instant. */
  endMs: Millis;
}

export interface AgendaGroup {
  date: DateOnly;
  label: string;
  items: Task[];
}

export interface ProductivityStats {
  /** Completed tasks per day for the trailing window. */
  completedByDay: { date: DateOnly; count: number }[];
  totalCompleted: number;
  totalCreated: number;
  /** Focus minutes per day. */
  focusByDay: { date: DateOnly; minutes: number }[];
  currentStreakDays: number;
}
