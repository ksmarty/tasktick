/**
 * End-to-end import against a real migrated SQLite file.
 *
 * These are the guarantees that matter to a user: the rows land, importing twice
 * does nothing the second time, an existing list is reused rather than
 * duplicated, a failure leaves nothing behind, and an unparseable file never
 * reaches the database at all.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetEnvCache } from '@/lib/env';
import { resetDialectCache } from '@/server/db/dialect';
import { closeDb, getDb } from '@/server/db';
import { withTransaction } from '@/server/db/transaction';
import { importKeys, lists, tags, taskReminders, taskTags, tasks, user } from '@/server/db/schema';
import { createList } from '@/server/repos/lists';
import { applyTickTickImport } from '@/server/services/ticktick-import';
import { parseTickTickCsv, type TickTickPlan } from '@/lib/ticktick-import';

const USER_ID = 'user-import-test';
let tempDir = '';

const HEADER = [
  'Folder Name',
  'List Name',
  'Title',
  'Kind',
  'Tags',
  'Content',
  'Is Check list',
  'Start Date',
  'Due Date',
  'Reminder',
  'Repeat',
  'Priority',
  'Status',
  'Created Time',
  'Completed Time',
  'Order',
  'Timezone',
  'Is All Day',
  'Is Floating',
  'Column Name',
  'Column Order',
  'View Mode',
  'taskId',
  'parentId',
  'projectKind',
];

const csvRow = (cells: string[]) => cells.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(',');

function tickTickRow(overrides: Record<number, string> = {}): string {
  const cells = new Array<string>(HEADER.length).fill('');
  cells[1] = 'Launch';
  cells[2] = 'A task';
  cells[3] = 'TEXT';
  cells[24] = 'TASK';
  for (const [index, value] of Object.entries(overrides)) cells[Number(index)] = value;
  return csvRow(cells);
}

function buildCsv(rows: string[]): string {
  const preamble = ['"Date: 2026-06-17+0000"', '"Version: 7.1"', '"Status:\n0 Normal\n1 Completed"'];
  return [...preamble, csvRow(HEADER), ...rows].join('\n');
}

function planFor(csv: string): TickTickPlan {
  const parsed = parseTickTickCsv(csv, { fileName: 'backup.csv' });
  if (!parsed.ok) throw new Error(`fixture did not parse: ${parsed.error}`);
  return parsed.plan;
}

beforeEach(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tasktick-import-'));
  const file = path.join(tempDir, 'import.db');
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
    name: 'Importer',
    email: 'importer@example.test',
    emailVerified: true,
    timezone: 'UTC',
  });
});

afterEach(async () => {
  await closeDb();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

const listNames = async () =>
  (await getDb().select().from(lists).where(eq(lists.userId, USER_ID))).map((row) => row.name).sort();
const taskRows = async () => getDb().select().from(tasks).where(eq(tasks.userId, USER_ID));
const keyRows = async () => getDb().select().from(importKeys).where(eq(importKeys.userId, USER_ID));

describe('applyTickTickImport', () => {
  it('creates lists, tasks, subtasks and tags', async () => {
    const csv = buildCsv([
      tickTickRow({ 2: 'Plan release', 4: '#work, focus', 8: '2026-06-18T09:30:00+0000', 11: '5', 16: 'UTC', 22: 't1' }),
      tickTickRow({ 2: 'Buy milk', 1: 'Errands', 8: '2026-06-19', 17: 'true', 22: 't2' }),
      tickTickRow({ 2: 'Subtask', 22: 't3', 23: 't1', 15: '1' }),
    ]);

    const summary = await applyTickTickImport({ userId: USER_ID, zone: 'UTC', plan: planFor(csv) });

    expect(summary).toEqual({
      listsCreated: 2,
      listsReused: 0,
      tasksCreated: 2,
      subtasksCreated: 1,
      remindersCreated: 0,
      skippedExisting: 0,
    });
    expect(await listNames()).toEqual(['Errands', 'Launch']);

    const rows = await taskRows();
    expect(rows).toHaveLength(3);

    const parent = rows.find((row) => row.title === 'Plan release')!;
    expect(parent).toMatchObject({
      priority: 'high',
      status: 'todo',
      dueDate: '2026-06-18',
      dueAtMs: Date.parse('2026-06-18T09:30:00Z'),
      isAllDay: false,
    });

    const child = rows.find((row) => row.title === 'Subtask')!;
    expect(child.parentId).toBe(parent.id);

    const allDay = rows.find((row) => row.title === 'Buy milk')!;
    expect(allDay).toMatchObject({ dueDate: '2026-06-19', dueAtMs: null, isAllDay: true });

    const attached = await getDb()
      .select({ name: tags.name })
      .from(taskTags)
      .innerJoin(tags, eq(tags.id, taskTags.tagId))
      .where(eq(taskTags.taskId, parent.id));
    expect(attached.map((row) => row.name).sort()).toEqual(['focus', 'work']);
  });

  it('keeps completion time, recurrence and a real parent/child link', async () => {
    const csv = buildCsv([
      tickTickRow({
        2: 'Recurring',
        10: 'FREQ=WEEKLY;BYDAY=MO',
        12: '2',
        14: '2026-06-15T12:00:00+0000',
        22: 'r1',
      }),
    ]);
    await applyTickTickImport({ userId: USER_ID, zone: 'UTC', plan: planFor(csv) });
    const [row] = await taskRows();
    expect(row).toMatchObject({
      status: 'completed',
      completedAtMs: Date.parse('2026-06-15T12:00:00Z'),
      recurrenceRule: 'FREQ=WEEKLY;BYDAY=MO',
    });
  });

  it('writes reminder rows relative to the due instant', async () => {
    const csv = buildCsv([
      tickTickRow({ 2: 'Remind me', 8: '2026-06-18T09:30:00+0000', 9: '-PT15M\n-PT1440M', 16: 'UTC', 22: 'rm1' }),
    ]);
    const summary = await applyTickTickImport({ userId: USER_ID, zone: 'UTC', plan: planFor(csv) });
    expect(summary.remindersCreated).toBe(2);

    const rows = await getDb().select().from(taskReminders).where(eq(taskReminders.userId, USER_ID));
    expect(rows.map((row) => row.offsetMinutes).sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual([-1440, -15]);
    expect(rows.map((row) => row.fireAtMs).sort((a, b) => a - b)).toEqual([
      Date.parse('2026-06-17T09:30:00Z'),
      Date.parse('2026-06-18T09:15:00Z'),
    ]);
  });

  it('is idempotent: a second import creates nothing, even after a rename', async () => {
    const csv = buildCsv([
      tickTickRow({ 2: 'Plan release', 22: 't1' }),
      tickTickRow({ 2: 'Subtask', 22: 't2', 23: 't1', 15: '1' }),
    ]);

    await applyTickTickImport({ userId: USER_ID, zone: 'UTC', plan: planFor(csv) });
    const before = await taskRows();
    expect(before).toHaveLength(2);

    // Renaming the imported row must not defeat idempotency: the key is the
    // source's task id, not the content.
    await getDb().update(tasks).set({ title: 'Renamed locally' }).where(eq(tasks.id, before[0]!.id));

    const second = await applyTickTickImport({ userId: USER_ID, zone: 'UTC', plan: planFor(csv) });
    expect(second.tasksCreated).toBe(0);
    expect(second.subtasksCreated).toBe(0);
    expect(second.skippedExisting).toBe(2);
    expect(second.listsCreated).toBe(0);
    expect(second.listsReused).toBe(1);
    expect(await taskRows()).toHaveLength(2);
  });

  it('reuses a list that already exists by name', async () => {
    await createList(USER_ID, { name: 'Launch', color: 'purple' });
    const csv = buildCsv([tickTickRow({ 2: 'Plan release', 22: 't1' })]);

    const summary = await applyTickTickImport({ userId: USER_ID, zone: 'UTC', plan: planFor(csv) });
    expect(summary.listsCreated).toBe(0);
    expect(summary.listsReused).toBe(1);
    expect(await listNames()).toEqual(['Launch']);
  });

  it('rolls the whole write back when anything fails', async () => {
    await expect(
      withTransaction(async (db) => {
        await createList(USER_ID, { name: 'Half written' }, db);
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    expect(await listNames()).toEqual([]);
  });

  it('never touches the database for an unparseable file', async () => {
    const parsed = parseTickTickCsv('this is not a TickTick backup');
    expect(parsed.ok).toBe(false);
    expect(await listNames()).toEqual([]);
    expect(await taskRows()).toEqual([]);
    expect(await keyRows()).toEqual([]);
  });

  it('never touches the database for a file past the row cap', async () => {
    const rows = Array.from({ length: 4 }, (_, i) => tickTickRow({ 2: `Task ${i}`, 22: `t${i}` }));
    const parsed = parseTickTickCsv(buildCsv(rows), { maxRows: 2 });
    expect(parsed).toMatchObject({ ok: false, code: 'too_large' });
    expect(await taskRows()).toEqual([]);
  });

  it('records one provenance row per created entity', async () => {
    const csv = buildCsv([
      tickTickRow({ 2: 'A', 22: 't1' }),
      tickTickRow({ 2: 'B', 1: 'Other', 22: 't2' }),
    ]);
    await applyTickTickImport({ userId: USER_ID, zone: 'UTC', plan: planFor(csv) });
    const keys = await keyRows();
    // two lists, two tasks
    expect(keys).toHaveLength(4);
    expect(keys.filter((row) => row.entityType === 'task')).toHaveLength(2);
    expect(keys.filter((row) => row.entityType === 'list')).toHaveLength(2);
  });

  it('lists imported tasks in the list they came from', async () => {
    const csv = buildCsv([
      tickTickRow({ 2: 'A', 1: 'Launch', 22: 't1' }),
      tickTickRow({ 2: 'B', 1: 'Errands', 22: 't2' }),
    ]);
    await applyTickTickImport({ userId: USER_ID, zone: 'UTC', plan: planFor(csv) });

    const [launch] = await getDb().select().from(lists).where(and(eq(lists.userId, USER_ID), eq(lists.name, 'Launch')));
    const launchTasks = await getDb()
      .select()
      .from(tasks)
      .where(and(eq(tasks.userId, USER_ID), eq(tasks.listId, launch!.id)));
    expect(launchTasks.map((row) => row.title)).toEqual(['A']);
  });
});
