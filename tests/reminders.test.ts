/**
 * Reminder dispatch.
 *
 * These run against a real migrated SQLite file rather than a mocked store,
 * because the interesting part is the *claim*: whether a second sweep over the
 * same due reminder sends again. A fake store would only be asserting itself.
 *
 * The instant every test works from is a fixed midday in UTC, so a habit
 * reminder of "720 minutes past local midnight" lands exactly on it and the
 * midnight-rollover path is exercised by moving `now` instead of by luck.
 */
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { newId } from '@/server/crypto';
import { getDb } from '@/server/db';
import { reminderDispatches, taskReminders, user } from '@/server/db/schema';
import { createCalendar, createEvent, updateCalendar } from '@/server/repos/calendars';
import { createHabit } from '@/server/repos/habits';
import { getSettings, updateSettings } from '@/server/repos/settings';
import { createTask } from '@/server/repos/tasks';
import type { NotificationPayload } from '@/server/services/notifications';
import {
  REMINDER_GRACE_MS,
  isDue,
  runReminderSweep,
} from '@/server/services/reminders';
import { disposeTempDatabase, useTempDatabase } from './sync-helpers';

const ZONE = 'UTC';

/** 2026-05-12T12:00:00Z — a Tuesday, and the instant every case is measured from. */
const NOON = Date.UTC(2026, 4, 12, 12, 0, 0);
const NOON_MINUTE = 12 * 60;

let databaseFile: string;
let userId: string;

/** Records what a sweep would have delivered, in order. */
function recorder() {
  const sent: NotificationPayload[] = [];
  return {
    sent,
    deliver: async (_userId: string, payload: NotificationPayload) => {
      sent.push(payload);
    },
  };
}

/** A user with a settings row and a configured Apprise destination. */
async function seedUser(): Promise<string> {
  const db = getDb();
  const id = newId();
  await db.insert(user).values({
    id,
    name: 'Reminder Tester',
    email: `${id}@example.test`,
    emailVerified: true,
    timezone: ZONE,
  });
  // `getSettings` creates the row on demand; the destination is then configured,
  // because an account with no channel is deliberately left unclaimed.
  await getSettings(id);
  await updateSettings(id, { appriseUrl: 'https://apprise.example.test', appriseKey: 'gateway-key' });
  return id;
}

beforeEach(async () => {
  databaseFile = await useTempDatabase();
  userId = await seedUser();
});

afterEach(async () => {
  await disposeTempDatabase(databaseFile);
});

describe('the due window', () => {
  it('is due at exactly now and one millisecond earlier', () => {
    expect(isDue(NOON, NOON)).toBe(true);
    expect(isDue(NOON - 1, NOON)).toBe(true);
  });

  it('is not due in the future', () => {
    expect(isDue(NOON + 1, NOON)).toBe(false);
  });

  it('is stale at exactly one grace window old, and due one millisecond inside it', () => {
    expect(isDue(NOON - REMINDER_GRACE_MS, NOON)).toBe(false);
    expect(isDue(NOON - REMINDER_GRACE_MS + 1, NOON)).toBe(true);
  });
});

describe('all-day events', () => {
  it('bases a reminder on local midnight, so a 540-minute offset means 09:00', async () => {
    const calendar = await createCalendar(userId, { name: 'Holidays' }, ZONE);
    await createEvent(
      userId,
      { calendarId: calendar.id, summary: 'Provincial holiday', startDate: '2026-05-12', isAllDay: true, reminders: [540] },
      ZONE,
    );
    const rec = recorder();

    await runReminderSweep(Date.UTC(2026, 4, 12, 9, 0, 0), { deliver: rec.deliver });

    expect(rec.sent.map((payload) => payload.title)).toEqual(['Provincial holiday']);
  });
});

describe('habits', () => {
  it('sends once, then reports the reminder as already claimed', async () => {
    await createHabit(userId, { name: 'Stretch', frequency: 'daily', reminders: [NOON_MINUTE] }, ZONE);
    const rec = recorder();

    const first = await runReminderSweep(NOON, { deliver: rec.deliver });
    expect(rec.sent.map((payload) => payload.title)).toEqual(['Stretch']);
    expect(first.sent).toBe(1);

    const second = await runReminderSweep(NOON, { deliver: rec.deliver });
    expect(rec.sent).toHaveLength(1);
    expect(second.sent).toBe(0);
    expect(second.skipped).toBe(1);
  });

  it('does not remind on a day the schedule does not cover', async () => {
    // 2026-05-12 is a Tuesday (2); this habit only runs on Mondays.
    await createHabit(userId, { name: 'Monday only', frequency: 'custom', weekDays: [1], reminders: [NOON_MINUTE] }, ZONE);
    const rec = recorder();

    await runReminderSweep(NOON, { deliver: rec.deliver });

    expect(rec.sent).toEqual([]);
  });

  it('still sends a late-evening reminder whose tick lands after midnight', async () => {
    // 23:59 on the 12th, swept 30 seconds into the 13th: the reminder belongs to
    // yesterday's date, and a "today only" sweep would drop it every night.
    await createHabit(userId, { name: 'Wind down', frequency: 'daily', reminders: [23 * 60 + 59] }, ZONE);
    const rec = recorder();

    await runReminderSweep(Date.UTC(2026, 4, 13, 0, 0, 30), { deliver: rec.deliver });

    expect(rec.sent.map((payload) => payload.title)).toEqual(['Wind down']);
  });

  it('drops a reminder older than the grace window', async () => {
    await createHabit(userId, { name: 'Stale', frequency: 'daily', reminders: [NOON_MINUTE] }, ZONE);
    const rec = recorder();

    await runReminderSweep(NOON + REMINDER_GRACE_MS + 1, { deliver: rec.deliver });

    expect(rec.sent).toEqual([]);
  });
});

describe('events', () => {
  it('derives the fire time from the offset', async () => {
    const calendar = await createCalendar(userId, { name: 'Work' }, ZONE);
    await createEvent(
      userId,
      {
        calendarId: calendar.id,
        summary: 'Standup',
        startMs: NOON + 10 * 60_000,
        endMs: NOON + 40 * 60_000,
        reminders: [-10],
      },
      ZONE,
    );
    const rec = recorder();

    await runReminderSweep(NOON, { deliver: rec.deliver });

    expect(rec.sent.map((payload) => payload.title)).toEqual(['Standup']);
  });

  it('announces each occurrence of a recurring event, not just the first', async () => {
    const calendar = await createCalendar(userId, { name: 'Work' }, ZONE);
    await createEvent(
      userId,
      {
        calendarId: calendar.id,
        summary: 'Daily standup',
        startMs: NOON,
        endMs: NOON + 15 * 60_000,
        rrule: 'FREQ=DAILY',
        reminders: [0],
      },
      ZONE,
    );
    const rec = recorder();

    await runReminderSweep(NOON, { deliver: rec.deliver });
    await runReminderSweep(NOON + 24 * 60 * 60 * 1000, { deliver: rec.deliver });

    // The claim key is the occurrence start, so tomorrow is a fresh claim rather
    // than a duplicate of today's.
    expect(rec.sent).toHaveLength(2);
  });

  it('does not remind for an event the calendar has deduped away', async () => {
    const federal = await createCalendar(userId, { name: 'Federal' }, ZONE);
    const provincial = await createCalendar(userId, { name: 'Provincial' }, ZONE);
    await updateCalendar(userId, provincial.id, { dedupeEvents: true });

    const span = { startMs: NOON, endMs: NOON + 60 * 60_000, reminders: [0] };
    await createEvent(userId, { calendarId: federal.id, summary: 'Holiday', ...span }, ZONE);
    await createEvent(userId, { calendarId: provincial.id, summary: 'Holiday', ...span }, ZONE);
    const rec = recorder();

    await runReminderSweep(NOON, { deliver: rec.deliver });

    expect(rec.sent).toHaveLength(1);
  });

  it('reminds for both when neither calendar defers', async () => {
    // The control for the test above: the same two events, one flag apart.
    const federal = await createCalendar(userId, { name: 'Federal' }, ZONE);
    const provincial = await createCalendar(userId, { name: 'Provincial' }, ZONE);

    const span = { startMs: NOON, endMs: NOON + 60 * 60_000, reminders: [0] };
    await createEvent(userId, { calendarId: federal.id, summary: 'Holiday', ...span }, ZONE);
    await createEvent(userId, { calendarId: provincial.id, summary: 'Holiday', ...span }, ZONE);
    const rec = recorder();

    await runReminderSweep(NOON, { deliver: rec.deliver });

    expect(rec.sent).toHaveLength(2);
  });
});

describe('tasks', () => {
  it('sends the reminder and flips its sent flag', async () => {
    await createTask(
      userId,
      { title: 'Pay rent', dueDate: '2026-05-12', dueTime: '12:00', reminders: [{ offsetMinutes: 0 }] },
      ZONE,
    );
    const rec = recorder();

    const counts = await runReminderSweep(NOON, { deliver: rec.deliver });

    expect(rec.sent.map((payload) => payload.title)).toEqual(['Pay rent']);
    expect(counts.sent).toBe(1);

    const rows = await getDb().select().from(taskReminders).where(eq(taskReminders.userId, userId));
    expect(rows).toHaveLength(1);
    expect(rows[0].sent).toBe(true);
  });

  it('sends only once across two sweeps', async () => {
    await createTask(
      userId,
      { title: 'Pay rent', dueDate: '2026-05-12', dueTime: '12:00', reminders: [{ offsetMinutes: 0 }] },
      ZONE,
    );
    const rec = recorder();

    await runReminderSweep(NOON, { deliver: rec.deliver });
    const second = await runReminderSweep(NOON, { deliver: rec.deliver });

    expect(rec.sent).toHaveLength(1);
    expect(second.sent).toBe(0);
  });
});

describe('accounts with nowhere to send', () => {
  it('leaves the reminder unclaimed rather than throwing it away', async () => {
    const bare = newId();
    await getDb().insert(user).values({
      id: bare,
      name: 'No Destination',
      email: `${bare}@example.test`,
      emailVerified: true,
      timezone: ZONE,
    });
    await getSettings(bare);
    await createHabit(bare, { name: 'Bare', frequency: 'daily', reminders: [NOON_MINUTE] }, ZONE);
    const rec = recorder();

    await runReminderSweep(NOON, { deliver: rec.deliver });

    expect(rec.sent).toEqual([]);
    const claims = await getDb().select().from(reminderDispatches).where(eq(reminderDispatches.userId, bare));
    expect(claims).toEqual([]);

    // Configuring a destination while the reminder is still inside the grace
    // window delivers it, which is the whole point of not claiming it above.
    await updateSettings(bare, { appriseUrl: 'https://apprise.example.test', appriseKey: 'gateway-key' });
    await runReminderSweep(NOON, { deliver: rec.deliver });

    expect(rec.sent.map((payload) => payload.title)).toEqual(['Bare']);
  });

  it('sends nothing when notifications are muted', async () => {
    await updateSettings(userId, { notificationsEnabled: false });
    await createHabit(userId, { name: 'Muted', frequency: 'daily', reminders: [NOON_MINUTE] }, ZONE);
    const rec = recorder();

    await runReminderSweep(NOON, { deliver: rec.deliver });

    expect(rec.sent).toEqual([]);
  });
});

describe('the real transport', () => {
  it('posts to the configured gateway with the reminder title', async () => {
    const received: { url: string; body: string }[] = [];
    const server = createServer((request, response) => {
      let body = '';
      request.on('data', (chunk) => {
        body += chunk;
      });
      request.on('end', () => {
        received.push({ url: request.url ?? '', body });
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end('{"ok":true}');
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;

    try {
      await updateSettings(userId, { appriseUrl: `http://127.0.0.1:${port}`, appriseKey: 'gateway-key' });
      await createHabit(userId, { name: 'Stretch', frequency: 'daily', reminders: [NOON_MINUTE] }, ZONE);

      // No `deliver` override, so this is the real fan-out: the settings row is
      // decrypted, Apprise is POSTed to over a real socket, and Web Push finds no
      // subscription. That wiring is the part a mocked deliverer cannot check.
      await runReminderSweep(NOON);

      expect(received).toHaveLength(1);
      expect(received[0].url).toBe('/notify/gateway-key');
      expect(JSON.parse(received[0].body).title).toBe('Stretch');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
