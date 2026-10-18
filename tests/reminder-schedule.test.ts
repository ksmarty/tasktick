/**
 * The reminder schedule somebody else delivers.
 *
 * This is the read the Home Assistant integration polls: the same schedule the
 * sweep is built on, read forwards. The cases that matter are the ones a mirror
 * would get wrong on its own — a habit that is not due today, an event whose
 * reminder is about a day other than the one it fires on, and the all-day events
 * that are deliberately left out.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { newId } from '@/server/crypto';
import { getDb } from '@/server/db';
import { user } from '@/server/db/schema';
import { dateOnlyToMillis } from '@/lib/dates';
import { createCalendar, createEvent } from '@/server/repos/calendars';
import { createHabit } from '@/server/repos/habits';
import { createTask } from '@/server/repos/tasks';
import { getSettings } from '@/server/repos/settings';
import { upcomingReminders } from '@/server/services/reminder-schedule';
import { disposeTempDatabase, useTempDatabase } from './sync-helpers';

const ZONE = 'UTC';

/** 2026-05-12T12:00:00Z — a Tuesday, and the instant every case is measured from. */
const NOON = Date.UTC(2026, 4, 12, 12, 0, 0);

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

let databaseFile: string;
let userId: string;

beforeEach(async () => {
  databaseFile = await useTempDatabase();
  const db = getDb();
  userId = newId();
  await db.insert(user).values({
    id: userId,
    name: 'Schedule Tester',
    email: `${userId}@example.test`,
    emailVerified: true,
    timezone: ZONE,
  });
  await getSettings(userId);
});

afterEach(async () => {
  await disposeTempDatabase(databaseFile);
});

describe('tasks', () => {
  it('describes a reminder that has not fired yet', async () => {
    const task = await createTask(
      userId,
      { title: 'Call the plumber', dueAtMs: Date.UTC(2026, 4, 12, 18, 0, 0), reminders: [{ offsetMinutes: -30 }] },
      ZONE,
    );

    const [entry] = await upcomingReminders(userId, ZONE, NOON);
    expect(entry).toMatchObject({
      key: `task:${task.id}:off:-30`,
      source: 'task',
      sourceId: task.id,
      title: 'Call the plumber',
      body: 'Task due',
      date: '2026-05-12',
      fireAtMs: Date.UTC(2026, 4, 12, 17, 30, 0),
      repeat: 'once',
      minuteOfDay: null,
      weekDays: null,
    });
  });

  it('keys an absolute reminder by its instant', async () => {
    const task = await createTask(userId, { title: 'Stand up', reminders: [{ absoluteAtMs: NOON + HOUR }] }, ZONE);

    const [entry] = await upcomingReminders(userId, ZONE, NOON);
    expect(entry.key).toBe(`task:${task.id}:abs:${NOON + HOUR}`);
    expect(entry.repeat).toBe('once');
  });

  it('drops one whose moment has already passed, and one with no reminder at all', async () => {
    await createTask(
      userId,
      // 06:00 today: still inside the sweep's grace window, but not still to come.
      { title: 'Missed', dueAtMs: Date.UTC(2026, 4, 12, 7, 0, 0), reminders: [{ offsetMinutes: -60 }] },
      ZONE,
    );
    await createTask(userId, { title: 'No reminder', dueAtMs: NOON + HOUR }, ZONE);

    await expect(upcomingReminders(userId, ZONE, NOON)).resolves.toEqual([]);
  });
});

describe('habits', () => {
  it('names the next scheduled day, not the day it is read', async () => {
    const habit = await createHabit(userId, { name: 'Stretch', frequency: 'daily', reminders: [460] }, ZONE);

    const [entry] = await upcomingReminders(userId, ZONE, NOON);
    expect(entry).toMatchObject({
      key: `habit:${habit.id}:460`,
      source: 'habit',
      sourceId: habit.id,
      title: 'Stretch',
      body: 'Habit reminder',
      // 07:40 has already gone by today, so the next one is tomorrow.
      date: '2026-05-13',
      fireAtMs: dateOnlyToMillis('2026-05-13', ZONE) + 460 * MINUTE,
      repeat: 'daily',
      minuteOfDay: 460,
      weekDays: null,
    });
  });

  it('carries the weekdays a custom habit runs on, so the mirror skips the rest', async () => {
    // Tuesday 2026-05-12; the next Monday-or-Wednesday at 07:40 is Wednesday.
    const habit = await createHabit(
      userId,
      { name: 'Gym', frequency: 'custom', weekDays: [1, 3], reminders: [460] },
      ZONE,
    );

    const [entry] = await upcomingReminders(userId, ZONE, NOON);
    expect(entry.key).toBe(`habit:${habit.id}:460`);
    expect(entry.date).toBe('2026-05-13');
    expect(entry.weekDays).toEqual([1, 3]);
  });

  it('says nothing about a habit with the reminders switched off', async () => {
    await createHabit(userId, { name: 'Quiet', frequency: 'daily', reminders: null }, ZONE);

    await expect(upcomingReminders(userId, ZONE, NOON)).resolves.toEqual([]);
  });
});

describe('events', () => {
  it('describes an event reminder and dates it to the event’s own day', async () => {
    const calendar = await createCalendar(userId, { name: 'Work' }, ZONE);
    const event = await createEvent(
      userId,
      {
        calendarId: calendar.id,
        summary: 'Standup',
        startMs: Date.UTC(2026, 4, 13, 15, 0, 0),
        endMs: Date.UTC(2026, 4, 13, 15, 30, 0),
        reminders: [-60],
      },
      ZONE,
    );

    const [entry] = await upcomingReminders(userId, ZONE, NOON);
    expect(entry).toMatchObject({
      key: `event:${event.id}:-60`,
      source: 'event',
      sourceId: event.id,
      title: 'Standup',
      body: 'Calendar event',
      date: '2026-05-13',
      fireAtMs: Date.UTC(2026, 4, 13, 14, 0, 0),
      repeat: 'once',
      minuteOfDay: null,
      weekDays: null,
    });
  });

  it('leaves an all-day event out entirely', async () => {
    const calendar = await createCalendar(userId, { name: 'Holidays' }, ZONE);
    await createEvent(
      userId,
      { calendarId: calendar.id, summary: 'Provincial holiday', startDate: '2026-05-13', isAllDay: true, reminders: [540] },
      ZONE,
    );

    // No start instant means no hour anybody chose to be reminded at, so the
    // reminder is dropped rather than invented (the mirrored-sources decision).
    await expect(upcomingReminders(userId, ZONE, NOON)).resolves.toEqual([]);
  });
});

describe('the window', () => {
  it('reaches three weeks ahead by default and further when asked', async () => {
    await createTask(
      userId,
      { title: 'Renew the passport', dueAtMs: NOON + 30 * 24 * HOUR, reminders: [{ offsetMinutes: 0 }] },
      ZONE,
    );

    await expect(upcomingReminders(userId, ZONE, NOON)).resolves.toEqual([]);
    const [entry] = await upcomingReminders(userId, ZONE, NOON, 40);
    expect(entry.title).toBe('Renew the passport');
  });

  it('puts the next reminder first', async () => {
    await createTask(
      userId,
      { title: 'Later task', dueAtMs: Date.UTC(2026, 4, 13, 9, 0, 0), reminders: [{ offsetMinutes: 0 }] },
      ZONE,
    );
    const calendar = await createCalendar(userId, { name: 'Work' }, ZONE);
    await createEvent(
      userId,
      {
        calendarId: calendar.id,
        summary: 'Sooner event',
        startMs: Date.UTC(2026, 4, 12, 14, 0, 0),
        endMs: Date.UTC(2026, 4, 12, 14, 30, 0),
        reminders: [0],
      },
      ZONE,
    );

    const entries = await upcomingReminders(userId, ZONE, NOON);
    expect(entries.map((entry) => entry.title)).toEqual(['Sooner event', 'Later task']);
  });
});
