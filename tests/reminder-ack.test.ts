/**
 * Finishing an item from a notification's button.
 *
 * `public/sw.js` posts what the button reported to `POST /api/reminders/ack`,
 * and the write behind it is the one the screen makes: a task completion, a
 * habit check-in. The case that earns the file is the habit day — a notification
 * tapped the next morning has to check in the day it was *for*, which is the day
 * carried in the occurrence key rather than the day the tap happened.
 *
 * These run against a real migrated SQLite file, the same way the reminder tests
 * do, so the row that lands is the row being asserted.
 */
import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { newId } from '@/server/crypto';
import { getDb } from '@/server/db';
import { habitEntries, taskCompletions, user } from '@/server/db/schema';
import { createHabit } from '@/server/repos/habits';
import { createTask, getTask } from '@/server/repos/tasks';
import { acknowledgeReminder } from '@/server/services/reminder-actions';
import { disposeTempDatabase, useTempDatabase } from './sync-helpers';

const ZONE = 'UTC';

let databaseFile: string;
let userId: string;

beforeEach(async () => {
  databaseFile = await useTempDatabase();
  userId = newId();
  await getDb().insert(user).values({
    id: userId,
    name: 'Ack Tester',
    email: `${userId}@example.test`,
    emailVerified: true,
    timezone: ZONE,
  });
});

afterEach(async () => {
  await disposeTempDatabase(databaseFile);
});

describe('a task notification', () => {
  it('completes the task and reports it back', async () => {
    const task = await createTask(userId, { title: 'Pay rent', dueDate: '2026-05-12' }, ZONE);

    const result = await acknowledgeReminder(userId, { source: 'task', sourceId: task.id, occurrenceKey: 'rem-1' }, ZONE);

    expect(result).toMatchObject({ status: 'done', source: 'task', task: { id: task.id } });
    const rows = await getDb().select().from(taskCompletions).where(eq(taskCompletions.taskId, task.id));
    expect(rows).toHaveLength(1);
  });

  it('reports a task that is already gone as missing rather than writing', async () => {
    const result = await acknowledgeReminder(userId, { source: 'task', sourceId: 'task-that-left' }, ZONE);

    expect(result).toEqual({ status: 'missing', message: 'That task does not exist.' });
    const rows = await getDb().select().from(taskCompletions).where(eq(taskCompletions.userId, userId));
    expect(rows).toEqual([]);
  });

  it('logs a completion per press, exactly as the sheet’s own button does', async () => {
    const task = await createTask(userId, { title: 'Pay rent', dueDate: '2026-05-12' }, ZONE);

    await acknowledgeReminder(userId, { source: 'task', sourceId: task.id }, ZONE);
    await acknowledgeReminder(userId, { source: 'task', sourceId: task.id }, ZONE);

    // Deliberately the same write as the screen's: a non-recurring task is done
    // and each press records that it was done, so the button never becomes a
    // second, quieter definition of completion.
    const rows = await getDb().select().from(taskCompletions).where(eq(taskCompletions.taskId, task.id));
    expect(rows).toHaveLength(2);
    expect(await getTask(userId, task.id)).toBeTruthy();
  });
});

describe('a habit notification', () => {
  it('checks in the day the occurrence key names, not the day of the tap', async () => {
    const habit = await createHabit(userId, { name: 'Stretch', frequency: 'daily' }, ZONE);

    const result = await acknowledgeReminder(
      userId,
      { source: 'habit', sourceId: habit.id, occurrenceKey: '2026-05-11:720' },
      ZONE,
    );

    expect(result).toMatchObject({ status: 'done', source: 'habit' });
    const rows = await getDb()
      .select()
      .from(habitEntries)
      .where(and(eq(habitEntries.habitId, habit.id), eq(habitEntries.date, '2026-05-11')));
    expect(rows).toHaveLength(1);
    expect(rows[0].date).toBe('2026-05-11');
  });

  it('refuses an occurrence key that names no day instead of checking in today', async () => {
    const habit = await createHabit(userId, { name: 'Stretch', frequency: 'daily' }, ZONE);

    const result = await acknowledgeReminder(userId, { source: 'habit', sourceId: habit.id, occurrenceKey: 'later' }, ZONE);

    expect(result).toEqual({ status: 'unsupported', message: 'That notification did not name a day to check in.' });
    const rows = await getDb().select().from(habitEntries).where(eq(habitEntries.userId, userId));
    expect(rows).toEqual([]);
  });

  it('reports a habit that is already gone as missing', async () => {
    const result = await acknowledgeReminder(
      userId,
      { source: 'habit', sourceId: 'habit-that-left', occurrenceKey: '2026-05-11:720' },
      ZONE,
    );

    expect(result).toEqual({ status: 'missing', message: 'That habit does not exist.' });
  });
});

describe('an event notification', () => {
  it('has nothing to complete', async () => {
    const result = await acknowledgeReminder(userId, { source: 'event', sourceId: 'event-1', occurrenceKey: '2' }, ZONE);

    expect(result).toEqual({ status: 'unsupported', message: 'An event has nothing to complete.' });
  });
});
