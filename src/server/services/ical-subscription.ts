/**
 * Inbound iCal subscriptions.
 *
 * A subscription mirrors a remote `.ics` feed into a local calendar. It is
 * one-way and read-only: the remote is the only source of truth, and nothing
 * here ever writes back. That is what makes it different from the CalDAV
 * integration next door, and it is why this does not reuse the CalDAV sync
 * engine — that engine exists to resolve *bilateral* conflicts (both sides can
 * edit, so it needs sync tokens, tombstones, dirty state and a merge policy).
 * For a feed, none of those questions exist. Reusing it would mean carrying a
 * conflict machine that can never fire.
 *
 * What it does share is the *mapping*: `eventInsertValues` from the sync mapper
 * turns a parsed VEVENT into row values, and that is the fiddly part — all-day
 * handling, floating times, timezone fallbacks, RRULE and EXDATE. Re-deriving it
 * here would mean two places that disagree about what a VEVENT means.
 *
 * ## Storage
 *
 * The feed URL lives in the calendar's `remoteHref` and the HTTP `ETag` in
 * `remoteCtag`. Those columns already mean "where the remote calendar lives" and
 * "the token that says whether it changed" for CalDAV, which is exactly what
 * they mean here, and reusing them keeps a read-only mirror from needing a
 * schema migration. `provider` is `'ical'` and `readOnly` is true.
 *
 * ## Refresh
 *
 * `syncDueIcalSubscriptions` is called from the existing scheduler tick. Feeds
 * are polled on a fixed interval with backoff on repeated failure, the same
 * shape the CalDAV scheduler uses, because a feed that has been down for a day
 * should not be hammered every fifteen minutes.
 */
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { getDb } from '@/server/db';
import { calendarEvents, calendars } from '@/server/db/schema';
import { newId } from '@/server/crypto';
import { parseIcsObject } from '@/server/caldav';
import type { ParsedEvent } from '@/server/caldav/types';
import { eventInsertValues, eventValuesFromParsed } from '@/server/sync/mapper';
import { FeedError, fetchFeed, type FetchedFeed } from './ical-fetch';
import type { Calendar, CalendarEvent } from '@/lib/types';

/** How often a feed is polled, when it is healthy. */
export const ICAL_REFRESH_MINUTES = 60;

/** Backoff ceiling after repeated failures — 6 hours. */
export const ICAL_MAX_BACKOFF_MS = 6 * 60 * 60 * 1000;

export const ICAL_FAILURE_BACKOFF_THRESHOLD = 3;

/**
 * How a mirrored event is identified.
 *
 * A feed's `UID` is the obvious identity and is not sufficient, for two reasons
 * both found in the wild:
 *
 *  1. **Recurrence.** A series and its modified instances share a UID and are
 *     told apart by `RECURRENCE-ID`. Keying on the UID alone collapses them and
 *     silently loses the exception.
 *  2. **Publishers that reuse a UID.** The public `officeholidays.com` feed ships
 *     eight pairs of distinct events sharing one UID — a national entry
 *     (`location: "USA"`) and a regional one (`location: "USA: Alabama, …"`) for
 *     the same holiday. RFC 5545 forbids it; publishers do it anyway.
 *
 * So matching happens in two steps. Events are grouped by *identity* —
 * `(uid, recurrenceId)`, which is what the spec says identifies an event — and
 * within a group they are matched by *content*. That gives the right answer on
 * both: an ordinary edit is a true update of the same row (rather than a delete
 * and an insert, which would churn the row id on every change), while two events
 * that the publisher gave one UID stay distinct and stop being compared against
 * each other on every poll.
 */
function identityKey(event: { uid: string; recurrenceId?: string | null }): string {
  return `${event.uid}\u0000${event.recurrenceId ?? ''}`;
}

/** The fields a publisher could legitimately use to mean "a different event". */
function contentKey(event: {
  summary?: string | null;
  location?: string | null;
  startMs?: number | null;
  startDate?: string | null;
}): string {
  return [event.summary ?? '', event.location ?? '', event.startMs ?? '', event.startDate ?? ''].join(
    '\u0000',
  );
}

/** A stored row's content, in the same shape as `contentKey`. */
function storedContentKey(row: {
  summary: string;
  location: string | null;
  startMs: number | null;
  startDate: string | null;
}): string {
  return contentKey(row);
}

export interface SubscribeInput {
  url: string;
  name?: string;
  color?: Calendar['color'];
  /**
   * A literal `#rrggbb` the user picked, stored in the calendar's
   * `colorOverride` so the calendar screen and the task list paint it verbatim
   * (see `calendarColorHex`/`itemHex`). `null` clears it back to the token in
   * `color`.
   */
  colorOverride?: string | null;
  timezone?: string;
  /** View preferences; only the re-subscribe path supplies these. */
  isVisible?: boolean;
  showInTasks?: boolean;
}

/** How a subscription is edited: the name and colour in place, or a new URL. */
export interface UpdateIcalSubscriptionInput {
  name?: string;
  color?: Calendar['color'];
  colorOverride?: string | null;
  /** A different URL is a re-subscribe; see `updateIcalSubscription`. */
  url?: string;
}

export interface UpdateIcalSubscriptionResult {
  calendar: Calendar;
  /** Present only when the URL changed and the feed was fetched afresh. */
  sync: IcalSyncResult | null;
}

export interface IcalSyncResult {
  calendarId: string;
  created: number;
  updated: number;
  deleted: number;
  unchanged: number;
  notModified: boolean;
  error: string | null;
}

/**
 * Create a subscription calendar and pull it once.
 *
 * The first fetch happens here rather than on the next scheduler tick so the
 * user gets immediate feedback: adding a URL that 404s should say so while they
 * are still looking at the form, not silently create an empty calendar.
 */
export async function subscribeToIcal(
  userId: string,
  input: SubscribeInput,
  deps: { fetchImpl?: typeof fetch; prefetched?: FetchedFeed } = {},
): Promise<{ calendar: Calendar; sync: IcalSyncResult }> {
  const db = getDb();
  const now = Date.now();

  // The feed is fetched before the calendar is created, so a unusable URL leaves
  // nothing behind. A caller that already fetched it (the re-subscribe path in
  // `updateIcalSubscription`) hands the body over rather than paying for a
  // second round trip.
  const fetched = deps.prefetched ?? (await fetchFeed(input.url, null, deps));
  const body = fetched.body;

  let parsed;
  try {
    parsed = parseIcsObject(body);
  } catch {
    throw new FeedError('invalid-url', 'That URL did not return a calendar.');
  }
  const events = parsed.objects.filter((o): o is ParsedEvent => o.kind === 'event');
  if (events.length === 0 && body.trim() && !body.includes('BEGIN:VCALENDAR')) {
    throw new FeedError('invalid-url', 'That URL did not return a calendar.');
  }

  // Prefer the feed's own name, then the user's, then the host — a subscription
  // called "Untitled" in a list of six is useless.
  const host = new URL(input.url.replace(/^webcal:\/\//i, 'https://')).hostname;
  const name = (input.name?.trim() || parsed.meta.name?.trim() || host).slice(0, 120);
  const url = input.url.trim();

  /*
   * A removed subscription is revived rather than re-created.
   *
   * `calendars` has a unique index on `(user_id, remote_href)` — it exists so a
   * CalDAV collection cannot be mirrored twice — and unsubscribing *soft*-deletes,
   * which leaves the row holding its slot. Without this, re-adding a feed you
   * removed a minute ago fails with a raw constraint violation.
   *
   * Reviving is also the behaviour a user expects: the feed is the identity, so
   * asking for it again should bring it back rather than refuse.
   */
  const existingRows = await db
    .select()
    .from(calendars)
    .where(and(eq(calendars.userId, userId), eq(calendars.remoteHref, url)))
    .limit(1);
  const existing = existingRows[0] as Calendar | undefined;

  if (existing && existing.provider !== 'ical') {
    // A CalDAV collection already claims this href. Refusing is the only honest
    // answer; reviving it would turn a CalDAV calendar into a feed.
    throw new FeedError('invalid-url', 'That URL is already used by another calendar.');
  }

  if (existing) {
    await db
      .update(calendars)
      .set({
        deletedAtMs: null,
        name,
        // Re-adding a feed is also how a colour change rides in: the revive
        // path is shared with re-subscribing, so it applies both.
        color: input.color ?? existing.color,
        colorOverride: input.colorOverride !== undefined ? input.colorOverride : existing.colorOverride,
        isVisible: input.isVisible ?? existing.isVisible,
        showInTasks: input.showInTasks ?? existing.showInTasks,
        provider: 'ical',
        readOnly: true,
        lastSyncError: null,
        updatedAt: now,
      })
      .where(eq(calendars.id, existing.id));
    // Its old events were deleted on unsubscribe, so the sync below repopulates.
    const revived = await getCalendarRow(userId, existing.id);
    if (!revived) throw new Error('not-found');
    const revivedSync = await applyFeed(userId, revived, body, fetched.etag);
    return { calendar: revived, sync: revivedSync };
  }

  const id = newId();

  await db.insert(calendars).values({
    id,
    userId,
    name,
    description: null,
    color: input.color ?? 'blue',
    timezone: input.timezone ?? parsed.meta.timezone ?? 'UTC',
    provider: 'ical',
    caldavAccountId: null,
    // Where the remote calendar lives, and the token that says if it changed.
    remoteHref: url,
    remoteCtag: null,
    remoteSyncToken: null,
    supportsVtodo: false,
    isVisible: input.isVisible ?? true,
    showInTasks: input.showInTasks ?? true,
    isDefault: false,
    // Nothing is ever written back, so the UI must not offer to edit it.
    readOnly: true,
    sortOrder: `a${String(now)}`,
    lastSyncedAtMs: null,
    lastSyncError: null,
    colorOverride: input.colorOverride ?? null,
    createdAt: now,
    updatedAt: now,
  });

  const calendar = await getCalendarRow(userId, id);
  if (!calendar) throw new Error('not-found');

  const sync = await applyFeed(userId, calendar, body, fetched.etag);
  return { calendar, sync };
}

async function getCalendarRow(userId: string, calendarId: string): Promise<Calendar | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(calendars)
    .where(and(eq(calendars.id, calendarId), eq(calendars.userId, userId), isNull(calendars.deletedAtMs)))
    .limit(1);
  return (rows[0] as Calendar | undefined) ?? null;
}

/**
 * Edit a subscription: its name and colour in place, or its URL as a
 * re-subscribe.
 *
 * The colour is the calendar's own: a palette token goes in `color`, a literal
 * `#rrggbb` in `colorOverride`. No second colour field is invented — the
 * calendar screen and the task-list strip already resolve exactly those two
 * through `calendarColorHex`/`itemHex`.
 *
 * The URL is the feed's identity (`calendars` is unique on
 * `(user_id, remote_href)`), so changing it is not an in-place rename: the old
 * mirror is removed and the new feed subscribed from scratch. The new feed is
 * fetched *before* the old one is dropped, so a URL that 404s leaves the
 * subscription the user already had untouched.
 */
export async function updateIcalSubscription(
  userId: string,
  calendarId: string,
  input: UpdateIcalSubscriptionInput,
  deps: { fetchImpl?: typeof fetch } = {},
): Promise<UpdateIcalSubscriptionResult | null> {
  const db = getDb();
  const calendar = await getCalendarRow(userId, calendarId);
  if (!calendar || calendar.provider !== 'ical') return null;

  const name = input.name?.trim();
  const nextUrl = input.url?.trim();

  if (nextUrl && nextUrl !== calendar.remoteHref) {
    // Validate first: a bad URL must fail without costing the existing feed.
    const fetched = await fetchFeed(nextUrl, null, deps);
    await unsubscribeIcal(userId, calendarId);
    const { calendar: recreated, sync } = await subscribeToIcal(
      userId,
      {
        url: nextUrl,
        name: name || calendar.name,
        color: input.color ?? calendar.color,
        colorOverride:
          input.colorOverride !== undefined ? input.colorOverride : calendar.colorOverride,
        timezone: calendar.timezone,
        // Carry the view preferences across the re-subscribe; a URL edit is not
        // a reason to put a hidden calendar back into the task list.
        isVisible: calendar.isVisible,
        showInTasks: calendar.showInTasks,
      },
      { ...deps, prefetched: fetched },
    );
    return { calendar: recreated, sync };
  }

  const patch: Partial<typeof calendars.$inferInsert> = { updatedAt: Date.now() };
  if (name) patch.name = name.slice(0, 120);
  if (input.color !== undefined) patch.color = input.color;
  if (input.colorOverride !== undefined) patch.colorOverride = input.colorOverride;
  await db.update(calendars).set(patch).where(and(eq(calendars.id, calendarId), eq(calendars.userId, userId)));

  const updated = await getCalendarRow(userId, calendarId);
  if (!updated) return null;
  return { calendar: updated, sync: null };
}

/**
 * Pull one subscription.
 *
 * Failures are recorded on the calendar rather than thrown, so a feed that is
 * down does not take the scheduler tick with it — the row's `lastSyncError` is
 * what the settings screen shows.
 */
export async function syncIcalCalendar(
  userId: string,
  calendarId: string,
  deps: { fetchImpl?: typeof fetch } = {},
): Promise<IcalSyncResult> {
  const db = getDb();
  const empty: IcalSyncResult = {
    calendarId,
    created: 0,
    updated: 0,
    deleted: 0,
    unchanged: 0,
    notModified: false,
    error: null,
  };

  const calendar = await getCalendarRow(userId, calendarId);
  if (!calendar || calendar.provider !== 'ical' || !calendar.remoteHref) {
    return { ...empty, error: 'not-found' };
  }

  try {
    const feed = await fetchFeed(calendar.remoteHref, calendar.remoteCtag, deps);
    if (feed.notModified) {
      await db
        .update(calendars)
        .set({ lastSyncedAtMs: Date.now(), lastSyncError: null, updatedAt: Date.now() })
        .where(eq(calendars.id, calendarId));
      return { ...empty, notModified: true };
    }
    const result = await applyFeed(userId, calendar, feed.body, feed.etag);
    return result;
  } catch (error) {
    const message =
      error instanceof FeedError ? error.message : 'The calendar could not be refreshed.';
    await db
      .update(calendars)
      .set({ lastSyncError: message, updatedAt: Date.now() })
      .where(eq(calendars.id, calendarId));
    return { ...empty, error: message };
  }
}

/** Parse a payload and reconcile the calendar's rows against it. */
async function applyFeed(
  userId: string,
  calendar: Calendar,
  body: string,
  etag: string | null,
): Promise<IcalSyncResult> {
  const db = getDb();
  const now = Date.now();

  let parsed;
  try {
    parsed = parseIcsObject(body);
  } catch {
    throw new FeedError('invalid-url', 'That calendar could not be read.');
  }

  const incoming = parsed.objects.filter((o): o is ParsedEvent => o.kind === 'event');
  const ctx = { userId, calendarId: calendar.id, timezone: calendar.timezone };

  const existing = await db
    .select({
      id: calendarEvents.id,
      uid: calendarEvents.uid,
      recurrenceId: calendarEvents.recurrenceId,
      summary: calendarEvents.summary,
      startMs: calendarEvents.startMs,
      endMs: calendarEvents.endMs,
      startDate: calendarEvents.startDate,
      rrule: calendarEvents.rrule,
      location: calendarEvents.location,
      description: calendarEvents.description,
      status: calendarEvents.status,
    })
    .from(calendarEvents)
    .where(and(eq(calendarEvents.userId, userId), eq(calendarEvents.calendarId, calendar.id)));

  // Group the stored rows by identity, and index each group's content so an
  // unchanged event can be recognised without rewriting it.
  const groups = new Map<string, typeof existing>();
  for (const row of existing) {
    const key = identityKey(row);
    const list = groups.get(key);
    if (list) list.push(row);
    else groups.set(key, [row]);
  }

  const claimed = new Set<string>();
  let created = 0;
  let updated = 0;
  let unchanged = 0;

  for (const object of incoming) {
    const event = object.event;
    const group = groups.get(identityKey({ uid: object.uid, recurrenceId: event.recurrenceId })) ?? [];

    // 1. An unclaimed row in this group whose content already matches: nothing to do.
    const same = group.find(
      (row) => !claimed.has(row.id) && storedContentKey(row) === contentKey(event),
    );
    if (same) {
      claimed.add(same.id);
      unchanged += 1;
      continue;
    }

    const values = eventInsertValues(object, ctx);

    // 2. An unclaimed row in this group with different content: this is that event,
    //    edited. Updating is what keeps an edit from churning the row id.
    const reuse = group.find((row) => !claimed.has(row.id));
    if (reuse) {
      claimed.add(reuse.id);
      const next = eventValuesFromParsed(object, ctx) as Record<string, unknown>;
      await db
        .update(calendarEvents)
        .set({ ...next, syncProvider: 'ical', syncState: 'synced', updatedAt: now } as typeof calendarEvents.$inferInsert)
        .where(eq(calendarEvents.id, reuse.id));
      updated += 1;
      continue;
    }

    // 3. Nothing to reuse: a new event.
    await db.insert(calendarEvents).values({
      // Spread first: `eventValuesFromParsed` carries `syncProvider: 'caldav'`
      // and a `syncState` of its own, and anything set before it would be
      // silently overwritten — which is how the first version of this ended up
      // writing CalDAV rows from an iCal feed, and then failing to find them
      // again when pruning.
      ...values,
      id: newId(),
      calendarId: calendar.id,
      userId,
      // A feed is the only writer here, so nothing is ever dirty.
      syncProvider: 'ical',
      syncState: 'synced',
      createdAt: now,
      updatedAt: now,
    } as typeof calendarEvents.$inferInsert);
    created += 1;
  }

  // Anything the feed no longer carries is gone. This is the one destructive
  // part of the sync, so it is scoped to this calendar and to events that were
  // themselves pulled from a feed — a locally created event in a subscription
  // calendar (which the UI does not offer, but the API would allow) is left
  // alone rather than deleted by a feed that never knew about it.
  const staleIds = existing.filter((row) => !claimed.has(row.id)).map((row) => row.id);

  let deleted = 0;
  if (staleIds.length > 0) {
    const removable = await db
      .select({ id: calendarEvents.id })
      .from(calendarEvents)
      .where(
        and(
          eq(calendarEvents.calendarId, calendar.id),
          inArray(calendarEvents.id, staleIds),
          eq(calendarEvents.syncProvider, 'ical'),
        ),
      );
    const ids = removable.map((r) => r.id);
    if (ids.length > 0) {
      await db.delete(calendarEvents).where(inArray(calendarEvents.id, ids));
      deleted = ids.length;
    }
  }

  await db
    .update(calendars)
    .set({
      lastSyncedAtMs: now,
      lastSyncError: null,
      remoteCtag: etag,
      updatedAt: now,
    })
    .where(eq(calendars.id, calendar.id));

  return {
    calendarId: calendar.id,
    created,
    updated,
    deleted,
    unchanged,
    notModified: false,
    error: null,
  };
}

/** Remove a subscription and everything it mirrored. */
export async function unsubscribeIcal(userId: string, calendarId: string): Promise<boolean> {
  const db = getDb();
  const calendar = await getCalendarRow(userId, calendarId);
  if (!calendar || calendar.provider !== 'ical') return false;

  // Soft-delete the calendar, and drop its mirrored events outright: they came
  // from the feed and would otherwise be orphaned rows nothing can reach.
  await db
    .delete(calendarEvents)
    .where(and(eq(calendarEvents.userId, userId), eq(calendarEvents.calendarId, calendarId)));
  await db
    .update(calendars)
    .set({ deletedAtMs: Date.now(), updatedAt: Date.now() })
    .where(eq(calendars.id, calendarId));
  return true;
}

export async function listIcalSubscriptions(userId: string): Promise<Calendar[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(calendars)
    .where(
      and(eq(calendars.userId, userId), eq(calendars.provider, 'ical'), isNull(calendars.deletedAtMs)),
    );
  return rows as Calendar[];
}

/**
 * Refresh the subscriptions that are due.
 *
 * Called from the scheduler tick. A feed is due when it has never synced, or
 * when its interval has elapsed — with a backoff that grows on consecutive
 * failures, so a feed that has been dead for a day is checked every few hours
 * rather than every hour forever.
 */
export async function syncDueIcalSubscriptions(
  now: number = Date.now(),
  deps: { fetchImpl?: typeof fetch } = {},
): Promise<IcalSyncResult[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(calendars)
    .where(and(eq(calendars.provider, 'ical'), isNull(calendars.deletedAtMs)));

  const results: IcalSyncResult[] = [];
  for (const row of rows as Calendar[]) {
    const last = row.lastSyncedAtMs ?? 0;
    const intervalMs = ICAL_REFRESH_MINUTES * 60 * 1000;
    // `lastSyncError` set means the previous attempt failed; the interval
    // doubles per failure up to the ceiling.
    const failing = Boolean(row.lastSyncError);
    const due = failing
      ? now - last >= Math.min(intervalMs * ICAL_FAILURE_BACKOFF_THRESHOLD, ICAL_MAX_BACKOFF_MS)
      : now - last >= intervalMs;
    if (!due) continue;
    results.push(await syncIcalCalendar(row.userId, row.id, deps));
  }
  return results;
}

/** Cheap count for the settings screen without loading the events. */
export async function icalEventCounts(userId: string): Promise<Record<string, number>> {
  const db = getDb();
  const rows = await db
    .select({ calendarId: calendarEvents.calendarId, count: sql<number>`count(*)` })
    .from(calendarEvents)
    .where(eq(calendarEvents.userId, userId))
    .groupBy(calendarEvents.calendarId);
  const out: Record<string, number> = {};
  for (const row of rows) out[row.calendarId] = Number(row.count ?? 0);
  return out;
}
