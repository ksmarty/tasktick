/**
 * A calendar's default reminders, end to end through the real repo against a
 * real migrated SQLite file.
 *
 * The point of the feature is that a new event in a calendar starts with the
 * offsets the user set on that calendar, and that a CalDAV collection carries
 * one too (it is a local view preference, never written back). The three
 * interesting cases are therefore: absent falls through to the default, an
 * explicit `null`/empty list is a choice and is kept, and an explicit list wins
 * outright.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCalendar, createEvent, getCalendar, updateCalendar } from '@/server/repos/calendars';
import { disposeTempDatabase, seedAccount, useTempDatabase } from './sync-helpers';

const ZONE = 'UTC';
const START = Date.parse('2024-03-05T10:00:00Z');
const END = START + 60 * 60 * 1000;

let databaseFile = '';

beforeEach(async () => {
  databaseFile = await useTempDatabase();
});

afterEach(async () => {
  await disposeTempDatabase(databaseFile);
});

/** An event in `calendarId`, with `reminders` present only when given. */
function body(calendarId: string, reminders?: number[] | null) {
  return {
    calendarId,
    summary: 'Standup',
    startMs: START,
    endMs: END,
    isAllDay: false,
    timezone: ZONE,
    ...(reminders === undefined ? {} : { reminders }),
  };
}

describe("a calendar's default reminders reach a new event", () => {
  it('applies the calendar default when the event names none', async () => {
    const account = await seedAccount();
    const calendar = await createCalendar(account.userId, { name: 'Work', defaultReminders: [10, 60] }, ZONE);

    const created = await createEvent(account.userId, body(calendar.id), ZONE);

    expect(created.reminders).toEqual([10, 60]);
  });

  it('keeps an explicit list, default or not', async () => {
    const account = await seedAccount();
    const calendar = await createCalendar(account.userId, { name: 'Work', defaultReminders: [10, 60] }, ZONE);

    const created = await createEvent(account.userId, body(calendar.id, [5]), ZONE);

    expect(created.reminders).toEqual([5]);
  });

  it('treats an explicit empty list as "no reminders", not as "use the default"', async () => {
    const account = await seedAccount();
    const calendar = await createCalendar(account.userId, { name: 'Work', defaultReminders: [10, 60] }, ZONE);

    const created = await createEvent(account.userId, body(calendar.id, []), ZONE);

    expect(created.reminders).toEqual([]);
  });

  it('leaves reminders null when the calendar has no default', async () => {
    const account = await seedAccount();
    const calendar = await createCalendar(account.userId, { name: 'Work' }, ZONE);

    const created = await createEvent(account.userId, body(calendar.id), ZONE);

    expect(created.reminders).toBeNull();
  });
});

describe('the default is a calendar field', () => {
  it('round-trips through create, read and update', async () => {
    const account = await seedAccount();
    const created = await createCalendar(account.userId, { name: 'Work', defaultReminders: [15] }, ZONE);

    expect(created.defaultReminders).toEqual([15]);
    expect((await getCalendar(account.userId, created.id))?.defaultReminders).toEqual([15]);

    const updated = await updateCalendar(account.userId, created.id, { defaultReminders: [30, 1440] });
    expect(updated?.defaultReminders).toEqual([30, 1440]);
  });

  it('clears to null rather than leaving the old list', async () => {
    const account = await seedAccount();
    const created = await createCalendar(account.userId, { name: 'Work', defaultReminders: [15] }, ZONE);

    const updated = await updateCalendar(account.userId, created.id, { defaultReminders: null });

    expect(updated?.defaultReminders).toBeNull();
  });

  it('is null when the calendar was created without one', async () => {
    const account = await seedAccount();
    const created = await createCalendar(account.userId, { name: 'Work' }, ZONE);

    expect(created.defaultReminders).toBeNull();
  });
});
