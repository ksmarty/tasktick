/**
 * All-day spans as stored, read back and deleted.
 *
 * These run against a real migrated SQLite file, so they pin what the repository
 * actually writes — a unit test of the date helper cannot catch `startDate` and
 * `endDate` being stored as the same day, which is what made a November 1 event
 * display as ending October 31.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { newId } from '@/server/crypto';
import { calendarEvents, calendars } from '@/server/db/schema';
import { createEvent, deleteEvent, getEvent } from '@/server/repos/calendars';
import { openSyncDb } from '@/server/sync/engine';
import { disposeTempDatabase, seedCalendar, seedAccount, useTempDatabase } from './sync-helpers';

const ZONE = 'UTC';

let databaseFile = '';

beforeEach(async () => {
  databaseFile = await useTempDatabase();
});

afterEach(async () => {
  await disposeTempDatabase(databaseFile);
});

async function localCalendar(): Promise<{ userId: string; calendarId: string }> {
  const account = await seedAccount({ direction: 'both' });
  const calendarId = await seedCalendar(account, { name: 'Personal' });
  return { userId: account.userId, calendarId };
}

/** A row written straight to the table, the way an older version stored one. */
async function insertRawEvent(
  userId: string,
  calendarId: string,
  fields: { startDate: string; endDate: string | null; deletedAtMs?: number },
): Promise<string> {
  const db = await openSyncDb();
  const id = newId();
  await db.insert(calendarEvents).values({
    id,
    userId,
    calendarId,
    uid: newId().replace(/-/g, ''),
    summary: 'Imported',
    startDate: fields.startDate,
    endDate: fields.endDate,
    isAllDay: true,
    timezone: ZONE,
    status: 'confirmed',
    transparency: 'transparent',
    syncProvider: 'local',
    syncState: 'synced',
    deletedAtMs: fields.deletedAtMs ?? null,
  });
  return id;
}

describe('a one-day event is stored as one day', () => {
  it('ends the day after it starts when no end is given', async () => {
    const { userId, calendarId } = await localCalendar();
    const event = await createEvent(
      userId,
      { calendarId, summary: 'Trip', startDate: '2026-11-01', isAllDay: true },
      ZONE,
    );

    expect(event.startDate).toBe('2026-11-01');
    expect(event.endDate).toBe('2026-11-02');
  });

  it('ends the day after it starts when the same day is sent twice', async () => {
    // This is exactly what the Home Assistant service and the assist intent send.
    const { userId, calendarId } = await localCalendar();
    const event = await createEvent(
      userId,
      {
        calendarId,
        summary: 'Trip',
        startDate: '2026-11-01',
        endDate: '2026-11-01',
        isAllDay: true,
      },
      ZONE,
    );

    expect(event.endDate).toBe('2026-11-02');
  });

  it('keeps a multi-day span as it was given', async () => {
    const { userId, calendarId } = await localCalendar();
    const event = await createEvent(
      userId,
      {
        calendarId,
        summary: 'Conference',
        startDate: '2026-11-01',
        endDate: '2026-11-04',
        isAllDay: true,
      },
      ZONE,
    );

    expect(event.startDate).toBe('2026-11-01');
    expect(event.endDate).toBe('2026-11-04');
  });

  it('reads back the day after for a row stored as a zero-length span', async () => {
    // Older rows are repaired on read rather than migrated, so an event created
    // before this fix stops reading as "ends yesterday" immediately.
    const { userId, calendarId } = await localCalendar();
    const id = await insertRawEvent(userId, calendarId, {
      startDate: '2026-11-01',
      endDate: '2026-11-01',
    });

    const event = await getEvent(userId, id);
    expect(event?.endDate).toBe('2026-11-02');
  });

  it('fills in an end that was never written', async () => {
    const { userId, calendarId } = await localCalendar();
    const id = await insertRawEvent(userId, calendarId, {
      startDate: '2026-11-01',
      endDate: null,
    });

    const event = await getEvent(userId, id);
    expect(event?.endDate).toBe('2026-11-02');
  });
});

describe('a timed event has a length', () => {
  it('gives a zero-length event one minute', async () => {
    const { userId, calendarId } = await localCalendar();
    const startMs = Date.parse('2026-11-01T09:00:00Z');
    const event = await createEvent(
      userId,
      { calendarId, summary: 'Standup', startMs, endMs: startMs },
      ZONE,
    );

    expect(event.endMs! - event.startMs!).toBe(60 * 1000);
  });

  it('keeps a real duration', async () => {
    const { userId, calendarId } = await localCalendar();
    const startMs = Date.parse('2026-11-01T09:00:00Z');
    const endMs = startMs + 90 * 60 * 1000;
    const event = await createEvent(userId, { calendarId, summary: 'Review', startMs, endMs }, ZONE);

    expect(event.endMs).toBe(endMs);
  });
});

describe('deleting an event that is already gone', () => {
  it('counts a tombstoned row as deleted', async () => {
    // A tap on a stale list entry used to answer "does not exist", which read as
    // a failure for a delete that had in fact happened.
    const { userId, calendarId } = await localCalendar();
    const id = await insertRawEvent(userId, calendarId, {
      startDate: '2026-11-01',
      endDate: '2026-11-02',
      deletedAtMs: Date.now(),
    });

    await expect(deleteEvent(userId, id)).resolves.toBe(true);
  });

  it('still reports an unknown id as not found', async () => {
    const { userId } = await localCalendar();

    await expect(deleteEvent(userId, 'never-existed')).resolves.toBe(false);
  });

  it('deletes a live row and hides it afterwards', async () => {
    const { userId, calendarId } = await localCalendar();
    const event = await createEvent(
      userId,
      { calendarId, summary: 'Trip', startDate: '2026-11-01', isAllDay: true },
      ZONE,
    );

    await expect(deleteEvent(userId, event.id)).resolves.toBe(true);
    await expect(getEvent(userId, event.id)).resolves.toBeNull();
  });
});
