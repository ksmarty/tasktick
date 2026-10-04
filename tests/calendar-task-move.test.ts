/**
 * Moving a task between calendars, seen from the sync layer.
 *
 * A move is a *detach*. The task leaves a collection that may still hold a copy
 * of it on the server, and both halves of the engine have to agree about what
 * happens to that copy: the write side drops the mirror so a push cannot PUT to
 * the old address, and the pull side deletes the leftover rather than importing
 * it a second time.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { serializeTodo } from '@/server/caldav';
import { tasks } from '@/server/db/schema';
import { openSyncDb } from '@/server/sync/engine';
import { setCalDavClientFactory, syncAccount } from '@/server/sync';
import { updateTask } from '@/server/repos/tasks';
import {
  FakeCalDavClient,
  disposeTempDatabase,
  getTaskRow,
  seedAccount,
  seedCalendar,
  seedLocalTask,
  useTempDatabase,
  type SeededAccount,
} from './sync-helpers';

const HOME = 'https://caldav.example.test/c/calendars/home/';
const WORK = 'https://caldav.example.test/c/calendars/work/';
const TASK_HREF = `${HOME}milk.ics`;

const MILK = serializeTodo({
  externalUid: 'todo-milk',
  title: 'Buy milk',
  status: 'todo',
  priority: 'medium',
  dueAtMs: Date.parse('2024-03-06T09:00:00Z'),
  timezone: 'UTC',
});

let databaseFile = '';

beforeEach(async () => {
  databaseFile = await useTempDatabase();
});

afterEach(async () => {
  setCalDavClientFactory(null);
  await disposeTempDatabase(databaseFile);
});

/** An account with a "Home" collection holding one VTODO, and an empty "Work" one. */
async function setup(): Promise<{ account: SeededAccount; home: string; work: string; client: FakeCalDavClient }> {
  const account = await seedAccount();
  const home = await seedCalendar(account, { name: 'Home', remoteHref: HOME });
  const work = await seedCalendar(account, { name: 'Work', remoteHref: WORK });
  const client = new FakeCalDavClient();
  client.addCollection({ href: HOME, displayName: 'Home', supportedComponents: ['VTODO'] });
  client.addCollection({ href: WORK, displayName: 'Work', supportedComponents: ['VTODO'] });
  client.seedObject(TASK_HREF, MILK);
  setCalDavClientFactory(() => client);
  return { account, home, work, client };
}

async function taskCount(userId: string): Promise<number> {
  const db = await openSyncDb();
  const rows = await db.select({ id: tasks.id }).from(tasks).where(eq(tasks.userId, userId));
  return rows.length;
}

/** The task as it is *before* the move: mirrored into Home. */
async function seedMirrored(account: SeededAccount, home: string): Promise<string> {
  return seedLocalTask(account, home, {
    title: 'Buy milk',
    externalUid: 'todo-milk',
    externalHref: TASK_HREF,
    externalEtag: '"e1"',
    syncState: 'synced',
  });
}

describe('moving a task to another collection', () => {
  it('drops the old resource address but keeps the uid that identifies it', async () => {
    const { account, home, work } = await setup();
    const id = await seedMirrored(account, home);

    await updateTask(account.userId, id, { calendarId: work }, 'UTC');

    const row = await getTaskRow(id);
    expect(row.calendarId).toBe(work);
    // The push has to derive a fresh address inside Work, not reuse Home's.
    expect(row.externalHref).toBeNull();
    expect(row.externalEtag).toBeNull();
    expect(row.syncState).toBe('dirty');
    expect(row.syncProvider).toBe('caldav');
    // Kept: this is what lets Home's pull recognise its leftover as this task.
    expect(row.externalUid).toBe('todo-milk');
  });

  it('detaches to local when the task leaves every calendar', async () => {
    const { account, home } = await setup();
    const id = await seedMirrored(account, home);

    await updateTask(account.userId, id, { calendarId: null }, 'UTC');

    const row = await getTaskRow(id);
    expect(row.calendarId).toBeNull();
    expect(row.syncState).toBe('synced');
    expect(row.syncProvider).toBe('local');
    expect(row.externalHref).toBeNull();
    expect(row.externalUid).toBe('todo-milk');
  });
});

describe('the collection the task left, on the next sync', () => {
  it('deletes the leftover instead of importing it a second time', async () => {
    const { account, home, work, client } = await setup();
    const id = await seedMirrored(account, home);
    await updateTask(account.userId, id, { calendarId: work }, 'UTC');

    await syncAccount(account.accountId, { kind: 'full', trigger: 'initial' });

    // The copy in Home is gone from the server...
    expect(client.deleteCalls.map((call) => call.href)).toContain(TASK_HREF);
    expect(await client.getObject(TASK_HREF)).toBeNull();
    // ...and it was not turned into a second task.
    expect(await taskCount(account.userId)).toBe(1);
    const row = await getTaskRow(id);
    expect(row.calendarId).toBe(work);
    expect(row.externalUid).toBe('todo-milk');
  });

  it('leaves a task that never left the collection alone', async () => {
    const { account, client } = await setup();

    await syncAccount(account.accountId, { kind: 'full', trigger: 'initial' });

    expect(client.deleteCalls).toEqual([]);
    expect(await taskCount(account.userId)).toBe(1);
  });
});
