/**
 * Subscription sync against a real migrated SQLite file.
 *
 * The guarantees that matter to a user: events from the feed land, refreshing an
 * unchanged feed does nothing, a changed event updates in place rather than
 * duplicating, an event the feed drops is removed, and a feed that fails records
 * the failure instead of throwing into the scheduler.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetEnvCache } from '@/lib/env';
import { resetDialectCache } from '@/server/db/dialect';
import { closeDb, getDb } from '@/server/db';
import { calendarEvents, calendars, user } from '@/server/db/schema';
import {
  listIcalSubscriptions,
  subscribeToIcal,
  syncIcalCalendar,
  unsubscribeIcal,
} from '@/server/services/ical-subscription';
import { hasSubscribedCalendar, hasSyncableAccount } from '@/server/services/scheduler';

const USER_ID = 'user-ical-test';
let tempDir = '';

/** A VEVENT, with only the properties the test cares about spelled out. */
function vevent(uid: string, summary: string, start: string, end: string, extra: string[] = []): string {
  return [
    'BEGIN:VEVENT',
    `UID:${uid}`,
    'DTSTAMP:20260101T000000Z',
    `SUMMARY:${summary}`,
    `DTSTART:${start}`,
    `DTEND:${end}`,
    ...extra,
    'END:VEVENT',
  ].join('\r\n');
}

function feed(...events: string[]): string {
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Test//EN', ...events, 'END:VCALENDAR'].join('\r\n');
}

/** A fetch stub that always returns the given feed body. */
function stubFor(body: string, etag: string | null = null) {
  return (async () =>
    new Response(body, {
      status: 200,
      headers: etag ? { etag } : {},
    })) as unknown as typeof fetch;
}

async function eventRows(calendarId: string) {
  return getDb()
    .select()
    .from(calendarEvents)
    .where(and(eq(calendarEvents.userId, USER_ID), eq(calendarEvents.calendarId, calendarId)));
}

beforeEach(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tasktick-ical-'));
  const file = path.join(tempDir, 'ical.db');
  process.env.DATABASE_URL = `file:${file}`;
  process.env.BETTER_AUTH_SECRET = 'test-secret-test-secret-test-secret-0001';

  resetEnvCache();
  resetDialectCache();
  await closeDb();

  const handle = new Database(file);
  try {
    handle.pragma('journal_mode = WAL');
    handle.pragma('foreign_keys = ON');
    migrate(drizzle(handle), { migrationsFolder: path.join(process.cwd(), 'drizzle', 'sqlite') });
  } finally {
    handle.close();
  }

  await getDb().insert(user).values({
    id: USER_ID,
    name: 'Subscriber',
    email: 'subscriber@example.test',
    emailVerified: true,
    timezone: 'UTC',
  });
});

afterEach(async () => {
  await closeDb();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe('subscribeToIcal', () => {
  it('creates a read-only calendar and imports the feed it was given', async () => {
    const body = feed(
      vevent('a@test', 'Standup', '20260618T090000Z', '20260618T093000Z'),
      vevent('b@test', 'Review', '20260619T140000Z', '20260619T150000Z'),
    );

    const { calendar, sync } = await subscribeToIcal(
      USER_ID,
      { url: 'https://1.1.1.1/cal.ics', name: 'Team' },
      { fetchImpl: stubFor(body) },
    );

    expect(calendar.provider).toBe('ical');
    // Read-only matters: nothing may ever be written back to a feed.
    expect(calendar.readOnly).toBe(true);
    // The URL is kept so the scheduler can refresh it.
    expect(calendar.remoteHref).toBe('https://1.1.1.1/cal.ics');
    expect(sync.created).toBe(2);

    const rows = await eventRows(calendar.id);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.summary).sort()).toEqual(['Review', 'Standup']);
    expect(rows.every((r) => r.syncProvider === 'ical')).toBe(true);
  });

  it('stores the etag so the next poll can be conditional', async () => {
    const body = feed(vevent('a@test', 'Standup', '20260618T090000Z', '20260618T093000Z'));
    const { calendar } = await subscribeToIcal(
      USER_ID,
      { url: 'https://1.1.1.1/cal.ics' },
      { fetchImpl: stubFor(body, '"v1"') },
    );
    const [row] = await getDb().select().from(calendars).where(eq(calendars.id, calendar.id));
    expect(row.remoteCtag).toBe('"v1"');
  });

  it('refuses a payload that is not a calendar, and leaves nothing behind', async () => {
    // The calendar must not be created for a URL that is not a feed, or the user
    // gets a permanently empty calendar and no idea why.
    await expect(
      subscribeToIcal(USER_ID, { url: 'https://1.1.1.1/x' }, {
        fetchImpl: stubFor('<html>not a calendar</html>'),
      }),
    ).rejects.toThrow();

    const rows = await getDb().select().from(calendars).where(eq(calendars.userId, USER_ID));
    expect(rows).toHaveLength(0);
  });
});

describe('syncIcalCalendar', () => {
  it('does nothing when the feed has not changed', async () => {
    const body = feed(vevent('a@test', 'Standup', '20260618T090000Z', '20260618T093000Z'));
    const { calendar } = await subscribeToIcal(
      USER_ID,
      { url: 'https://1.1.1.1/cal.ics' },
      { fetchImpl: stubFor(body) },
    );

    const first = await syncIcalCalendar(USER_ID, calendar.id, { fetchImpl: stubFor(body) });
    expect(first.unchanged).toBe(1);
    expect(first.created).toBe(0);
    expect(first.updated).toBe(0);
    expect(await eventRows(calendar.id)).toHaveLength(1);
  });

  it('updates a changed event in place rather than duplicating it', async () => {
    const before = feed(vevent('a@test', 'Standup', '20260618T090000Z', '20260618T093000Z'));
    const after = feed(vevent('a@test', 'Standup (moved)', '20260618T100000Z', '20260618T103000Z'));

    const { calendar } = await subscribeToIcal(
      USER_ID,
      { url: 'https://1.1.1.1/cal.ics' },
      { fetchImpl: stubFor(before) },
    );
    const result = await syncIcalCalendar(USER_ID, calendar.id, { fetchImpl: stubFor(after) });

    expect(result.updated).toBe(1);
    expect(result.created).toBe(0);
    const rows = await eventRows(calendar.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].summary).toBe('Standup (moved)');
  });

  it('removes an event the feed no longer carries', async () => {
    const both = feed(
      vevent('a@test', 'Keep', '20260618T090000Z', '20260618T093000Z'),
      vevent('b@test', 'Drop', '20260619T090000Z', '20260619T093000Z'),
    );
    const onlyOne = feed(vevent('a@test', 'Keep', '20260618T090000Z', '20260618T093000Z'));

    const { calendar } = await subscribeToIcal(
      USER_ID,
      { url: 'https://1.1.1.1/cal.ics' },
      { fetchImpl: stubFor(both) },
    );
    expect(await eventRows(calendar.id)).toHaveLength(2);

    const result = await syncIcalCalendar(USER_ID, calendar.id, { fetchImpl: stubFor(onlyOne) });
    expect(result.deleted).toBe(1);
    const rows = await eventRows(calendar.id);
    expect(rows.map((r) => r.summary)).toEqual(['Keep']);
  });

  it('keeps two components that share a UID but differ by RECURRENCE-ID', async () => {
    // A recurring series plus one modified occurrence. Keying on UID alone would
    // collapse them and silently lose the exception.
    const body = feed(
      vevent('series@test', 'Weekly', '20260601T090000Z', '20260601T093000Z', [
        'RRULE:FREQ=WEEKLY;COUNT=4',
      ]),
      vevent('series@test', 'Weekly (moved)', '20260608T110000Z', '20260608T113000Z', [
        'RECURRENCE-ID:20260608T090000Z',
      ]),
    );

    const { calendar, sync } = await subscribeToIcal(
      USER_ID,
      { url: 'https://1.1.1.1/cal.ics' },
      { fetchImpl: stubFor(body) },
    );

    expect(sync.created).toBe(2);
    const rows = await eventRows(calendar.id);
    expect(rows).toHaveLength(2);
    expect(rows.some((r) => r.recurrenceId)).toBe(true);
  });

  it('records a failure instead of throwing, so the scheduler survives it', async () => {
    const body = feed(vevent('a@test', 'Standup', '20260618T090000Z', '20260618T093000Z'));
    const { calendar } = await subscribeToIcal(
      USER_ID,
      { url: 'https://1.1.1.1/cal.ics' },
      { fetchImpl: stubFor(body) },
    );

    const failing = (async () => new Response('gone', { status: 500 })) as unknown as typeof fetch;
    const result = await syncIcalCalendar(USER_ID, calendar.id, { fetchImpl: failing });

    expect(result.error).toBeTruthy();
    // The events already imported are untouched by a failed refresh.
    expect(await eventRows(calendar.id)).toHaveLength(1);

    const [row] = await getDb().select().from(calendars).where(eq(calendars.id, calendar.id));
    expect(row.lastSyncError).toBeTruthy();
  });

  it('clears the recorded error once a refresh succeeds', async () => {
    const body = feed(vevent('a@test', 'Standup', '20260618T090000Z', '20260618T093000Z'));
    const { calendar } = await subscribeToIcal(
      USER_ID,
      { url: 'https://1.1.1.1/cal.ics' },
      { fetchImpl: stubFor(body) },
    );

    const failing = (async () => new Response('gone', { status: 500 })) as unknown as typeof fetch;
    await syncIcalCalendar(USER_ID, calendar.id, { fetchImpl: failing });
    await syncIcalCalendar(USER_ID, calendar.id, { fetchImpl: stubFor(body) });

    const [row] = await getDb().select().from(calendars).where(eq(calendars.id, calendar.id));
    expect(row.lastSyncError).toBeNull();
    expect(row.lastSyncedAtMs).toBeTruthy();
  });

  it('refuses to sync a calendar that is not a subscription', async () => {
    const [row] = await getDb()
      .insert(calendars)
      .values({
        id: 'local-cal',
        userId: USER_ID,
        name: 'Local',
        color: 'blue',
        timezone: 'UTC',
        provider: 'local',
        sortOrder: 'a0',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
      .returning();

    const result = await syncIcalCalendar(USER_ID, row.id, { fetchImpl: stubFor('') });
    expect(result.error).toBe('not-found');
  });
});

describe('unsubscribeIcal', () => {
  it('removes the calendar and the events it mirrored', async () => {
    const body = feed(vevent('a@test', 'Standup', '20260618T090000Z', '20260618T093000Z'));
    const { calendar } = await subscribeToIcal(
      USER_ID,
      { url: 'https://1.1.1.1/cal.ics' },
      { fetchImpl: stubFor(body) },
    );

    expect(await unsubscribeIcal(USER_ID, calendar.id)).toBe(true);
    expect(await eventRows(calendar.id)).toHaveLength(0);
    expect(await listIcalSubscriptions(USER_ID)).toHaveLength(0);
  });

  it('will not remove a calendar that is not a subscription', async () => {
    await getDb().insert(calendars).values({
      id: 'local-cal-2',
      userId: USER_ID,
      name: 'Local',
      color: 'blue',
      timezone: 'UTC',
      provider: 'local',
      sortOrder: 'a0',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    expect(await unsubscribeIcal(USER_ID, 'local-cal-2')).toBe(false);
  });
});

describe('the scheduler starts for subscriptions', () => {
  /*
   * The refresh rides the CalDAV scheduler's ticker, and that ticker used to
   * start only when an enabled CalDAV account existed. A user whose only
   * integration was a feed therefore got a scheduler that never started and a
   * feed that never refreshed — silently, with nothing to show an error on.
   */
  it('reports a subscription as something to sync, with no CalDAV account', async () => {
    expect(await hasSyncableAccount()).toBe(false);
    expect(await hasSubscribedCalendar()).toBe(false);

    const body = feed(vevent('a@test', 'Standup', '20260618T090000Z', '20260618T093000Z'));
    await subscribeToIcal(USER_ID, { url: 'https://1.1.1.1/cal.ics' }, { fetchImpl: stubFor(body) });

    expect(await hasSubscribedCalendar()).toBe(true);
  });

  it('stops counting a subscription once it is removed', async () => {
    const body = feed(vevent('a@test', 'Standup', '20260618T090000Z', '20260618T093000Z'));
    const { calendar } = await subscribeToIcal(
      USER_ID,
      { url: 'https://1.1.1.1/cal.ics' },
      { fetchImpl: stubFor(body) },
    );
    await unsubscribeIcal(USER_ID, calendar.id);
    expect(await hasSubscribedCalendar()).toBe(false);
  });
});

describe('re-subscribing', () => {
  /*
   * `calendars` is unique on `(user_id, remote_href)` and unsubscribing
   * soft-deletes, so the removed row keeps the slot. Re-adding the same feed used
   * to fail with a raw constraint violation.
   */
  it('revives a removed feed instead of failing on the unique index', async () => {
    const body = feed(vevent('a@test', 'Standup', '20260618T090000Z', '20260618T093000Z'));

    const first = await subscribeToIcal(
      USER_ID,
      { url: 'https://1.1.1.1/cal.ics', name: 'Team' },
      { fetchImpl: stubFor(body) },
    );
    expect(await unsubscribeIcal(USER_ID, first.calendar.id)).toBe(true);
    expect(await listIcalSubscriptions(USER_ID)).toHaveLength(0);

    const again = await subscribeToIcal(
      USER_ID,
      { url: 'https://1.1.1.1/cal.ics', name: 'Team again' },
      { fetchImpl: stubFor(body) },
    );

    // The same row comes back, and its events are repopulated.
    expect(again.calendar.id).toBe(first.calendar.id);
    expect(again.calendar.name).toBe('Team again');
    expect(again.calendar.readOnly).toBe(true);
    expect(await eventRows(again.calendar.id)).toHaveLength(1);
    expect(await listIcalSubscriptions(USER_ID)).toHaveLength(1);
  });

  it('refuses a URL that a non-subscription calendar already claims', async () => {
    await getDb().insert(calendars).values({
      id: 'caldav-cal',
      userId: USER_ID,
      name: 'Work',
      color: 'blue',
      timezone: 'UTC',
      provider: 'caldav',
      remoteHref: 'https://1.1.1.1/cal.ics',
      sortOrder: 'a0',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    const body = feed(vevent('a@test', 'Standup', '20260618T090000Z', '20260618T093000Z'));
    // Reviving it would silently turn a CalDAV calendar into a feed.
    await expect(
      subscribeToIcal(USER_ID, { url: 'https://1.1.1.1/cal.ics' }, { fetchImpl: stubFor(body) }),
    ).rejects.toThrow();
  });
});

describe('a feed that reuses a UID', () => {
  /*
   * Found against the real `officeholidays.com` feed, which ships eight pairs of
   * distinct events sharing one UID — a national entry and a regional one for the
   * same holiday. RFC 5545 forbids it; publishers do it anyway.
   *
   * Keying purely on `(uid, recurrenceId)` made one row be compared against the
   * other forever, so every refresh reported those events as changed and rewrote
   * them. The test is that a second sync is a genuine no-op and both events
   * survive.
   */
  const ambiguous = feed(
    vevent('shared@test', 'Holiday', '20260619T000000Z', '20260620T000000Z', ['LOCATION:USA']),
    vevent('shared@test', 'Holiday (Regional)', '20260619T000000Z', '20260620T000000Z', [
      'LOCATION:USA: Alabama, Alaska',
    ]),
  );

  it('keeps both events rather than collapsing them', async () => {
    const { calendar, sync } = await subscribeToIcal(
      USER_ID,
      { url: 'https://1.1.1.1/cal.ics' },
      { fetchImpl: stubFor(ambiguous) },
    );
    expect(sync.created).toBe(2);
    expect(await eventRows(calendar.id)).toHaveLength(2);
  });

  it('does not report them as changed on every refresh', async () => {
    const { calendar } = await subscribeToIcal(
      USER_ID,
      { url: 'https://1.1.1.1/cal.ics' },
      { fetchImpl: stubFor(ambiguous) },
    );

    // The regression was `updated: 2` on every single poll, forever.
    for (const _round of [1, 2, 3]) {
      const result = await syncIcalCalendar(USER_ID, calendar.id, { fetchImpl: stubFor(ambiguous) });
      expect(result.created).toBe(0);
      expect(result.updated).toBe(0);
      expect(result.deleted).toBe(0);
      expect(result.unchanged).toBe(2);
    }
    expect(await eventRows(calendar.id)).toHaveLength(2);
  });
});
