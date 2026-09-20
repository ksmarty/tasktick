/**
 * `CalendarItem.readonly` — the flag the Edit action is hidden on.
 *
 * The overlap geometry is unit-tested; this is the *policy* one. The previous
 * fix projected the calendar record's own `readOnly` and stopped there, which
 * covered an iCal subscription and a collection that refuses writes, but not a
 * CalDAV **account** whose direction is "Read only" (`'pull'`): the account's
 * calendars are discovered as writable and `readOnly` stays false, yet the sync
 * engine's `doPush = direction !== 'pull'` means nothing in them is ever sent
 * back. An event there therefore looked editable and its Save landed locally
 * and silently never left the device.
 *
 * Every case is exercised through the real aggregation service against a real
 * migrated SQLite file, so the assertion is about what the API actually
 * projects rather than about the shape of a source file.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { newId } from '@/server/crypto';
import { calendars, calendarEvents } from '@/server/db/schema';
import { createEvent, updateEvent } from '@/server/repos/calendars';
import { getCalendarItems } from '@/server/services/calendar-items';
import { openSyncDb } from '@/server/sync/engine';
import { disposeTempDatabase, seedAccount, seedCalendar, seedLocalEvent, useTempDatabase } from './sync-helpers';

const ZONE = 'UTC';
const START = Date.parse('2024-03-05T10:00:00Z');
const END = START + 60 * 60 * 1000;
/** A window that comfortably contains the seeded event. */
const RANGE = { startMs: START - 86_400_000, endMs: END + 86_400_000 };

let databaseFile = '';

beforeEach(async () => {
  databaseFile = await useTempDatabase();
});

afterEach(async () => {
  await disposeTempDatabase(databaseFile);
});

/** A calendar row the sync seed helpers do not cover (local, or an iCal feed). */
async function seedCalendarRow(
  userId: string,
  fields: { provider: 'local' | 'ical'; readOnly: boolean; name: string },
): Promise<string> {
  const db = await openSyncDb();
  const id = newId();
  await db.insert(calendars).values({
    id,
    userId,
    name: fields.name,
    provider: fields.provider,
    readOnly: fields.readOnly,
    timezone: ZONE,
  });
  return id;
}

/** One typed event in `calendarId`, inside `RANGE`. */
async function seedEvent(userId: string, calendarId: string, summary: string): Promise<void> {
  const db = await openSyncDb();
  await db.insert(calendarEvents).values({
    id: newId(),
    userId,
    calendarId,
    uid: newId().replace(/-/g, ''),
    summary,
    startMs: START,
    endMs: END,
    isAllDay: false,
    timezone: ZONE,
    status: 'confirmed',
    transparency: 'opaque',
    syncProvider: 'local',
    syncState: 'synced',
  });
}

/** The projected item for the single event in the window. */
async function onlyItem(userId: string) {
  const items = await getCalendarItems({ userId, zone: ZONE, ...RANGE, includeTasks: false });
  expect(items).toHaveLength(1);
  return items[0];
}

describe('an event is read-only exactly when nothing will write it back', () => {
  it('marks an event in a pull-only CalDAV account read-only', async () => {
    const account = await seedAccount({ direction: 'pull' });
    const calendarId = await seedCalendar(account, { name: 'Read only CalDAV' });
    await seedEvent(account.userId, calendarId, 'Mirrored by a read-only account');

    // The collection itself claims to accept writes; the account's direction is
    // the reason nothing will ever be pushed.
    expect((await onlyItem(account.userId)).readonly).toBe(true);
  });

  it('leaves an event in a two-way CalDAV account editable', async () => {
    const account = await seedAccount({ direction: 'auto' });
    const calendarId = await seedCalendar(account, { name: 'Two-way CalDAV' });
    await seedEvent(account.userId, calendarId, 'Bidirectional');

    expect((await onlyItem(account.userId)).readonly).toBe(false);
  });

  it('keeps an event in a local calendar editable', async () => {
    const account = await seedAccount();
    const calendarId = await seedCalendarRow(account.userId, { provider: 'local', readOnly: false, name: 'Local' });
    await seedEvent(account.userId, calendarId, 'Local event');

    expect((await onlyItem(account.userId)).readonly).toBe(false);
  });

  it('still marks a read-only iCal subscription read-only', async () => {
    const account = await seedAccount();
    const calendarId = await seedCalendarRow(account.userId, { provider: 'ical', readOnly: true, name: 'Feed' });
    // The feed importer stores its rows with the same column shape.
    await seedLocalEvent(account, calendarId, { summary: 'Holiday', startMs: START, endMs: END });

    expect((await onlyItem(account.userId)).readonly).toBe(true);
  });

  it('still marks a read-only CalDAV collection read-only', async () => {
    const account = await seedAccount({ direction: 'auto' });
    const calendarId = await seedCalendar(account, { name: 'Shared', readOnly: true });
    await seedEvent(account.userId, calendarId, 'Shared read-only collection');

    expect((await onlyItem(account.userId)).readonly).toBe(true);
  });
});

/**
 * The write path is the second half of the same policy: the preview hides Edit,
 * so a write should never be attempted. It is refused anyway, so the one path
 * that bypasses the preview — a new event seeded on a read-only calendar, or a
 * direct API call — fails with a message instead of landing locally and
 * silently never syncing.
 */
describe('a calendar that will not sync refuses a write', () => {
  const body = (calendarId: string) => ({
    calendarId,
    summary: 'Should not land',
    startMs: START,
    endMs: END,
    isAllDay: false,
    timezone: ZONE,
  });

  it('refuses to create an event in a read-only collection', async () => {
    const account = await seedAccount();
    const calendarId = await seedCalendarRow(account.userId, { provider: 'ical', readOnly: true, name: 'Feed' });
    await expect(createEvent(account.userId, body(calendarId), ZONE)).rejects.toThrow('read-only');
  });

  it('refuses to create an event in a pull-only CalDAV account', async () => {
    const account = await seedAccount({ direction: 'pull' });
    const calendarId = await seedCalendar(account, { name: 'Read only CalDAV' });
    await expect(createEvent(account.userId, body(calendarId), ZONE)).rejects.toThrow('read-only');
  });

  it('refuses to edit an event that lives in a read-only calendar', async () => {
    const account = await seedAccount();
    const calendarId = await seedCalendarRow(account.userId, { provider: 'ical', readOnly: true, name: 'Feed' });
    const eventId = await seedLocalEvent(account, calendarId, { summary: 'Mirrored' });
    await expect(updateEvent(account.userId, eventId, { summary: 'Changed' }, ZONE)).rejects.toThrow('read-only');
  });

  it('still writes an event into a writable local calendar', async () => {
    const account = await seedAccount();
    const calendarId = await seedCalendarRow(account.userId, { provider: 'local', readOnly: false, name: 'Local' });
    const created = await createEvent(account.userId, body(calendarId), ZONE);
    expect(created.calendarId).toBe(calendarId);
  });
});

/**
 * The editor is the one path to an event that does not go through the preview,
 * so its read-only state is pinned from source (the components cannot render in
 * node): the form locks on the selected calendar's own flag, and the picker
 * only offers calendars that accept a write.
 */
describe('the event editor refuses a read-only calendar', () => {
  const source = (file: string) =>
    readFileSync(new URL(`../src/components/calendar/${file}`, import.meta.url), 'utf8');
  const EDITOR = source('EventEditorSheet.tsx');
  const PICKER = source('CalendarCombobox.tsx');
  const SCREEN = source('CalendarScreen.tsx');

  it('locks the save when the selected calendar is read-only', () => {
    expect(EDITOR).toContain('const locked = readOnly || Boolean(selectedCalendar?.readOnly);');
    expect(EDITOR).toContain('if (locked || rangeError) return;');
    expect(EDITOR).toContain('if (locked || !event) return;');
  });

  it('offers only writable calendars as a destination', () => {
    expect(PICKER).toContain('calendars.filter((calendar) => !calendar.readOnly)');
  });

  it('never seeds a read-only calendar as the create default', () => {
    expect(SCREEN).toContain('filterCalendar && !filterCalendar.readOnly');
    expect(SCREEN).toContain('calendar.isDefault && !calendar.readOnly');
  });
});
