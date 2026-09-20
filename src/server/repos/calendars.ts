/**
 * Calendar, event and CalDAV-account repository.
 *
 * Events carry the same soft-delete + dirty-tracking discipline as tasks so the
 * sync engine has a single mental model for both object kinds.
 *
 * Recurring events are stored ONCE, as a master row with an `rrule`. They are
 * expanded at read time into `CalendarItem`s by the aggregation service — never
 * materialised as rows, because that turns a one-line edit ("move the series an
 * hour later") into an unbounded write.
 */
import { and, asc, eq, gte, inArray, isNull, lt, lte, or, sql } from 'drizzle-orm';
import { getDb } from '../db';
import { caldavAccounts, calendarEvents, calendars } from '../db/schema';
import type { CalendarEventRow } from '../db/schema';
import { newId, encryptField, decryptField } from '../crypto';
import { keyBetween, spreadKeys } from '@/lib/fractional';
import { asAccentColor } from '@/lib/colors';
import { combineDateAndTime, dateOnlyToMillis, toDateOnly } from '@/lib/dates';
import type {
  AccentColor,
  Attendee,
  CaldavAccount,
  Calendar,
  CalendarEvent,
  DateOnly,
  EventStatus,
  EventTransparency,
  Millis,
  SyncDirection,
} from '@/lib/types';

/* -------------------------------------------------------------------------- */
/* calendars                                                                  */
/* -------------------------------------------------------------------------- */

function rowToCalendar(row: typeof calendars.$inferSelect): Calendar {
  return {
    id: row.id,
    userId: row.userId,
    name: row.name,
    description: row.description,
    color: asAccentColor(row.color),
    timezone: row.timezone,
    provider: row.provider,
    caldavAccountId: row.caldavAccountId,
    remoteHref: row.remoteHref,
    remoteCtag: row.remoteCtag,
    remoteSyncToken: row.remoteSyncToken,
    supportsVtodo: row.supportsVtodo,
    isVisible: row.isVisible,
    showInTasks: row.showInTasks,
    isDefault: row.isDefault,
    readOnly: row.readOnly,
    sortOrder: row.sortOrder,
    lastSyncedAtMs: row.lastSyncedAtMs,
    lastSyncError: row.lastSyncError,
    colorOverride: row.colorOverride,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function listCalendars(userId: string): Promise<Calendar[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(calendars)
    .where(and(eq(calendars.userId, userId), isNull(calendars.deletedAtMs)))
    .orderBy(asc(calendars.sortOrder), asc(calendars.name));
  return rows.map(rowToCalendar);
}

export async function getCalendar(userId: string, id: string): Promise<Calendar | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(calendars)
    .where(and(eq(calendars.id, id), eq(calendars.userId, userId), isNull(calendars.deletedAtMs)))
    .limit(1);
  return row ? rowToCalendar(row) : null;
}

export interface CreateCalendarInput {
  name: string;
  description?: string | null;
  color?: AccentColor;
  timezone?: string;
  isVisible?: boolean;
  showInTasks?: boolean;
  isDefault?: boolean;
}

export async function createCalendar(userId: string, input: CreateCalendarInput, userZone: string): Promise<Calendar> {
  const db = getDb();
  const [last] = await db
    .select({ sortOrder: calendars.sortOrder })
    .from(calendars)
    .where(and(eq(calendars.userId, userId), isNull(calendars.deletedAtMs)))
    .orderBy(asc(calendars.sortOrder))
    .limit(1);

  const id = newId();
  const now = Date.now();
  const isFirst = !last;

  await db.insert(calendars).values({
    id,
    userId,
    name: input.name.trim() || 'New calendar',
    description: input.description ?? null,
    color: input.color ?? 'blue',
    timezone: input.timezone ?? userZone,
    provider: 'local',
    supportsVtodo: true,
    isVisible: input.isVisible ?? true,
    showInTasks: input.showInTasks ?? true,
    isDefault: input.isDefault ?? isFirst,
    sortOrder: last ? keyBetween(last.sortOrder, null).key : 'a0',
    createdAt: now,
    updatedAt: now,
  });

  if (input.isDefault) await setDefaultCalendar(userId, id);

  const created = await getCalendar(userId, id);
  if (!created) throw new Error('Calendar insert did not persist');
  return created;
}

export async function updateCalendar(
  userId: string,
  id: string,
  input: Partial<CreateCalendarInput> & { readOnly?: boolean; colorOverride?: string | null },
): Promise<Calendar | null> {
  const db = getDb();
  const patch: Record<string, unknown> = { updatedAt: Date.now() };
  if (input.name !== undefined) patch.name = input.name.trim();
  if (input.description !== undefined) patch.description = input.description;
  if (input.color !== undefined) patch.color = input.color;
  if (input.timezone !== undefined) patch.timezone = input.timezone;
  if (input.isVisible !== undefined) patch.isVisible = input.isVisible;
  if (input.showInTasks !== undefined) patch.showInTasks = input.showInTasks;
  if (input.readOnly !== undefined) patch.readOnly = input.readOnly;
  if (input.colorOverride !== undefined) patch.colorOverride = input.colorOverride;

  await db.update(calendars).set(patch).where(and(eq(calendars.id, id), eq(calendars.userId, userId)));

  if (input.isDefault) await setDefaultCalendar(userId, id);

  return getCalendar(userId, id);
}

/** Exactly one calendar is the default; setting one clears the rest. */
export async function setDefaultCalendar(userId: string, id: string): Promise<void> {
  const db = getDb();
  await db.update(calendars).set({ isDefault: false }).where(eq(calendars.userId, userId));
  await db
    .update(calendars)
    .set({ isDefault: true, updatedAt: Date.now() })
    .where(and(eq(calendars.id, id), eq(calendars.userId, userId)));
}

/**
 * Deletes a calendar and everything in it.
 *
 * A remote-mirrored calendar is tombstoned so the sync engine can propagate the
 * removal; a local one is deleted outright. Either way the events go with it,
 * which is why the API requires an explicit `confirm: true` from the client.
 */
export async function deleteCalendar(userId: string, id: string): Promise<boolean> {
  const db = getDb();
  const calendar = await getCalendar(userId, id);
  if (!calendar) return false;

  const now = Date.now();

  if (calendar.provider === 'caldav') {
    // The remote collection still exists; we are only detaching from it. Keep
    // the rows synced so the user does not lose data by untracking a calendar.
    await db
      .update(calendars)
      .set({ deletedAtMs: now, updatedAt: now })
      .where(and(eq(calendars.id, id), eq(calendars.userId, userId)));
    return true;
  }

  const eventIds = await db
    .select({ id: calendarEvents.id })
    .from(calendarEvents)
    .where(and(eq(calendarEvents.userId, userId), eq(calendarEvents.calendarId, id)));

  if (eventIds.length) {
    await db.delete(calendarEvents).where(
      and(eq(calendarEvents.userId, userId), inArray(calendarEvents.id, eventIds.map((e) => e.id))),
    );
  }

  await db.delete(calendars).where(and(eq(calendars.id, id), eq(calendars.userId, userId)));

  // Never leave the user with no default calendar.
  const remaining = await listCalendars(userId);
  if (remaining.length && !remaining.some((c) => c.isDefault)) {
    await setDefaultCalendar(userId, remaining[0].id);
  }

  return true;
}

export async function reorderCalendars(userId: string, orderedIds: string[]): Promise<void> {
  const db = getDb();
  const keys = spreadKeys(orderedIds.length);
  for (let i = 0; i < orderedIds.length; i++) {
    await db
      .update(calendars)
      .set({ sortOrder: keys[i], updatedAt: Date.now() })
      .where(and(eq(calendars.id, orderedIds[i]), eq(calendars.userId, userId)));
  }
}

/* -------------------------------------------------------------------------- */
/* events                                                                     */
/* -------------------------------------------------------------------------- */

function rowToEvent(row: CalendarEventRow): CalendarEvent {
  return {
    id: row.id,
    userId: row.userId,
    calendarId: row.calendarId,
    uid: row.uid,
    recurrenceId: row.recurrenceId,
    summary: row.summary,
    description: row.description,
    location: row.location,
    url: row.url,
    startMs: row.startMs,
    endMs: row.endMs,
    startDate: row.startDate,
    endDate: row.endDate,
    isAllDay: row.isAllDay,
    timezone: row.timezone,
    rrule: row.rrule,
    exdates: row.exdates,
    rdates: row.rdates,
    status: row.status,
    transparency: row.transparency,
    organizer: row.organizer,
    attendees: row.attendees,
    categories: row.categories,
    reminders: row.reminders,
    color: row.color,
    rawIcs: row.rawIcs,
    syncProvider: row.syncProvider,
    syncState: row.syncState,
    externalHref: row.externalHref,
    externalEtag: row.externalEtag,
    remoteSequence: row.remoteSequence,
    lastSyncedAtMs: row.lastSyncedAtMs,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAtMs: row.deletedAtMs,
  };
}

export interface EventInput {
  calendarId: string;
  summary: string;
  description?: string | null;
  location?: string | null;
  url?: string | null;
  /** Timed events. */
  startMs?: Millis | null;
  endMs?: Millis | null;
  /** All-day events, floating. */
  startDate?: DateOnly | null;
  endDate?: DateOnly | null;
  startTime?: string | null;
  endTime?: string | null;
  isAllDay?: boolean;
  timezone?: string | null;
  rrule?: string | null;
  exdates?: string[] | null;
  status?: EventStatus;
  transparency?: EventTransparency;
  attendees?: Attendee[] | null;
  reminders?: number[] | null;
  color?: string | null;
}

/** Resolves the friendly input shape into the stored start/end representation. */
function resolveSpan(input: EventInput, fallbackZone: string) {
  const zone = input.timezone ?? fallbackZone;

  if (input.isAllDay || (input.startDate && !input.startTime && input.startMs === undefined)) {
    const startDate = input.startDate ?? (input.startMs ? toDateOnly(input.startMs, zone) : null);
    if (!startDate) return null;
    // RFC 5545 DTEND for a DATE value is exclusive; a single-day event has
    // DTEND = DTSTART + 1. We mirror that so the grid maths stays uniform.
    const endDate = input.endDate ?? startDate;
    return { startMs: null, endMs: null, startDate, endDate, isAllDay: true as const };
  }

  if (input.startMs === undefined || input.startMs === null) return null;
  const startMs = input.startMs;
  const endMs = input.endMs ?? startMs + 60 * 60 * 1000;
  return {
    startMs,
    endMs: Math.max(endMs, startMs),
    startDate: input.startDate ?? toDateOnly(startMs, zone),
    endDate: input.endDate ?? toDateOnly(endMs, zone),
    isAllDay: false as const,
  };
}

/** True when the target calendar is a writable CalDAV collection. */
async function calendarSyncsRemotely(userId: string, calendarId: string): Promise<boolean> {
  const calendar = await getCalendar(userId, calendarId);
  return Boolean(calendar && calendar.provider === 'caldav' && !calendar.readOnly);
}

/**
 * True when nothing will ever write this calendar's contents back.
 *
 * Three independent reasons: the collection itself refuses writes (a mirrored
 * `ical` feed, or a read-only `caldav` collection), or the `caldav` account it
 * belongs to is set to "Read only" (`direction: 'pull'`). The last one is not
 * visible on the calendar row — discovery reports such a collection as writable
 * — but the sync engine's `doPush = direction !== 'pull'` means a local edit is
 * never sent anywhere.
 *
 * `createEvent`/`updateEvent` refuse such a calendar, so a write that slipped
 * past the editor's read-only state fails with a message instead of landing
 * locally and silently never syncing.
 */
async function calendarRefusesWrites(userId: string, calendar: Calendar): Promise<boolean> {
  if (calendar.readOnly) return true;
  if (calendar.provider !== 'caldav' || !calendar.caldavAccountId) return false;
  const accounts = await listAccounts(userId);
  return accounts.some((account) => account.id === calendar.caldavAccountId && account.direction === 'pull');
}

export async function createEvent(userId: string, input: EventInput, userZone: string): Promise<CalendarEvent> {
  const db = getDb();
  const calendar = await getCalendar(userId, input.calendarId);
  if (!calendar) throw new Error('not-found');
  if (await calendarRefusesWrites(userId, calendar)) throw new Error('read-only');

  const zone = input.timezone ?? calendar.timezone ?? userZone;
  const span = resolveSpan(input, zone);
  if (!span) throw new Error('invalid-span');

  const id = newId();
  const now = Date.now();
  const remote = calendar.provider === 'caldav' && !calendar.readOnly;

  await db.insert(calendarEvents).values({
    id,
    userId,
    calendarId: input.calendarId,
    uid: newId().replace(/-/g, ''),
    summary: input.summary.trim(),
    description: input.description ?? null,
    location: input.location ?? null,
    url: input.url ?? null,
    startMs: span.startMs,
    endMs: span.endMs,
    startDate: span.startDate,
    endDate: span.endDate,
    isAllDay: span.isAllDay,
    timezone: zone,
    rrule: input.rrule ?? null,
    exdates: input.exdates ?? null,
    status: input.status ?? 'confirmed',
    transparency: input.transparency ?? 'opaque',
    attendees: input.attendees ?? null,
    reminders: input.reminders ?? null,
    color: input.color ?? null,
    syncProvider: remote ? 'caldav' : 'local',
    syncState: remote ? 'dirty' : 'synced',
    createdAt: now,
    updatedAt: now,
  });

  const created = await getEvent(userId, id);
  if (!created) throw new Error('Event insert did not persist');
  return created;
}

export async function getEvent(userId: string, id: string): Promise<CalendarEvent | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(calendarEvents)
    .where(and(eq(calendarEvents.id, id), eq(calendarEvents.userId, userId), isNull(calendarEvents.deletedAtMs)))
    .limit(1);
  return row ? rowToEvent(row) : null;
}

export async function updateEvent(
  userId: string,
  id: string,
  input: Partial<EventInput> & { clearRecurrence?: boolean },
  userZone: string,
): Promise<CalendarEvent | null> {
  const db = getDb();
  const existing = await getEvent(userId, id);
  if (!existing) return null;

  const zone = input.timezone ?? existing.timezone ?? userZone;
  const patch: Record<string, unknown> = { updatedAt: Date.now(), timezone: zone };

  if (input.summary !== undefined) patch.summary = input.summary.trim();
  if (input.description !== undefined) patch.description = input.description;
  if (input.location !== undefined) patch.location = input.location;
  if (input.url !== undefined) patch.url = input.url;
  if (input.status !== undefined) patch.status = input.status;
  if (input.transparency !== undefined) patch.transparency = input.transparency;
  if (input.attendees !== undefined) patch.attendees = input.attendees;
  if (input.reminders !== undefined) patch.reminders = input.reminders;
  if (input.color !== undefined) patch.color = input.color;
  if (input.exdates !== undefined) patch.exdates = input.exdates;
  if (input.clearRecurrence) patch.rrule = null;
  else if (input.rrule !== undefined) patch.rrule = input.rrule;

  const needsSpan =
    input.startMs !== undefined ||
    input.endMs !== undefined ||
    input.startDate !== undefined ||
    input.endDate !== undefined ||
    input.startTime !== undefined ||
    input.endTime !== undefined ||
    input.isAllDay !== undefined;

  if (needsSpan) {
    const merged: EventInput = {
      calendarId: input.calendarId ?? existing.calendarId,
      summary: input.summary ?? existing.summary,
      startMs: input.startMs !== undefined ? input.startMs : existing.startMs,
      endMs: input.endMs !== undefined ? input.endMs : existing.endMs,
      startDate: input.startDate !== undefined ? input.startDate : existing.startDate,
      endDate: input.endDate !== undefined ? input.endDate : existing.endDate,
      isAllDay: input.isAllDay ?? existing.isAllDay,
      timezone: zone,
    };

    // An edited clock time on an all-day event promotes it to a timed event.
    if (input.startTime) {
      const day = merged.startDate ?? (merged.startMs ? toDateOnly(merged.startMs, zone) : null);
      if (day) {
        merged.isAllDay = false;
        merged.startMs = combineDateAndTime(day, input.startTime, zone);
        merged.endMs = input.endTime ? combineDateAndTime(day, input.endTime, zone) : merged.startMs + 60 * 60 * 1000;
      }
    }

    const span = resolveSpan(merged, zone);
    if (span) {
      patch.startMs = span.startMs;
      patch.endMs = span.endMs;
      patch.startDate = span.startDate;
      patch.endDate = span.endDate;
      patch.isAllDay = span.isAllDay;
    }
  }

  if (input.calendarId !== undefined && input.calendarId !== existing.calendarId) {
    if (!(await getCalendar(userId, input.calendarId))) throw new Error('not-found');
    patch.calendarId = input.calendarId;
  }

  const targetCalendarId = (patch.calendarId as string | undefined) ?? existing.calendarId;
  const targetCalendar = await getCalendar(userId, targetCalendarId);
  if (!targetCalendar) throw new Error('not-found');
  if (await calendarRefusesWrites(userId, targetCalendar)) throw new Error('read-only');
  if (await calendarSyncsRemotely(userId, targetCalendarId)) {
    patch.syncState = 'dirty';
    patch.syncProvider = 'caldav';
  }

  await db.update(calendarEvents).set(patch).where(and(eq(calendarEvents.id, id), eq(calendarEvents.userId, userId)));
  return getEvent(userId, id);
}

export async function deleteEvent(userId: string, id: string): Promise<boolean> {
  const db = getDb();
  const existing = await getEvent(userId, id);
  if (!existing) return false;

  const now = Date.now();
  if (existing.syncProvider === 'caldav' && existing.externalHref) {
    await db
      .update(calendarEvents)
      .set({ deletedAtMs: now, syncState: 'pending_delete', updatedAt: now })
      .where(and(eq(calendarEvents.id, id), eq(calendarEvents.userId, userId)));
  } else {
    await db.delete(calendarEvents).where(and(eq(calendarEvents.id, id), eq(calendarEvents.userId, userId)));
  }
  return true;
}

/**
 * Events overlapping a range.
 *
 * With no `calendarIds`, only calendars marked visible are read — the feed and
 * search callers want that. A caller that has already decided which calendars
 * it wants (the calendar screen, and the task list with its `showInTasks`
 * filter) passes the ids, and no visibility rule is applied on top: the two
 * visibility flags are independent, and a calendar hidden from the calendar
 * screen can still be wanted in the task list.
 */
export async function eventsInRange(
  userId: string,
  startMs: Millis,
  endMs: Millis,
  zone: string,
  options: { calendarIds?: string[] } = {},
): Promise<CalendarEvent[]> {
  const db = getDb();
  const startDate = toDateOnly(startMs, zone);
  const endDate = toDateOnly(endMs, zone);

  let calendarIds: string[];
  if (options.calendarIds) {
    calendarIds = options.calendarIds;
  } else {
    const visibleCalendars = await db
      .select({ id: calendars.id })
      .from(calendars)
      .where(and(eq(calendars.userId, userId), eq(calendars.isVisible, true), isNull(calendars.deletedAtMs)));
    calendarIds = visibleCalendars.map((c) => c.id);
  }

  if (!calendarIds.length) return [];

  const rows = await db
    .select()
    .from(calendarEvents)
    .where(
      and(
        eq(calendarEvents.userId, userId),
        isNull(calendarEvents.deletedAtMs),
        inArray(calendarEvents.calendarId, calendarIds),
        or(
          // Timed events overlapping the window.
          and(gte(calendarEvents.endMs, startMs), lt(calendarEvents.startMs, endMs)),
          // All-day events overlapping the window (date compared as text).
          and(gte(calendarEvents.endDate, startDate), lte(calendarEvents.startDate, endDate)),
          // Recurring series that started before the window but may recur inside it.
          and(
            sql`${calendarEvents.rrule} is not null`,
            or(lte(calendarEvents.startMs, endMs), lte(calendarEvents.startDate, endDate)),
          ),
        ),
      ),
    )
    .limit(5000);

  return rows.map(rowToEvent);
}

/** Counts for the calendar sidebar. */
export async function calendarEventCounts(userId: string, fromMs: Millis, toMs: Millis): Promise<Record<string, number>> {
  const db = getDb();
  const rows = await db
    .select({ calendarId: calendarEvents.calendarId, count: sql<number>`count(*)` })
    .from(calendarEvents)
    .where(
      and(
        eq(calendarEvents.userId, userId),
        isNull(calendarEvents.deletedAtMs),
        gte(calendarEvents.startMs, fromMs),
        lt(calendarEvents.startMs, toMs),
      ),
    )
    .groupBy(calendarEvents.calendarId);

  const out: Record<string, number> = {};
  for (const row of rows) out[row.calendarId] = Number(row.count);
  return out;
}

/* -------------------------------------------------------------------------- */
/* CalDAV accounts                                                            */
/* -------------------------------------------------------------------------- */

function rowToAccount(row: typeof caldavAccounts.$inferSelect): CaldavAccount {
  return {
    id: row.id,
    userId: row.userId,
    name: row.name,
    serverUrl: row.serverUrl,
    username: row.username,
    enabled: row.enabled,
    syncIntervalMinutes: row.syncIntervalMinutes,
    direction: row.direction as SyncDirection,
    lastSyncAtMs: row.lastSyncAtMs,
    lastSyncStatus: row.lastSyncStatus as CaldavAccount['lastSyncStatus'],
    lastError: row.lastError,
    consecutiveFailures: row.consecutiveFailures,
    // The ciphertext never leaves the server; callers only need to know it exists.
    hasPassword: row.passwordEncrypted.length > 0,
  };
}

export async function listAccounts(userId: string): Promise<CaldavAccount[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(caldavAccounts)
    .where(and(eq(caldavAccounts.userId, userId), isNull(caldavAccounts.deletedAtMs)))
    .orderBy(asc(caldavAccounts.createdAt));
  return rows.map(rowToAccount);
}

export async function getAccount(userId: string, id: string): Promise<CaldavAccount | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(caldavAccounts)
    .where(and(eq(caldavAccounts.id, id), eq(caldavAccounts.userId, userId), isNull(caldavAccounts.deletedAtMs)))
    .limit(1);
  return row ? rowToAccount(row) : null;
}

export interface CreateAccountInput {
  name: string;
  serverUrl: string;
  username: string;
  password: string;
  syncIntervalMinutes?: number;
  direction?: SyncDirection;
}

export async function createAccount(userId: string, input: CreateAccountInput): Promise<CaldavAccount> {
  const db = getDb();
  const id = newId();
  const now = Date.now();

  await db.insert(caldavAccounts).values({
    id,
    userId,
    name: input.name.trim() || input.username,
    // Normalise: strip a trailing slash so href joining is predictable.
    serverUrl: input.serverUrl.trim().replace(/\/+$/, ''),
    username: input.username.trim(),
    passwordEncrypted: encryptField(input.password),
    syncIntervalMinutes: input.syncIntervalMinutes ?? 15,
    direction: input.direction ?? 'auto',
    lastSyncStatus: 'idle',
    createdAt: now,
    updatedAt: now,
  });

  const created = await getAccount(userId, id);
  if (!created) throw new Error('Account insert did not persist');
  return created;
}

export async function updateAccount(
  userId: string,
  id: string,
  input: Partial<CreateAccountInput> & { enabled?: boolean },
): Promise<CaldavAccount | null> {
  const db = getDb();
  const patch: Record<string, unknown> = { updatedAt: Date.now() };
  if (input.name !== undefined) patch.name = input.name.trim();
  if (input.serverUrl !== undefined) patch.serverUrl = input.serverUrl.trim().replace(/\/+$/, '');
  if (input.username !== undefined) patch.username = input.username.trim();
  if (input.password !== undefined && input.password !== '') patch.passwordEncrypted = encryptField(input.password);
  if (input.syncIntervalMinutes !== undefined) patch.syncIntervalMinutes = Math.max(1, input.syncIntervalMinutes);
  if (input.direction !== undefined) patch.direction = input.direction;
  if (input.enabled !== undefined) patch.enabled = input.enabled;

  await db.update(caldavAccounts).set(patch).where(and(eq(caldavAccounts.id, id), eq(caldavAccounts.userId, userId)));
  return getAccount(userId, id);
}

/**
 * Removes a CalDAV account.
 *
 * `keepData: true` (the default) detaches the calendars into local copies so the
 * user's events survive; otherwise the whole subtree is deleted.
 */
export async function deleteAccount(userId: string, id: string, keepData = true): Promise<boolean> {
  const db = getDb();
  const account = await getAccount(userId, id);
  if (!account) return false;

  const now = Date.now();

  if (keepData) {
    await db
      .update(calendars)
      .set({ caldavAccountId: null, provider: 'local', updatedAt: now })
      .where(and(eq(calendars.userId, userId), eq(calendars.caldavAccountId, id)));

    await db
      .update(caldavAccounts)
      .set({ deletedAtMs: now, enabled: false, passwordEncrypted: '', updatedAt: now })
      .where(and(eq(caldavAccounts.id, id), eq(caldavAccounts.userId, userId)));
  } else {
    const calendarIds = await db
      .select({ id: calendars.id })
      .from(calendars)
      .where(and(eq(calendars.userId, userId), eq(calendars.caldavAccountId, id)));

    if (calendarIds.length) {
      await db
        .delete(calendarEvents)
        .where(and(eq(calendarEvents.userId, userId), inArray(calendarEvents.calendarId, calendarIds.map((c) => c.id))));
      await db.delete(calendars).where(and(eq(calendars.userId, userId), inArray(calendars.id, calendarIds.map((c) => c.id))));
    }

    await db.delete(caldavAccounts).where(and(eq(caldavAccounts.id, id), eq(caldavAccounts.userId, userId)));
  }

  return true;
}

/**
 * The decrypted credentials for a sync run.
 *
 * Deliberately a separate function from `getAccount` so the plaintext password
 * cannot be returned by accident from a route handler.
 */
export async function getAccountCredentials(
  userId: string,
  id: string,
): Promise<{ serverUrl: string; username: string; password: string; direction: SyncDirection } | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(caldavAccounts)
    .where(and(eq(caldavAccounts.id, id), eq(caldavAccounts.userId, userId), isNull(caldavAccounts.deletedAtMs)))
    .limit(1);
  if (!row || !row.passwordEncrypted) return null;

  try {
    return {
      serverUrl: row.serverUrl,
      username: row.username,
      password: decryptField(row.passwordEncrypted),
      direction: row.direction as SyncDirection,
    };
  } catch {
    // Key rotation invalidates stored ciphertext; surface it as "re-enter".
    return null;
  }
}
