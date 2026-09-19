/**
 * `showInTasks` — the per-calendar task-list switch.
 *
 * `isVisible` off disables a calendar everywhere; `showInTasks` refines a
 * visible calendar by keeping it off the task list.
 * The calendar screen always names the calendars it wants (it derives the ids
 * from `isVisible`), so the default read of `/api/calendar/items` is the task
 * list's read. These tests pin both halves of that contract against a real
 * migrated database: the default read honours `showInTasks`, and an explicit
 * `calendarIds` ignores it so the calendar screen is untouched.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetEnvCache } from '@/lib/env';
import { resetDialectCache } from '@/server/db/dialect';
import { closeDb, getDb } from '@/server/db';
import { calendarEvents, calendars, user } from '@/server/db/schema';
import { getCalendarItems } from '@/server/services/calendar-items';

const USER_ID = 'user-show-in-tasks';
const ZONE = 'UTC';
const START = Date.UTC(2026, 5, 18, 9, 0, 0);
const END = START + 60 * 60 * 1000;
const RANGE = { startMs: START - 60 * 60 * 1000, endMs: END + 60 * 60 * 1000 };

let tempDir = '';

async function seedCalendar(id: string, showInTasks: boolean, isVisible = true) {
  await getDb().insert(calendars).values({
    id,
    userId: USER_ID,
    name: id,
    color: 'blue',
    timezone: ZONE,
    provider: 'local',
    supportsVtodo: true,
    isVisible,
    showInTasks,
    sortOrder: `a${id}`,
  });
}

async function seedEvent(id: string, calendarId: string, summary: string) {
  await getDb().insert(calendarEvents).values({
    id,
    userId: USER_ID,
    calendarId,
    uid: id,
    summary,
    startMs: START,
    endMs: END,
    timezone: ZONE,
  });
}

async function eventTitles(options: Parameters<typeof getCalendarItems>[0]): Promise<string[]> {
  const items = await getCalendarItems(options);
  return items.filter((item) => item.kind === 'event').map((item) => item.title).sort();
}

beforeEach(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tasktick-show-in-tasks-'));
  const file = path.join(tempDir, 'show-in-tasks.db');
  process.env.DATABASE_URL = `file:${file}`;
  process.env.BETTER_AUTH_SECRET = 'test-secret-test-secret-test-secret-0003';

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
    name: 'Reader',
    email: 'reader@example.test',
    emailVerified: true,
    timezone: ZONE,
  });
});

afterEach(async () => {
  await closeDb();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe('the task list read', () => {
  it('drops events from a calendar with show-in-tasks off', async () => {
    await seedCalendar('shown', true);
    await seedCalendar('hidden', false);
    await seedEvent('e-shown', 'shown', 'Shown');
    await seedEvent('e-hidden', 'hidden', 'Hidden');

    expect(await eventTitles({ userId: USER_ID, zone: ZONE, ...RANGE })).toEqual(['Shown']);
  });

  it('defaults on: a calendar that never set the flag still appears', async () => {
    // No `showInTasks` in the insert at all — the column default is what must
    // keep an existing calendar where it always was.
    await getDb().insert(calendars).values({
      id: 'defaulted',
      userId: USER_ID,
      name: 'defaulted',
      color: 'blue',
      timezone: ZONE,
      provider: 'local',
      sortOrder: 'a0',
    });
    await seedEvent('e-default', 'defaulted', 'Defaulted');

    expect(await eventTitles({ userId: USER_ID, zone: ZONE, ...RANGE })).toEqual(['Defaulted']);
  });

  it('drops a hidden calendar from the task list as well', async () => {
    /*
     * This asserted the opposite until hiding was made to *disable* a calendar.
     *
     * The two flags were independent: `isVisible` governed the calendar screen and
     * `showInTasks` the list, so a calendar hidden from the calendar screen but
     * still wanted in the list kept contributing. That reads as a half-working
     * toggle — you press Hide and the events are still in your task list — which
     * is what prompted the change.
     *
     * Now hiding is off everywhere, and `showInTasks` refines a calendar that is
     * *on*: visible, wanted on the calendar screen, not wanted in the list.
     */
    await seedCalendar('calendar-only-off', true, false);
    await seedEvent('e-off', 'calendar-only-off', 'Only in tasks');

    expect(await eventTitles({ userId: USER_ID, zone: ZONE, ...RANGE })).toEqual([]);
  });

  it('still drops a visible calendar whose show-in-tasks is off', async () => {
    // The refinement must keep working now that hiding also excludes.
    await seedCalendar('visible-not-listed', false, true);
    await seedEvent('e-nl', 'visible-not-listed', 'Calendar only');

    expect(await eventTitles({ userId: USER_ID, zone: ZONE, ...RANGE })).toEqual([]);
  });
});

describe('the calendar screen read', () => {
  it('draws a show-in-tasks-off calendar when it is named explicitly', async () => {
    await seedCalendar('shown', true);
    await seedCalendar('hidden', false);
    await seedEvent('e-shown', 'shown', 'Shown');
    await seedEvent('e-hidden', 'hidden', 'Hidden');

    // The calendar screen passes the ids it derives from `isVisible`; an
    // explicit list is authoritative and `showInTasks` must not interfere.
    expect(await eventTitles({ userId: USER_ID, zone: ZONE, ...RANGE, calendarIds: ['hidden'] })).toEqual([
      'Hidden',
    ]);
    expect(
      await eventTitles({ userId: USER_ID, zone: ZONE, ...RANGE, calendarIds: ['shown', 'hidden'] }),
    ).toEqual(['Hidden', 'Shown']);
  });
});
