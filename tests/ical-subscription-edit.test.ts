/**
 * Editing an inbound iCal subscription.
 *
 * The feature is "rename, recolour, and re-point a feed", so these tests pin the
 * parts that are easy to get wrong: an edit must not churn the mirrored events,
 * a custom colour must land in the calendar's `colorOverride` (the field the
 * calendar screen and the task-list strip already resolve), and a changed URL
 * must re-subscribe — while a *bad* new URL must not cost the user the
 * subscription they already have.
 *
 * Real migrated SQLite, same shape as `ical-subscription.test.ts`.
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
  updateIcalSubscription,
} from '@/server/services/ical-subscription';
import { FeedError } from '@/server/services/ical-fetch';

const USER_ID = 'user-ical-edit';
let tempDir = '';

function vevent(uid: string, summary: string, start: string, end: string): string {
  return [
    'BEGIN:VEVENT',
    `UID:${uid}`,
    'DTSTAMP:20260101T000000Z',
    `SUMMARY:${summary}`,
    `DTSTART:${start}`,
    `DTEND:${end}`,
    'END:VEVENT',
  ].join('\r\n');
}

function feed(...events: string[]): string {
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Test//EN', ...events, 'END:VCALENDAR'].join('\r\n');
}

function stubFor(body: string) {
  return (async () => new Response(body, { status: 200 })) as unknown as typeof fetch;
}

/** A fetch that picks a body by URL, so a re-subscribe can be told from a refresh. */
function routeFetch(routes: Record<string, string>): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    const match = Object.keys(routes).find((key) => url.includes(key));
    if (!match) return new Response('not found', { status: 404 });
    return new Response(routes[match], { status: 200 });
  }) as unknown as typeof fetch;
}

async function eventRows(calendarId: string) {
  return getDb()
    .select()
    .from(calendarEvents)
    .where(and(eq(calendarEvents.userId, USER_ID), eq(calendarEvents.calendarId, calendarId)));
}

beforeEach(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tasktick-ical-edit-'));
  const file = path.join(tempDir, 'ical-edit.db');
  process.env.DATABASE_URL = `file:${file}`;
  process.env.BETTER_AUTH_SECRET = 'test-secret-test-secret-test-secret-0002';

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
    name: 'Editor',
    email: 'editor@example.test',
    emailVerified: true,
    timezone: 'UTC',
  });
});

afterEach(async () => {
  await closeDb();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe('the colour model', () => {
  it('defaults a new subscription to showing in the task list', async () => {
    const body = feed(vevent('a@test', 'Standup', '20260618T090000Z', '20260618T093000Z'));
    const { calendar } = await subscribeToIcal(
      USER_ID,
      { url: 'https://1.1.1.1/cal.ics' },
      { fetchImpl: stubFor(body) },
    );
    expect(calendar.showInTasks).toBe(true);
  });

  it('stores a picked custom colour in the calendar override, not a second field', async () => {
    const body = feed(vevent('a@test', 'Standup', '20260618T090000Z', '20260618T093000Z'));
    const { calendar } = await subscribeToIcal(
      USER_ID,
      { url: 'https://1.1.1.1/cal.ics', color: 'pink', colorOverride: '#123456' },
      { fetchImpl: stubFor(body) },
    );
    expect(calendar.color).toBe('pink');
    expect(calendar.colorOverride).toBe('#123456');
  });

  it('leaves the override null when only a palette colour is chosen', async () => {
    const body = feed(vevent('a@test', 'Standup', '20260618T090000Z', '20260618T093000Z'));
    const { calendar } = await subscribeToIcal(
      USER_ID,
      { url: 'https://1.1.1.1/cal.ics', color: 'green' },
      { fetchImpl: stubFor(body) },
    );
    expect(calendar.color).toBe('green');
    expect(calendar.colorOverride).toBeNull();
  });
});

describe('updateIcalSubscription', () => {
  it('renames and recolours in place without churning the mirrored events', async () => {
    const body = feed(vevent('a@test', 'Standup', '20260618T090000Z', '20260618T093000Z'));
    const { calendar } = await subscribeToIcal(
      USER_ID,
      { url: 'https://1.1.1.1/cal.ics', name: 'Old name' },
      { fetchImpl: stubFor(body) },
    );

    const result = await updateIcalSubscription(USER_ID, calendar.id, {
      name: 'New name',
      color: 'green',
      colorOverride: '#ff00aa',
    });

    expect(result).not.toBeNull();
    expect(result!.sync).toBeNull();
    expect(result!.calendar.id).toBe(calendar.id);
    expect(result!.calendar.name).toBe('New name');
    expect(result!.calendar.color).toBe('green');
    expect(result!.calendar.colorOverride).toBe('#ff00aa');
    // Same URL, so the identity is unchanged and the events are untouched.
    expect(result!.calendar.remoteHref).toBe('https://1.1.1.1/cal.ics');
    expect(await eventRows(calendar.id)).toHaveLength(1);
  });

  it('clears a custom colour when the user goes back to a palette swatch', async () => {
    const body = feed(vevent('a@test', 'Standup', '20260618T090000Z', '20260618T093000Z'));
    const { calendar } = await subscribeToIcal(
      USER_ID,
      { url: 'https://1.1.1.1/cal.ics', color: 'blue', colorOverride: '#ff00aa' },
      { fetchImpl: stubFor(body) },
    );

    const result = await updateIcalSubscription(USER_ID, calendar.id, {
      color: 'teal',
      colorOverride: null,
    });

    expect(result!.calendar.color).toBe('teal');
    expect(result!.calendar.colorOverride).toBeNull();
  });

  it('treats a new URL as a re-subscribe and drops the old mirror', async () => {
    const oldBody = feed(vevent('old@test', 'Old event', '20260618T090000Z', '20260618T093000Z'));
    const newBody = feed(vevent('new@test', 'New event', '20260701T090000Z', '20260701T093000Z'));

    const { calendar } = await subscribeToIcal(
      USER_ID,
      { url: 'https://1.1.1.1/old.ics', name: 'Team feed', color: 'purple' },
      { fetchImpl: stubFor(oldBody) },
    );

    const fetchImpl = routeFetch({ 'new.ics': newBody });
    const result = await updateIcalSubscription(
      USER_ID,
      calendar.id,
      { url: 'https://1.1.1.1/new.ics' },
      { fetchImpl },
    );

    expect(result).not.toBeNull();
    expect(result!.sync?.created).toBe(1);
    expect(result!.calendar.remoteHref).toBe('https://1.1.1.1/new.ics');
    // The name and colour carry over unless the edit overrode them.
    expect(result!.calendar.name).toBe('Team feed');
    expect(result!.calendar.color).toBe('purple');

    // The old row is gone from the live list; only the new mirror remains.
    expect((await listIcalSubscriptions(USER_ID)).map((c) => c.id)).toEqual([result!.calendar.id]);
    const rows = await eventRows(result!.calendar.id);
    expect(rows.map((r) => r.summary)).toEqual(['New event']);
  });

  it('keeps the existing subscription when the new URL cannot be fetched', async () => {
    const body = feed(vevent('a@test', 'Standup', '20260618T090000Z', '20260618T093000Z'));
    const { calendar } = await subscribeToIcal(
      USER_ID,
      { url: 'https://1.1.1.1/old.ics' },
      { fetchImpl: stubFor(body) },
    );

    const failing = (async () => new Response('gone', { status: 500 })) as unknown as typeof fetch;
    await expect(
      updateIcalSubscription(USER_ID, calendar.id, { url: 'https://1.1.1.1/dead.ics' }, { fetchImpl: failing }),
    ).rejects.toBeInstanceOf(FeedError);

    // Validating before dropping is the whole point: a typo must not unsubscribe.
    const live = await listIcalSubscriptions(USER_ID);
    expect(live.map((c) => c.id)).toEqual([calendar.id]);
    expect(live[0].remoteHref).toBe('https://1.1.1.1/old.ics');
    expect(await eventRows(calendar.id)).toHaveLength(1);
  });

  it('carries the view preferences across a re-subscribe', async () => {
    const oldBody = feed(vevent('old@test', 'Old event', '20260618T090000Z', '20260618T093000Z'));
    const newBody = feed(vevent('new@test', 'New event', '20260701T090000Z', '20260701T093000Z'));
    const { calendar } = await subscribeToIcal(
      USER_ID,
      { url: 'https://1.1.1.1/old.ics' },
      { fetchImpl: stubFor(oldBody) },
    );
    await getDb()
      .update(calendars)
      .set({ showInTasks: false, isVisible: false })
      .where(eq(calendars.id, calendar.id));

    const result = await updateIcalSubscription(
      USER_ID,
      calendar.id,
      { url: 'https://1.1.1.1/new.ics' },
      { fetchImpl: routeFetch({ 'new.ics': newBody }) },
    );

    // A URL edit must not quietly put a calendar back into a view it was hidden from.
    expect(result!.calendar.showInTasks).toBe(false);
    expect(result!.calendar.isVisible).toBe(false);
  });

  it('refuses to edit a calendar that is not a subscription', async () => {
    await getDb().insert(calendars).values({
      id: 'local-calendar',
      userId: USER_ID,
      name: 'Local',
      color: 'blue',
      timezone: 'UTC',
      provider: 'local',
      sortOrder: 'a0',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    expect(await updateIcalSubscription(USER_ID, 'local-calendar', { name: 'Nope' })).toBeNull();
  });
});
