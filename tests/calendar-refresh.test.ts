/**
 * The refresh-all sweep behind the tasks header button.
 *
 * Three things have to hold, and each of them is a way the button could look
 * like it worked while doing nothing useful:
 *
 *  1. **It actually refreshes the remote sources** and reports counters, not a
 *     bare "done" — the reason to press it is a change made on another device.
 *  2. **It skips what the scheduler skips.** A paused account and a hidden feed
 *     are not contacted at all, because hiding a feed is how a user turns it off
 *     and a manual sweep must not quietly override that.
 *  3. **One dead source does not take the sweep down with it.** Both engines
 *     return an error *on the result* instead of throwing, and the failing
 *     source is named, so the other sources still refresh.
 *
 * Plus the pure reporting rules, which are what the user actually reads.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetEnvCache } from '@/lib/env';
import { resetDialectCache } from '@/server/db/dialect';
import { closeDb, getDb } from '@/server/db';
import { caldavAccounts, calendars, user } from '@/server/db/schema';
import { resetSyncLocks } from '@/server/sync';
import { refreshAllCalendars } from '@/server/services/calendar-refresh';
import { subscribeToIcal } from '@/server/services/ical-subscription';
import { isQueueable } from '@/lib/offline-rules';
import {
  calendarRefreshCounters,
  calendarRefreshReport,
  calendarRefreshSourceCount,
  calendarRefreshSummary,
} from '@/components/calendar/refresh';
import type { CalendarRefreshResult } from '@/lib/view-types';

const USER_ID = 'user-refresh-test';
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
  return (async () =>
    new Response(body, { status: 200 })) as unknown as typeof fetch;
}

/** A `CalendarRefreshResult` with nothing in it, for the reporting tests. */
function emptyResult(): CalendarRefreshResult {
  return { accounts: [], subscriptions: [] };
}

beforeEach(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tasktick-refresh-'));
  const file = path.join(tempDir, 'refresh.db');
  process.env.DATABASE_URL = `file:${file}`;
  process.env.BETTER_AUTH_SECRET = 'test-secret-test-secret-test-secret-0001';

  resetEnvCache();
  resetDialectCache();
  resetSyncLocks();
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
    name: 'Refresher',
    email: 'refresher@example.test',
    emailVerified: true,
    timezone: 'UTC',
  });
});

afterEach(async () => {
  await closeDb();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe('refreshAllCalendars', () => {
  it('refreshes a feed and reports what it brought in', async () => {
    const { calendar } = await subscribeToIcal(
      USER_ID,
      { url: 'https://1.1.1.1/cal.ics', name: 'Team' },
      { fetchImpl: stubFor(feed(vevent('a@test', 'Standup', '20260618T090000Z', '20260618T093000Z'))) },
    );

    const result = await refreshAllCalendars(USER_ID, {
      fetchImpl: stubFor(
        feed(
          vevent('a@test', 'Standup', '20260618T090000Z', '20260618T093000Z'),
          vevent('b@test', 'Review', '20260619T140000Z', '20260619T150000Z'),
        ),
      ),
    });

    expect(result.accounts).toEqual([]);
    expect(result.subscriptions).toHaveLength(1);
    // The name is carried so a partial failure can name the source.
    expect(result.subscriptions[0]).toMatchObject({ id: calendar.id, name: 'Team', created: 1 });
    expect(result.subscriptions[0].error).toBeNull();
  });

  it('does not touch a hidden feed, the way the scheduler does', async () => {
    await subscribeToIcal(
      USER_ID,
      { url: 'https://1.1.1.1/cal.ics', name: 'Team' },
      { fetchImpl: stubFor(feed(vevent('a@test', 'Standup', '20260618T090000Z', '20260618T093000Z'))) },
    );
    await getDb().update(calendars).set({ isVisible: false }).where(eq(calendars.userId, USER_ID));

    const spy = vi.fn(stubFor(feed()));
    const result = await refreshAllCalendars(USER_ID, { fetchImpl: spy as unknown as typeof fetch });

    expect(spy).not.toHaveBeenCalled();
    expect(result.subscriptions).toEqual([]);
  });

  it('does not contact a paused account', async () => {
    await getDb().insert(caldavAccounts).values({
      id: 'acct-paused',
      userId: USER_ID,
      name: 'Paused server',
      serverUrl: 'http://127.0.0.1:9/',
      username: 'someone',
      passwordEncrypted: 'not-a-real-ciphertext',
      enabled: false,
    });

    const result = await refreshAllCalendars(USER_ID);

    expect(result.accounts).toEqual([]);
    // Nothing was written either: a paused account keeps its last status.
    const [row] = await getDb().select().from(caldavAccounts).where(eq(caldavAccounts.id, 'acct-paused'));
    expect(row.lastSyncStatus).toBe('idle');
  });

  it('reports a broken source without taking the other sources down', async () => {
    // An enabled account whose stored credential cannot be decrypted: the engine
    // fails the run instead of throwing out of it.
    await getDb().insert(caldavAccounts).values({
      id: 'acct-broken',
      userId: USER_ID,
      name: 'Broken server',
      serverUrl: 'http://127.0.0.1:9/',
      username: 'someone',
      passwordEncrypted: 'not-a-real-ciphertext',
      enabled: true,
    });

    await subscribeToIcal(
      USER_ID,
      { url: 'https://1.1.1.1/cal.ics', name: 'Team' },
      { fetchImpl: stubFor(feed()) },
    );

    const result = await refreshAllCalendars(USER_ID, {
      fetchImpl: stubFor(feed(vevent('c@test', 'Retro', '20260620T090000Z', '20260620T093000Z'))),
    });

    expect(result.accounts).toHaveLength(1);
    expect(result.accounts[0]).toMatchObject({ id: 'acct-broken', name: 'Broken server', status: 'error' });
    expect(result.accounts[0].error).toBeTruthy();
    // The feed still refreshed, and it is the failure that gets named.
    expect(result.subscriptions[0].created).toBe(1);
    expect(result.subscriptions[0].error).toBeNull();
  });
});

describe('the reporting rules', () => {
  it('says nothing remote is connected rather than reporting a successful no-op', () => {
    const report = calendarRefreshReport(emptyResult());
    expect(report.variant).toBe('info');
    expect(report.title).toBe('No remote calendars');
  });

  it('counts what moved and leaves the zeroes out', () => {
    const result: CalendarRefreshResult = {
      accounts: [
        {
          id: 'a',
          name: 'Server',
          status: 'success',
          pulled: 5,
          pushed: 0,
          deletedLocal: 0,
          deletedRemote: 0,
          conflicts: 0,
          error: null,
        },
      ],
      subscriptions: [
        { id: 'b', name: 'Team', created: 2, updated: 1, deleted: 0, error: null },
      ],
    };

    expect(calendarRefreshSourceCount(result)).toBe(2);
    expect(calendarRefreshCounters(result)).toEqual(['8 pulled']);
    expect(calendarRefreshSummary(result)).toBe('2 sources · 8 pulled');
    expect(calendarRefreshReport(result)).toMatchObject({ variant: 'success', title: 'Calendars refreshed' });
  });

  it('says everything was already up to date when nothing moved', () => {
    const result: CalendarRefreshResult = {
      accounts: [
        {
          id: 'a',
          name: 'Server',
          status: 'success',
          pulled: 0,
          pushed: 0,
          deletedLocal: 0,
          deletedRemote: 0,
          conflicts: 0,
          error: null,
        },
      ],
      subscriptions: [],
    };

    expect(calendarRefreshReport(result).description).toBe('Everything was already up to date.');
  });

  it('names the source that failed, and counts how many did', () => {
    const result: CalendarRefreshResult = {
      accounts: [
        {
          id: 'a',
          name: 'Broken server',
          status: 'error',
          pulled: 0,
          pushed: 0,
          deletedLocal: 0,
          deletedRemote: 0,
          conflicts: 0,
          error: 'The server refused the connection.',
        },
      ],
      subscriptions: [{ id: 'b', name: 'Team', created: 1, updated: 0, deleted: 0, error: null }],
    };

    const report = calendarRefreshReport(result);
    expect(report.variant).toBe('error');
    expect(report.title).toBe('1 of 2 sources failed');
    expect(report.description).toBe('Broken server: The server refused the connection.');
  });

  it('calls a sweep where every source failed a failure', () => {
    const result: CalendarRefreshResult = {
      accounts: [],
      subscriptions: [{ id: 'b', name: 'Team', created: 0, updated: 0, deleted: 0, error: 'Gone.' }],
    };

    expect(calendarRefreshReport(result).title).toBe('Calendar refresh failed');
  });
});

describe('the refresh route and its button', () => {
  function source(relative: string): string {
    return fs.readFileSync(new URL(`../src/${relative}`, import.meta.url), 'utf8');
  }

  it('is never replayed from the offline queue', () => {
    // A replayed sweep answers a question nobody is still asking, and the
    // scheduler will have swept those sources anyway.
    expect(isQueueable('POST', '/api/calendars/sync')).toBe(false);
    // The rule is the path, not the whole calendar family: creating a calendar
    // offline still has to work.
    expect(isQueueable('POST', '/api/calendars')).toBe(true);
  });

  it('keeps the route thin and the sweep in a service', () => {
    const route = source('app/api/calendars/sync/route.ts');
    expect(route).toContain('export const POST = route(');
    expect(route).toContain('refreshAllCalendars(user.id)');
  });

  it('wires the header button to the route, the invalidation table and a toast', () => {
    const view = source('components/tasks/TasksView.tsx');
    expect(view).toContain("api.post<CalendarRefreshResult>('/api/calendars/sync')");
    expect(view).toContain("invalidates: affectsFor('POST', '/api/calendars/sync')");
    expect(view).toContain('aria-label="Refresh calendars"');
    expect(view).toContain('icon={ReloadIcon}');
    expect(view).toContain('calendarRefreshReport(result)');
  });
});
