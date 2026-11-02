/**
 * Completed tasks on the calendar.
 *
 * A task used to leave the calendar the moment it was ticked off — the
 * aggregation read asked for `status = 'todo'` and the row stopped being
 * returned, so the block vanished from the month and from the day it belonged
 * to. That reads as lost work, not as progress: the day still happened, and the
 * one screen that shows what a day held was the one screen that forgot.
 *
 * The rule now is that the calendar draws finished work greyed out. The grey is
 * the client's half (`DayAgenda` dims and strikes the row, `DayDetailSheet` does
 * the same in the day sheet); this file pins the server's half against a real
 * migrated SQLite file, including the `includeCompletedTasks: false` escape on
 * the aggregation read that anything asking "what is still to do" must use.
 */
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getCalendarItems } from '@/server/services/calendar-items';
import { createTask, completeTask } from '@/server/repos/tasks';
import { disposeTempDatabase, seedAccount, useTempDatabase } from './sync-helpers';

const ZONE = 'UTC';
const WINDOW_START = Date.parse('2024-03-01T00:00:00Z');
const WINDOW_END = Date.parse('2024-04-01T00:00:00Z');
const DUE = Date.parse('2024-03-05T10:00:00Z');

const source = (relative: string): string =>
  readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8');

const AGENDA = source('src/components/calendar/DayAgenda.tsx');
const DAY_SHEET = source('src/components/calendar/DayDetailSheet.tsx');

let databaseFile = '';

beforeEach(async () => {
  databaseFile = await useTempDatabase();
});

afterEach(async () => {
  await disposeTempDatabase(databaseFile);
});

/** Task items in the window, as `title:completed` pairs in render order. */
async function taskItems(userId: string, includeCompletedTasks?: boolean): Promise<string[]> {
  const items = await getCalendarItems({
    userId,
    zone: ZONE,
    startMs: WINDOW_START,
    endMs: WINDOW_END,
    includeCompletedTasks,
  });
  return items
    .filter((item) => item.kind === 'task')
    .map((item) => `${item.title}:${item.completed ? 'done' : 'open'}`);
}

describe('a completed task stays on the calendar, greyed out', () => {
  it('keeps it as a block with `completed` set, on the day it was due', async () => {
    const account = await seedAccount();
    const created = await createTask(
      account.userId,
      { title: 'Post the parcel', dueAtMs: DUE, timezone: ZONE },
      ZONE,
    );

    expect(await taskItems(account.userId)).toEqual(['Post the parcel:open']);

    await completeTask(account.userId, created.id, ZONE);

    /*
     * Same day, still a block. The row keeps its due date when it is completed —
     * a task finished late belongs to the day it was owed, not the day it was
     * ticked — so nothing about the window changes and only the flag does.
     */
    expect(await taskItems(account.userId)).toEqual(['Post the parcel:done']);

    const [item] = (
      await getCalendarItems({ userId: account.userId, zone: ZONE, startMs: WINDOW_START, endMs: WINDOW_END })
    ).filter((entry) => entry.kind === 'task');
    expect(item.startMs).toBe(DUE);
    expect(item.isAllDay).toBe(false);
  });

  it('can still be read without them, for anything asking what is left to do', async () => {
    const account = await seedAccount();
    const created = await createTask(
      account.userId,
      { title: 'Post the parcel', dueAtMs: DUE, timezone: ZONE },
      ZONE,
    );
    await createTask(
      account.userId,
      { title: 'Collect the parcel', dueAtMs: DUE + 60_000, timezone: ZONE },
      ZONE,
    );
    await completeTask(account.userId, created.id, ZONE);

    expect(await taskItems(account.userId, false)).toEqual(['Collect the parcel:open']);
    expect(await taskItems(account.userId)).toEqual(['Post the parcel:done', 'Collect the parcel:open']);
  });

  it('does not resurrect a deleted completed task', async () => {
    const account = await seedAccount();
    const created = await createTask(
      account.userId,
      { title: 'Post the parcel', dueAtMs: DUE, timezone: ZONE },
      ZONE,
    );
    await completeTask(account.userId, created.id, ZONE);

    const { deleteTask } = await import('@/server/repos/tasks');
    await deleteTask(account.userId, created.id);

    // A tombstoned row is not history worth drawing; it was removed.
    expect(await taskItems(account.userId)).toEqual([]);
  });
});

describe('a task you decided not to do stays off the calendar', () => {
  it('draws neither a block nor a greyed one for `wont_do`', async () => {
    const account = await seedAccount();
    const { updateTask } = await import('@/server/repos/tasks');
    const created = await createTask(
      account.userId,
      { title: 'Renew the domain', dueAtMs: DUE, timezone: ZONE },
      ZONE,
    );

    await updateTask(account.userId, created.id, { status: 'wont_do' }, ZONE);

    /*
     * `completed` is the only status the calendar knows how to grey: an item is
     * either live or struck through, and a `wont_do` row arriving as a live block
     * would say the day still holds work that was explicitly dropped.
     */
    expect(await taskItems(account.userId)).toEqual([]);
  });
});

describe('the calendar draws a finished task as finished', () => {
  /*
   * The grey is the client's half of the rule above, and it is only worth
   * sending the rows if they arrive looking done: a completed block that reads
   * as live work is worse than the block being missing, because it says the day
   * still holds that commitment.
   */
  it('dims the agenda row and strikes its title through', () => {
    expect(AGENDA).toContain("const done = Boolean(item.completed);");
    expect(AGENDA).toContain("done && 'opacity-60'");
    expect(AGENDA).toContain("cn(done && 'line-through')");
  });

  it('dims and strikes the row in the day sheet too', () => {
    expect(DAY_SHEET).toContain("item.completed ? 'text-muted-foreground line-through' : 'text-foreground'");
  });
});
