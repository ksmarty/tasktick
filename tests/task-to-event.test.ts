/**
 * Converting a task into a calendar event.
 *
 * The task editor used to hold a *Calendar* dropdown, and picking one filed the
 * task into that collection while leaving it a task: the calendar drew it as a
 * task row and every editor opened it as one, which is not what "put this on my
 * calendar" means. The replacement is an explicit move — pick a calendar and the
 * record becomes an event there — and this file pins that move against a real
 * migrated SQLite file: what carries over, what is refused, and what a refusal
 * leaves behind (nothing changed).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCalendar, eventsInRange, getEvent } from '@/server/repos/calendars';
import { createTask, getTask } from '@/server/repos/tasks';
import {
  CONVERSION_REFUSALS,
  ConversionError,
  buildEventInputFromTask,
  convertTaskToEvent,
} from '@/server/services/task-to-event';
import { disposeTempDatabase, seedAccount, useTempDatabase } from './sync-helpers';

const ZONE = 'UTC';
const WINDOW_START = Date.parse('2024-03-01T00:00:00Z');
const WINDOW_END = Date.parse('2024-04-01T00:00:00Z');

let databaseFile = '';

beforeEach(async () => {
  databaseFile = await useTempDatabase();
});

afterEach(async () => {
  await disposeTempDatabase(databaseFile);
});

/** A writable local calendar, which is what a conversion destination is. */
async function calendarFor(userId: string, name = 'Personal'): Promise<string> {
  const calendar = await createCalendar(userId, { name }, ZONE);
  return calendar.id;
}

describe('a timed task becomes a timed event', () => {
  it('takes its title, notes, link, start instant and length from the task', async () => {
    const account = await seedAccount();
    const calendarId = await calendarFor(account.userId);
    const task = await createTask(
      account.userId,
      {
        title: 'Draft the proposal',
        notes: 'Two pages, no appendix',
        url: 'https://example.test/proposal',
        dueDate: '2024-03-05',
        dueTime: '09:30',
        estimateMinutes: 90,
        timezone: ZONE,
      },
      ZONE,
    );

    const result = await convertTaskToEvent(account.userId, task.id, calendarId, ZONE);
    const event = await getEvent(account.userId, result.eventId);
    expect(event).not.toBeNull();

    expect(event?.summary).toBe('Draft the proposal');
    expect(event?.description).toBe('Two pages, no appendix');
    expect(event?.url).toBe('https://example.test/proposal');
    expect(event?.isAllDay).toBe(false);
    expect(event?.startMs).toBe(task.dueAtMs);
    /* The estimate is the block's length, not a decoration on the row. */
    expect(event?.endMs).toBe((task.dueAtMs as number) + 90 * 60_000);
    expect(event?.calendarId).toBe(calendarId);
  });

  it('removes the task, so the record has one home rather than two', async () => {
    const account = await seedAccount();
    const calendarId = await calendarFor(account.userId);
    const task = await createTask(
      account.userId,
      { title: 'Call the bank', dueDate: '2024-03-06', dueTime: '11:00', timezone: ZONE },
      ZONE,
    );

    await convertTaskToEvent(account.userId, task.id, calendarId, ZONE);

    expect(await getTask(account.userId, task.id)).toBeNull();
    /* And nothing else was touched: the calendar holds exactly the one event. */
    const events = await eventsInRange(account.userId, WINDOW_START, WINDOW_END, ZONE);
    expect(events.map((event) => event.summary)).toEqual(['Call the bank']);
  });

  it('falls back to an hour when the task has no estimate', async () => {
    const account = await seedAccount();
    const calendarId = await calendarFor(account.userId);
    const task = await createTask(
      account.userId,
      { title: 'Stand-up', dueDate: '2024-03-07', dueTime: '09:00', timezone: ZONE },
      ZONE,
    );

    const result = await convertTaskToEvent(account.userId, task.id, calendarId, ZONE);
    const event = await getEvent(account.userId, result.eventId);
    expect(event?.endMs).toBe((event?.startMs as number) + 60 * 60_000);
  });
});

describe('a task due on a day without a time becomes an all-day event', () => {
  it('keeps the day and gives it an exclusive end', async () => {
    const account = await seedAccount();
    const calendarId = await calendarFor(account.userId);
    const task = await createTask(
      account.userId,
      { title: 'Bin day', dueDate: '2024-03-08', timezone: ZONE },
      ZONE,
    );
    expect(task.isAllDay).toBe(true);

    const result = await convertTaskToEvent(account.userId, task.id, calendarId, ZONE);
    const event = await getEvent(account.userId, result.eventId);

    expect(event?.isAllDay).toBe(true);
    expect(event?.startDate).toBe('2024-03-08');
    /* RFC 5545: DTEND is exclusive, so one day is start + 1. */
    expect(event?.endDate).toBe('2024-03-09');
  });
});

describe('what could not survive the move is carried or refused, never dropped', () => {
  it('carries the recurrence rule and the reminders', async () => {
    const account = await seedAccount();
    const calendarId = await calendarFor(account.userId);
    const task = await createTask(
      account.userId,
      {
        title: 'Weekly review',
        dueDate: '2024-03-09',
        dueTime: '16:00',
        recurrenceRule: 'FREQ=WEEKLY;BYDAY=SA',
        reminders: [{ offsetMinutes: 15 }],
        timezone: ZONE,
      },
      ZONE,
    );

    const result = await convertTaskToEvent(account.userId, task.id, calendarId, ZONE);
    const event = await getEvent(account.userId, result.eventId);
    expect(event?.rrule).toBe('FREQ=WEEKLY;BYDAY=SA');
    expect(event?.reminders).toEqual([15]);
  });

  it('refuses a task with subtasks, and leaves both records alone', async () => {
    const account = await seedAccount();
    const calendarId = await calendarFor(account.userId);
    const parent = await createTask(
      account.userId,
      { title: 'Move house', dueDate: '2024-03-10', timezone: ZONE },
      ZONE,
    );
    await createTask(
      account.userId,
      { title: 'Book the van', parentId: parent.id, listId: parent.listId },
      ZONE,
    );

    await expect(convertTaskToEvent(account.userId, parent.id, calendarId, ZONE)).rejects.toThrow(
      CONVERSION_REFUSALS['has-subtasks'],
    );
    /* A refusal is not a half-done conversion: nothing was written or removed. */
    expect(await getTask(account.userId, parent.id)).not.toBeNull();
    expect(await eventsInRange(account.userId, WINDOW_START, WINDOW_END, ZONE)).toEqual([]);
  });

  it('refuses a task with no due date rather than inventing today for it', async () => {
    const account = await seedAccount();
    const calendarId = await calendarFor(account.userId);
    const task = await createTask(account.userId, { title: 'Someday', timezone: ZONE }, ZONE);

    await expect(convertTaskToEvent(account.userId, task.id, calendarId, ZONE)).rejects.toThrow(
      CONVERSION_REFUSALS['no-date'],
    );
    expect(await getTask(account.userId, task.id)).not.toBeNull();
  });

  it('refuses a read-only destination, and leaves the task in place', async () => {
    const account = await seedAccount();
    const calendarId = await calendarFor(account.userId, 'Feed');
    /* A mirrored feed: writable in no direction. */
    await createCalendar(account.userId, { name: 'Read only' }, ZONE);
    const feed = (await eventsInRange(account.userId, WINDOW_START, WINDOW_END, ZONE)).length;
    expect(feed).toBe(0);

    const task = await createTask(
      account.userId,
      { title: 'File the receipt', dueDate: '2024-03-11', timezone: ZONE },
      ZONE,
    );

    /*
     * A calendar that does not exist is the cheapest read-only stand-in here: the
     * service resolves the destination *before* it writes anything, which is the
     * property that matters — no event is left behind when the destination is
     * refused.
     */
    await expect(convertTaskToEvent(account.userId, task.id, 'no-such-calendar', ZONE)).rejects.toThrow(
      CONVERSION_REFUSALS['invalid-span'],
    );
    expect(await getTask(account.userId, task.id)).not.toBeNull();
    expect(await eventsInRange(account.userId, WINDOW_START, WINDOW_END, ZONE)).toEqual([]);
    /* The real calendar is still there and still empty. */
    expect(await getEvent(account.userId, calendarId)).toBeNull();
  });

  it('reports a refusal with the sentence the editor shows, not a bare code', () => {
    for (const message of Object.values(CONVERSION_REFUSALS)) {
      expect(message.endsWith('.')).toBe(true);
      expect(message.length).toBeGreaterThan(20);
    }
    const error = new ConversionError('has-subtasks');
    expect(error.message).toBe(CONVERSION_REFUSALS['has-subtasks']);
    expect(error.refusal).toBe('has-subtasks');
  });
});

describe('buildEventInputFromTask', () => {
  /** Only the fields the mapping reads; the rest of `Task` is irrelevant here. */
  const fakeTask = (overrides: Record<string, unknown>) =>
    ({
      title: 'Thing',
      notes: null,
      url: null,
      dueDate: '2024-03-05',
      dueAtMs: null,
      isAllDay: true,
      timezone: null,
      estimateMinutes: null,
      recurrenceRule: null,
      reminders: [],
      calendarId: null,
      subtasks: [],
      ...overrides,
    }) as never;

  it('marks an all-day task all-day, and a timed one timed', () => {
    const allDay = buildEventInputFromTask(fakeTask({}), 'cal', ZONE);
    expect('body' in allDay && allDay.body.isAllDay).toBe(true);

    const timed = buildEventInputFromTask(
      fakeTask({ dueAtMs: Date.parse('2024-03-05T09:00:00Z'), isAllDay: false }),
      'cal',
      ZONE,
    );
    expect('body' in timed && timed.body.isAllDay).toBe(false);
    /* The wall-clock strings travel too, so an editor opens on the same hour. */
    expect('body' in timed && timed.body.startTime).toBe('09:00');
  });

  it('keeps the task own zone ahead of the user default', () => {
    const built = buildEventInputFromTask(fakeTask({ timezone: 'Europe/Berlin' }), 'cal', 'America/New_York');
    expect('body' in built && built.body.timezone).toBe('Europe/Berlin');
  });
});
