/**
 * The write a reminder notification's button makes.
 *
 * `public/sw.js` reports a button press to `POST /api/reminders/ack`, and what
 * it reports is deliberately the same write the screen's own route makes — the
 * one behind `POST /api/tasks/:id/complete` and `POST /api/habits/:id/checkin` —
 * rather than a second implementation of "done": a recurring task rolls to its
 * next occurrence and a habit check-in settles the day it belongs to, exactly as
 * if the sheet had been used.
 *
 * It lives here instead of in the route so the decision can be tested without a
 * session: the route parses the body, resolves the zone and maps the outcome
 * onto a status, and everything that decides anything is this function.
 *
 * The occurrence key is what makes a habit's button correct. The notification can
 * be tapped the next morning, so the day to check in is the day the reminder was
 * *for*, carried in the key, and not the day it was tapped. A key that names no
 * day is refused rather than guessed at — checking in the wrong day is worse than
 * a button that does nothing.
 */
import type { DateOnly, Task } from '@/lib/types';
import { habitOccurrenceDate, type ReminderSource } from '@/lib/reminder-notification';
import { checkIn, type CheckInInput } from '@/server/repos/habits';
import { completeTask, getTask } from '@/server/repos/tasks';

/** What the service worker posts when a button is pressed. */
export interface ReminderAckInput {
  source: ReminderSource;
  sourceId: string;
  occurrenceKey?: string;
}

/** The outcome of the write, before the route decides on a status code. */
export type ReminderAck =
  | { status: 'done'; source: 'task'; task: Task }
  | { status: 'done'; source: 'habit'; habit: { entries: Record<DateOnly, number>; doneToday: boolean } }
  /** The item is gone (deleted, or never the user's): a 404. */
  | { status: 'missing'; message: string }
  /** The request itself cannot be honoured: a 400. */
  | { status: 'unsupported'; message: string };

/** Finish whatever the notification was about. */
export async function acknowledgeReminder(userId: string, input: ReminderAckInput, zone: string): Promise<ReminderAck> {
  if (input.source === 'task') {
    // `completeTask` throws for an id it cannot see, and the button's own report
    // is not worth a 500: look first, so a stale notification is a clean 404.
    const before = await getTask(userId, input.sourceId);
    if (!before) return { status: 'missing', message: 'That task does not exist.' };

    const task = await completeTask(userId, input.sourceId, zone);
    return task ? { status: 'done', source: 'task', task } : { status: 'missing', message: 'That task does not exist.' };
  }

  if (input.source === 'habit') {
    const date = habitOccurrenceDate(input.occurrenceKey ?? '');
    if (!date) return { status: 'unsupported', message: 'That notification did not name a day to check in.' };

    const habit = await checkIn(userId, input.sourceId, { date } satisfies CheckInInput, zone);
    return habit ? { status: 'done', source: 'habit', habit } : { status: 'missing', message: 'That habit does not exist.' };
  }

  // An event reminder carries no button, so this is a hand-made request.
  return { status: 'unsupported', message: 'An event has nothing to complete.' };
}
