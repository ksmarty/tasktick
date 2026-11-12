/**
 * The change token: does it actually move when the data does?
 *
 * This is the whole contract behind live updates. A page that never made the
 * request cannot see an automation's write, so it compares this string on a
 * timer — and a token that fails to move is a feature that silently does not
 * exist. Each case here is one kind of write that must move it: an edit, an
 * insert, a soft delete (a tombstone, which leaves the row) and a hard delete
 * (which does not). The negative case matters just as much: a read must not move
 * it, or every open page would refetch forever.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetDialectCache } from '@/server/db/dialect';
import { closeDb, getDb } from '@/server/db';
import { habitEntries, habits, user } from '@/server/db/schema';
import { newId } from '@/server/crypto';
import { changeToken } from '@/server/repos/changes';
import { createTask, deleteTask, getTask, updateTask } from '@/server/repos/tasks';
import { resetEnvCache } from '@/lib/env';

const ZONE = 'UTC';
const USER_ID = 'change-token-user';

let tempDir = '';

beforeEach(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tasktick-changes-'));
  const file = path.join(tempDir, 'changes.db');
  process.env.DATABASE_URL = `file:${file}`;
  process.env.BETTER_AUTH_SECRET = 'test-secret-test-secret-test-secret-0001';
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
    name: 'Change Tester',
    email: 'changes@example.test',
    emailVerified: true,
    timezone: ZONE,
  });
});

afterEach(async () => {
  await closeDb();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe('changeToken', () => {
  it('is stable while nothing writes', async () => {
    const task = await createTask(USER_ID, { title: 'Read the docs' }, ZONE);
    const first = await changeToken(USER_ID);
    await getTask(USER_ID, task.id);
    const second = await changeToken(USER_ID);
    expect(second).toBe(first);
    expect(task.id).toBeTruthy();
  });

  it('moves when a task is created', async () => {
    const before = await changeToken(USER_ID);
    await createTask(USER_ID, { title: 'Water the plants' }, ZONE);
    expect(await changeToken(USER_ID)).not.toBe(before);
  });

  it('moves when a task is edited', async () => {
    const task = await createTask(USER_ID, { title: 'Draft' }, ZONE);
    const before = await changeToken(USER_ID);
    // The millisecond clock is the only thing moving here; a change token that
    // compared ids instead would miss this, which is the case an automation hits.
    await new Promise((resolve) => setTimeout(resolve, 2));
    await updateTask(USER_ID, task.id, { title: 'Final draft' }, ZONE);
    expect(await changeToken(USER_ID)).not.toBe(before);
  });

  it('moves when a task is deleted, even though the row stays as a tombstone', async () => {
    const task = await createTask(USER_ID, { title: 'Old' }, ZONE);
    const before = await changeToken(USER_ID);
    await deleteTask(USER_ID, task.id);
    expect(await changeToken(USER_ID)).not.toBe(before);
  });

  it('moves when a row is removed outright', async () => {
    const habitId = newId();
    await getDb().insert(habits).values({
      id: habitId,
      userId: USER_ID,
      name: 'Stretch',
      startDate: '2026-01-01',
      color: 'blue',
    });
    const entryId = newId();
    await getDb().insert(habitEntries).values({
      id: entryId,
      userId: USER_ID,
      habitId,
      date: '2026-01-01',
      count: 1,
    });
    const before = await changeToken(USER_ID);
    await getDb().delete(habitEntries).where(eq(habitEntries.id, entryId));
    expect(await changeToken(USER_ID)).not.toBe(before);
  });

  it('is per account: another user’s writes do not move this token', async () => {
    await getDb().insert(user).values({
      id: 'other-user',
      name: 'Someone Else',
      email: 'other@example.test',
      emailVerified: true,
      timezone: ZONE,
    });
    const before = await changeToken(USER_ID);
    await createTask('other-user', { title: 'Their task' }, ZONE);
    expect(await changeToken(USER_ID)).toBe(before);
  });
});
