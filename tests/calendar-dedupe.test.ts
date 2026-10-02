/**
 * Deduplicating one subscription against another, end to end through the real
 * aggregation service and a real migrated SQLite file.
 *
 * The case this exists for: a provincial holiday feed and a federal holiday feed
 * that both carry "Thanksgiving" on the same day. Turning the toggle on for the
 * provincial one should leave the day with one Thanksgiving, not two — and must
 * not take the federal one with it.
 *
 * The rule has one asymmetry that matters more than the happy path: only
 * calendars with the toggle OFF contribute the titles an event is matched
 * against. That is what stops "on for both feeds" from deleting both copies, and
 * it is the first thing these tests pin.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCalendar, createEvent, updateCalendar } from '@/server/repos/calendars';
import { getCalendarItems } from '@/server/services/calendar-items';
import { disposeTempDatabase, seedAccount, seedLocalTask, useTempDatabase } from './sync-helpers';

const ZONE = 'UTC';
const WINDOW_START = Date.parse('2024-03-01T00:00:00Z');
const WINDOW_END = Date.parse('2024-04-01T00:00:00Z');
const DAY = Date.parse('2024-03-05T10:00:00Z');

let databaseFile = '';

beforeEach(async () => {
  databaseFile = await useTempDatabase();
});

afterEach(async () => {
  await disposeTempDatabase(databaseFile);
});

/** A timed event on the 5th, one hour long, at `hour` UTC. */
function timed(calendarId: string, summary: string, hour = 10) {
  const start = Date.parse(`2024-03-05T${String(hour).padStart(2, '0')}:00:00Z`);
  return { calendarId, summary, startMs: start, endMs: start + 60 * 60 * 1000, timezone: ZONE };
}

/** The titles of the event items in the window, in render order. */
async function eventTitles(userId: string): Promise<string[]> {
  const items = await getCalendarItems({
    userId,
    zone: ZONE,
    startMs: WINDOW_START,
    endMs: WINDOW_END,
    includeTasks: true,
  });
  return items.filter((item) => item.kind === 'event').map((item) => item.title);
}

/** Federal (never defers) plus a provincial feed that defers to it. */
async function twoHolidayFeeds() {
  const account = await seedAccount();
  const federal = await createCalendar(account.userId, { name: 'Federal' }, ZONE);
  const provincial = await createCalendar(account.userId, { name: 'Provincial' }, ZONE);
  await updateCalendar(account.userId, provincial.id, { dedupeEvents: true });
  return { account, federal: federal.id, provincial: provincial.id };
}

describe('a deferring calendar drops what another calendar already has', () => {
  it('drops the provincial copy when the title falls on the same day', async () => {
    const { account, federal, provincial } = await twoHolidayFeeds();
    await createEvent(account.userId, timed(federal, 'Thanksgiving', 10), ZONE);
    await createEvent(account.userId, timed(provincial, 'Thanksgiving', 15), ZONE);

    expect(await eventTitles(account.userId)).toEqual(['Thanksgiving']);
  });

  it('keeps both when the titles differ', async () => {
    const { account, federal, provincial } = await twoHolidayFeeds();
    await createEvent(account.userId, timed(federal, 'Thanksgiving'), ZONE);
    await createEvent(account.userId, timed(provincial, 'Family Day', 15), ZONE);

    expect(await eventTitles(account.userId)).toEqual(['Thanksgiving', 'Family Day']);
  });

  it('keeps both when the days differ, even with the same title', async () => {
    const { account, federal, provincial } = await twoHolidayFeeds();
    await createEvent(account.userId, timed(federal, 'Thanksgiving', 10), ZONE);
    const other = Date.parse('2024-03-12T10:00:00Z');
    await createEvent(
      account.userId,
      { calendarId: provincial, summary: 'Thanksgiving', startMs: other, endMs: other + 3600_000, timezone: ZONE },
      ZONE,
    );

    expect(await eventTitles(account.userId)).toEqual(['Thanksgiving', 'Thanksgiving']);
  });

  it('matches an all-day event against a timed one on the same date', async () => {
    const { account, federal, provincial } = await twoHolidayFeeds();
    await createEvent(
      account.userId,
      { calendarId: federal, summary: 'Thanksgiving', isAllDay: true, startDate: '2024-03-05' },
      ZONE,
    );
    await createEvent(account.userId, timed(provincial, 'Thanksgiving', 9), ZONE);

    expect(await eventTitles(account.userId)).toEqual(['Thanksgiving']);
  });

  it('folds case and stray whitespace before comparing titles', async () => {
    const { account, federal, provincial } = await twoHolidayFeeds();
    await createEvent(account.userId, timed(federal, 'Thanksgiving'), ZONE);
    await createEvent(account.userId, timed(provincial, '  thanksgiving  '), ZONE);

    expect(await eventTitles(account.userId)).toEqual(['Thanksgiving']);
  });
});

describe('the toggle defers, it does not claim', () => {
  it('leaves both copies alone when both calendars defer', async () => {
    const account = await seedAccount();
    const federal = await createCalendar(account.userId, { name: 'Federal' }, ZONE);
    const provincial = await createCalendar(account.userId, { name: 'Provincial' }, ZONE);
    await updateCalendar(account.userId, federal.id, { dedupeEvents: true });
    await updateCalendar(account.userId, provincial.id, { dedupeEvents: true });
    await createEvent(account.userId, timed(federal.id, 'Thanksgiving'), ZONE);
    await createEvent(account.userId, timed(provincial.id, 'Thanksgiving', 15), ZONE);

    expect(await eventTitles(account.userId)).toEqual(['Thanksgiving', 'Thanksgiving']);
  });

  it('does nothing at all while the toggle is off', async () => {
    const account = await seedAccount();
    const federal = await createCalendar(account.userId, { name: 'Federal' }, ZONE);
    const provincial = await createCalendar(account.userId, { name: 'Provincial' }, ZONE);
    await createEvent(account.userId, timed(federal.id, 'Thanksgiving'), ZONE);
    await createEvent(account.userId, timed(provincial.id, 'Thanksgiving', 15), ZONE);

    expect(await eventTitles(account.userId)).toEqual(['Thanksgiving', 'Thanksgiving']);
  });

  it('is not claimed by a task that happens to share the title', async () => {
    const account = await seedAccount();
    const provincial = await createCalendar(account.userId, { name: 'Provincial' }, ZONE);
    await updateCalendar(account.userId, provincial.id, { dedupeEvents: true });
    await createEvent(account.userId, timed(provincial.id, 'Thanksgiving'), ZONE);
    await seedLocalTask(account, null, { title: 'Thanksgiving', dueAtMs: DAY });

    const items = await getCalendarItems({
      userId: account.userId,
      zone: ZONE,
      startMs: WINDOW_START,
      endMs: WINDOW_END,
      includeTasks: true,
    });

    // A holiday and a task called "Thanksgiving" are a coincidence, not a
    // duplicate: the event stays, and the task is untouched either way.
    expect(items.filter((item) => item.kind === 'event').map((item) => item.title)).toEqual(['Thanksgiving']);
    expect(items.filter((item) => item.kind === 'task').map((item) => item.title)).toEqual(['Thanksgiving']);
  });
});

describe('the flag is a calendar field', () => {
  it('round-trips through create and update, and defaults to off', async () => {
    const account = await seedAccount();
    const created = await createCalendar(account.userId, { name: 'Provincial' }, ZONE);
    expect(created.dedupeEvents).toBe(false);

    const updated = await updateCalendar(account.userId, created.id, { dedupeEvents: true });
    expect(updated?.dedupeEvents).toBe(true);

    const back = await updateCalendar(account.userId, created.id, { dedupeEvents: false });
    expect(back?.dedupeEvents).toBe(false);
  });
});
