/**
 * Per-user settings, focus (Pomodoro) sessions, push subscriptions and the
 * read-only ICS feed tokens.
 */
import { and, desc, eq, gte, isNull, sql } from 'drizzle-orm';
import { getDb } from '../db';
import { focusSessions, icalTokens, pushSubscriptions, taskCompletions, tasks, userSettings } from '../db/schema';
import { newId, randomToken } from '../crypto';
import { asAccentColor } from '@/lib/colors';
import { getEnv } from '@/lib/env';
import { todayIn } from '@/lib/dates';
import type { FocusKind, FocusSession, ProductivityStats, UserSettings } from '@/lib/types';

/* -------------------------------------------------------------------------- */
/* settings                                                                   */
/* -------------------------------------------------------------------------- */

export const DEFAULT_SETTINGS: UserSettings = {
  timezone: 'UTC',
  weekStartsOn: 1,
  theme: 'system',
  accent: 'blue',
  timeFormat: '24h',
  defaultListId: null,
  smartListOrder: null,
  pomodoroFocus: 25,
  pomodoroShortBreak: 5,
  pomodoroLongBreak: 15,
  pomodoroLongBreakEvery: 4,
  pomodoroAutoStartBreaks: true,
  notificationsEnabled: true,
  dailyDigestAt: null,
  defaultReminders: [0],
};

function rowToSettings(row: typeof userSettings.$inferSelect): UserSettings {
  return {
    timezone: row.timezone,
    weekStartsOn: row.weekStartsOn,
    theme: (row.theme as UserSettings['theme']) ?? 'system',
    accent: asAccentColor(row.accent),
    timeFormat: row.timeFormat === '12h' ? '12h' : '24h',
    defaultListId: row.defaultListId,
    smartListOrder: row.smartListOrder,
    pomodoroFocus: row.pomodoroFocus,
    pomodoroShortBreak: row.pomodoroShortBreak,
    pomodoroLongBreak: row.pomodoroLongBreak,
    pomodoroLongBreakEvery: row.pomodoroLongBreakEvery,
    pomodoroAutoStartBreaks: row.pomodoroAutoStartBreaks,
    notificationsEnabled: row.notificationsEnabled,
    dailyDigestAt: row.dailyDigestAt,
    defaultReminders: row.defaultReminders,
  };
}

/** Settings always exist; a missing row is created from the env defaults. */
export async function getSettings(userId: string): Promise<UserSettings> {
  const db = getDb();
  const [row] = await db.select().from(userSettings).where(eq(userSettings.userId, userId)).limit(1);
  if (row) return rowToSettings(row);

  const env = getEnv();
  const created: UserSettings = {
    ...DEFAULT_SETTINGS,
    timezone: env.DEFAULT_TIMEZONE,
    weekStartsOn: env.DEFAULT_WEEK_START,
    timeFormat: env.DEFAULT_TIME_FORMAT,
  };
  await db.insert(userSettings).values({ userId, ...created }).onConflictDoNothing();
  return created;
}

export async function updateSettings(userId: string, input: Partial<UserSettings>): Promise<UserSettings> {
  const db = getDb();
  const current = await getSettings(userId);

  const patch: Record<string, unknown> = { updatedAt: Date.now() };
  if (input.timezone !== undefined) patch.timezone = input.timezone;
  if (input.weekStartsOn !== undefined) patch.weekStartsOn = input.weekStartsOn === 0 ? 0 : 1;
  if (input.theme !== undefined) patch.theme = input.theme;
  if (input.accent !== undefined) patch.accent = input.accent;
  if (input.timeFormat !== undefined) patch.timeFormat = input.timeFormat;
  if (input.defaultListId !== undefined) patch.defaultListId = input.defaultListId;
  if (input.smartListOrder !== undefined) patch.smartListOrder = input.smartListOrder;
  if (input.pomodoroFocus !== undefined) patch.pomodoroFocus = clamp(input.pomodoroFocus, 1, 180);
  if (input.pomodoroShortBreak !== undefined) patch.pomodoroShortBreak = clamp(input.pomodoroShortBreak, 1, 60);
  if (input.pomodoroLongBreak !== undefined) patch.pomodoroLongBreak = clamp(input.pomodoroLongBreak, 1, 120);
  if (input.pomodoroLongBreakEvery !== undefined) patch.pomodoroLongBreakEvery = clamp(input.pomodoroLongBreakEvery, 1, 12);
  if (input.pomodoroAutoStartBreaks !== undefined) patch.pomodoroAutoStartBreaks = input.pomodoroAutoStartBreaks;
  if (input.notificationsEnabled !== undefined) patch.notificationsEnabled = input.notificationsEnabled;
  if (input.dailyDigestAt !== undefined) patch.dailyDigestAt = input.dailyDigestAt;
  if (input.defaultReminders !== undefined) patch.defaultReminders = input.defaultReminders;

  await db.update(userSettings).set(patch).where(eq(userSettings.userId, userId));
  void current;
  return getSettings(userId);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}

/* -------------------------------------------------------------------------- */
/* focus sessions                                                             */
/* -------------------------------------------------------------------------- */

export interface StartFocusInput {
  taskId?: string | null;
  kind?: FocusKind;
  plannedSeconds: number;
}

export async function startFocusSession(userId: string, input: StartFocusInput): Promise<FocusSession> {
  const db = getDb();
  const id = newId();
  const now = Date.now();

  await db.insert(focusSessions).values({
    id,
    userId,
    taskId: input.taskId ?? null,
    kind: input.kind ?? 'focus',
    startedAtMs: now,
    plannedSeconds: Math.max(1, Math.round(input.plannedSeconds)),
    actualSeconds: 0,
    completed: false,
  });

  const [row] = await db.select().from(focusSessions).where(eq(focusSessions.id, id)).limit(1);
  return rowToFocus(row);
}

export async function finishFocusSession(
  userId: string,
  id: string,
  input: { completed: boolean; actualSeconds?: number; note?: string | null },
): Promise<FocusSession | null> {
  const db = getDb();
  const [existing] = await db
    .select()
    .from(focusSessions)
    .where(and(eq(focusSessions.id, id), eq(focusSessions.userId, userId)))
    .limit(1);
  if (!existing) return null;

  const endedAtMs = Date.now();
  const actualSeconds =
    input.actualSeconds ?? Math.max(0, Math.round((endedAtMs - existing.startedAtMs) / 1000));

  await db
    .update(focusSessions)
    .set({ endedAtMs, actualSeconds, completed: input.completed, note: input.note ?? null, updatedAt: endedAtMs })
    .where(and(eq(focusSessions.id, id), eq(focusSessions.userId, userId)));

  // Roll the time into the task's spent counter so estimates stay meaningful.
  if (existing.taskId && actualSeconds > 0 && input.completed) {
    await db
      .update(tasks)
      .set({ spentMinutes: sql`${tasks.spentMinutes} + ${Math.round(actualSeconds / 60)}`, updatedAt: endedAtMs })
      .where(and(eq(tasks.id, existing.taskId), eq(tasks.userId, userId)));
  }

  const [row] = await db.select().from(focusSessions).where(eq(focusSessions.id, id)).limit(1);
  return row ? rowToFocus(row) : null;
}

function rowToFocus(row: typeof focusSessions.$inferSelect): FocusSession {
  return {
    id: row.id,
    userId: row.userId,
    taskId: row.taskId,
    kind: row.kind,
    startedAtMs: row.startedAtMs,
    endedAtMs: row.endedAtMs,
    plannedSeconds: row.plannedSeconds,
    actualSeconds: row.actualSeconds,
    completed: row.completed,
    note: row.note,
  };
}

export async function recentFocusSessions(userId: string, limit = 20): Promise<FocusSession[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(focusSessions)
    .where(eq(focusSessions.userId, userId))
    .orderBy(desc(focusSessions.startedAtMs))
    .limit(Math.min(limit, 200));
  return rows.map(rowToFocus);
}

/** Completed focus sessions today, used to decide short vs long break. */
export async function focusCountToday(userId: string, zone: string): Promise<number> {
  const db = getDb();
  const startOfDay = new Date(`${todayIn(zone)}T00:00:00Z`).getTime();
  const [row] = await db
    .select({ count: sql<number>`count(*)` })
    .from(focusSessions)
    .where(
      and(
        eq(focusSessions.userId, userId),
        eq(focusSessions.kind, 'focus'),
        eq(focusSessions.completed, true),
        gte(focusSessions.startedAtMs, startOfDay),
      ),
    );
  return Number(row?.count ?? 0);
}

/* -------------------------------------------------------------------------- */
/* statistics                                                                 */
/* -------------------------------------------------------------------------- */

export interface StatsOptions {
  userId: string;
  zone: string;
  /** Trailing window in days. */
  days?: number;
}

export async function buildStats(options: StatsOptions): Promise<ProductivityStats> {
  const db = getDb();
  const { userId, zone, days = 30 } = options;

  const since = Date.now() - days * 86_400_000;

  const completed = await db
    .select({ completedAtMs: taskCompletions.completedAtMs })
    .from(taskCompletions)
    .where(and(eq(taskCompletions.userId, userId), gte(taskCompletions.completedAtMs, since)));

  const created = await db
    .select({ createdAt: tasks.createdAt })
    .from(tasks)
    .where(and(eq(tasks.userId, userId), gte(tasks.createdAt, since), isNull(tasks.deletedAtMs)));

  const focus = await db
    .select({ startedAtMs: focusSessions.startedAtMs, actualSeconds: focusSessions.actualSeconds })
    .from(focusSessions)
    .where(and(eq(focusSessions.userId, userId), eq(focusSessions.kind, 'focus'), gte(focusSessions.startedAtMs, since)));

  // Bucket by floating day so the numbers line up with the user's calendar.
  const byDay = new Map<string, number>();
  const focusByDay = new Map<string, number>();

  const dayKey = (ms: number) => {
    const d = new Date(ms);
    void d;
    return ms;
  };
  void dayKey;

  const { toDateOnly } = await import('@/lib/dates');

  for (const row of completed) {
    const key = toDateOnly(row.completedAtMs, zone);
    byDay.set(key, (byDay.get(key) ?? 0) + 1);
  }
  for (const row of focus) {
    const key = toDateOnly(row.startedAtMs, zone);
    focusByDay.set(key, (focusByDay.get(key) ?? 0) + Math.round(row.actualSeconds / 60));
  }

  const createdByDay = new Map<string, number>();
  for (const row of created) {
    const key = toDateOnly(row.createdAt, zone);
    createdByDay.set(key, (createdByDay.get(key) ?? 0) + 1);
  }

  const series: { date: string; count: number }[] = [];
  const focusSeries: { date: string; minutes: number }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const key = toDateOnly(Date.now() - i * 86_400_000, zone);
    series.push({ date: key, count: byDay.get(key) ?? 0 });
    focusSeries.push({ date: key, minutes: focusByDay.get(key) ?? 0 });
  }

  // Current run of consecutive days with at least one completion.
  let currentStreakDays = 0;
  for (let i = series.length - 1; i >= 0; i--) {
    if (series[i].count > 0) currentStreakDays++;
    else if (i === series.length - 1) continue; // today may still be empty
    else break;
  }

  return {
    completedByDay: series,
    totalCompleted: completed.length,
    totalCreated: created.length,
    focusByDay: focusSeries,
    currentStreakDays,
  };
}

/* -------------------------------------------------------------------------- */
/* push subscriptions                                                         */
/* -------------------------------------------------------------------------- */

export interface PushSubscriptionInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  userAgent?: string | null;
}

export async function savePushSubscription(userId: string, input: PushSubscriptionInput): Promise<void> {
  const db = getDb();
  const now = Date.now();

  // An endpoint identifies a device, not a user: re-subscribing the same device
  // must move it to the current account rather than create a duplicate.
  await db
    .insert(pushSubscriptions)
    .values({
      id: newId(),
      userId,
      endpoint: input.endpoint,
      p256dh: input.keys.p256dh,
      auth: input.keys.auth,
      userAgent: input.userAgent ?? null,
      failureCount: 0,
      lastUsedAtMs: now,
    })
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: {
        userId,
        p256dh: input.keys.p256dh,
        auth: input.keys.auth,
        failureCount: 0,
        updatedAt: now,
      },
    });
}

export async function removePushSubscription(userId: string, endpoint: string): Promise<void> {
  const db = getDb();
  await db
    .delete(pushSubscriptions)
    .where(and(eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.endpoint, endpoint)));
}

export async function countPushSubscriptions(userId: string): Promise<number> {
  const db = getDb();
  const [row] = await db
    .select({ count: sql<number>`count(*)` })
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.userId, userId));
  return Number(row?.count ?? 0);
}

/* -------------------------------------------------------------------------- */
/* ICS feed tokens                                                            */
/* -------------------------------------------------------------------------- */

export interface IcalTokenView {
  id: string;
  name: string;
  /** Full subscription URL; only returned at creation time and on demand. */
  url: string;
  includeTasks: boolean;
  includeEvents: boolean;
  lastUsedAtMs: number | null;
  createdAt: number;
}

/**
 * Base URL for subscription links.
 *
 * The caller passes the origin the request actually arrived on, which matters on
 * a LAN: with only `APP_URL` to go on, a user browsing to `192.168.1.50:3000`
 * would be handed a `webcal://localhost:3000/...` link their phone cannot open.
 * Falls back to `APP_URL` for callers that have no request (the scheduler, say).
 */
function resolveBaseUrl(baseUrl?: string): string {
  return (baseUrl && baseUrl.trim() ? baseUrl : getEnv().APP_URL).replace(/\/$/, '');
}

export async function listIcalTokens(userId: string, baseUrl?: string): Promise<IcalTokenView[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(icalTokens)
    .where(and(eq(icalTokens.userId, userId), isNull(icalTokens.revokedAtMs)))
    .orderBy(desc(icalTokens.createdAt));

  const base = resolveBaseUrl(baseUrl);
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    url: `${base}/api/ical/${row.token}`,
    includeTasks: row.includeTasks,
    includeEvents: row.includeEvents,
    lastUsedAtMs: row.lastUsedAtMs,
    createdAt: row.createdAt,
  }));
}

export async function createIcalToken(
  userId: string,
  input: { name?: string; includeTasks?: boolean; includeEvents?: boolean; listIds?: string[] | null },
  baseUrl?: string,
): Promise<IcalTokenView> {
  const db = getDb();
  const id = newId();
  const token = randomToken(24);
  const now = Date.now();

  await db.insert(icalTokens).values({
    id,
    userId,
    token,
    name: input.name?.trim() || 'Subscription',
    includeTasks: input.includeTasks ?? true,
    includeEvents: input.includeEvents ?? true,
    listIds: input.listIds ?? null,
    createdAt: now,
    updatedAt: now,
  });

  const base = resolveBaseUrl(baseUrl);
  return {
    id,
    name: input.name?.trim() || 'Subscription',
    url: `${base}/api/ical/${token}`,
    includeTasks: input.includeTasks ?? true,
    includeEvents: input.includeEvents ?? true,
    lastUsedAtMs: null,
    createdAt: now,
  };
}

export async function revokeIcalToken(userId: string, id: string): Promise<boolean> {
  const db = getDb();
  const result = await db
    .update(icalTokens)
    .set({ revokedAtMs: Date.now() })
    .where(and(eq(icalTokens.id, id), eq(icalTokens.userId, userId)));
  void result;
  return true;
}

/** Resolves a feed token to its owner without leaking whether the token existed. */
export async function resolveIcalToken(token: string): Promise<{
  userId: string;
  includeTasks: boolean;
  includeEvents: boolean;
  listIds: string[] | null;
  id: string;
} | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(icalTokens)
    .where(and(eq(icalTokens.token, token), isNull(icalTokens.revokedAtMs)))
    .limit(1);
  if (!row) return null;

  // Best-effort usage stamp; a failure here must not break the feed.
  void db
    .update(icalTokens)
    .set({ lastUsedAtMs: Date.now() })
    .where(eq(icalTokens.id, row.id))
    .catch(() => undefined);

  return {
    id: row.id,
    userId: row.userId,
    includeTasks: row.includeTasks,
    includeEvents: row.includeEvents,
    listIds: row.listIds,
  };
}
