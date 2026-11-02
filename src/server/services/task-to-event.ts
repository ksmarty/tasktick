/**
 * Turning a task into a calendar event.
 *
 * The two records are different shapes of the same intention: a task says "this
 * needs doing, and it is due then", an event says "this occupies this span". The
 * user's editor used to blur that line — the task editor had a *Calendar*
 * dropdown, so a task could be filed into a collection and still behave as a
 * task everywhere it was opened — and the replacement is an explicit move: pick a
 * calendar, and the record becomes an event there.
 *
 * ## What carries over, and what cannot
 *
 * The title, notes, link, due day and time, the estimate (as the length of the
 * block), recurrence and reminders all have an event equivalent. Tracked time,
 * priority, tags, list membership and the parent task do not: they are task-only
 * concepts. Losing them is the point of a conversion rather than a leak, so the
 * dialog says so, but two cases would lose *content* rather than attributes, and
 * both are refused instead of performed:
 *
 * - a task with **subtasks** — `deleteTask` removes children with their parent,
 *   so converting a parent would silently destroy work that is not being
 *   converted;
 * - a task with **no due date and no estimate** — an event needs a start, and
 *   inventing today for something the user never scheduled is data they did not
 *   enter. Refused with a message the editor can show next to the button.
 *
 * Everything else degrades to the calendar editor's own defaults.
 */
import { timeIn, toDateOnly } from '@/lib/dates';
import type { EventInput } from '@/server/repos/calendars';
import { createEvent, deleteEvent, getCalendar } from '@/server/repos/calendars';
import { deleteTask, getTask } from '@/server/repos/tasks';
import type { Task } from '@/lib/types';

/** Why a conversion was refused, as a message the API can hand back verbatim. */
export type ConversionRefusal = 'not-found' | 'has-subtasks' | 'no-date' | 'invalid-span';

export const CONVERSION_REFUSALS: Record<ConversionRefusal, string> = {
  'not-found': 'That task does not exist.',
  'has-subtasks': 'This task has subtasks. Converting it would delete them, so it cannot be converted.',
  'no-date': 'Give the task a due date first: an event needs to start somewhere.',
  'invalid-span': 'That calendar cannot hold this event.',
};

/**
 * The event body for a task, or the reason there is none.
 *
 * Pure: it reads the task and never writes, so the mapping is testable without a
 * database and the refusal rules are visible in one place.
 *
 * A task due on a day *without* a time becomes an all-day event (its exclusive
 * end is resolved by `createEvent`), and one with a time becomes a block of
 * `estimateMinutes` — or the calendar editor's own default of an hour when the
 * task has no estimate, which is what the user would have gotten by adding the
 * event by hand.
 */
export function buildEventInputFromTask(
  task: Task,
  calendarId: string,
  zone: string,
): { body: EventInput } | { refusal: ConversionRefusal } {
  if ((task.subtasks?.length ?? 0) > 0) return { refusal: 'has-subtasks' };

  const summary = task.title.trim();
  if (!summary) return { refusal: 'invalid-span' };

  /*
   * `dueAtMs` is the timed due instant and `dueDate` the floating day; a task
   * with neither has no place on a calendar. A task whose day is set but whose
   * time is not is all-day, which is exactly how the calendar draws a task with
   * no time too.
   */
  const startDate = task.dueDate ?? (task.dueAtMs ? toDateOnly(task.dueAtMs, zone) : null);
  if (!startDate) return { refusal: 'no-date' };

  const timed = task.dueAtMs !== null && !task.isAllDay;
  const body: EventInput = {
    calendarId,
    summary,
    description: task.notes ?? null,
    url: task.url ?? null,
    startDate,
    isAllDay: !timed,
    /* Reminders are the same minutes-before-start numbers on both records. */
    reminders: (task.reminders ?? []).map((item) => item.offsetMinutes).filter((value) => value !== null),
    /*
     * The task's own zone wins over the user's, because a task imported from
     * another calendar keeps the zone it was written in and its wall-clock time
     * is what the user sees.
     */
    timezone: task.timezone ?? zone,
  };

  if (timed) {
    const startMs = task.dueAtMs as number;
    const minutes = task.estimateMinutes && task.estimateMinutes > 0 ? task.estimateMinutes : 60;
    body.startMs = startMs;
    body.endMs = startMs + minutes * 60_000;
    body.startTime = timeIn(startMs, body.timezone as string);
    body.endTime = timeIn(body.endMs, body.timezone as string);
  }

  /* Recurrence carries over as the same RRULE; the task already stores one. */
  if (task.recurrenceRule) body.rrule = task.recurrenceRule;

  return { body };
}

export interface ConversionResult {
  eventId: string;
  /** The task's own id, kept for the client's optimistic removal. */
  taskId: string;
  calendarId: string;
}

/**
 * Create the event, then remove the task — in that order, for a reason.
 *
 * The database offers no cross-repo transaction here (`createEvent` and
 * `deleteTask` each open their own), so the safe direction is the one a crash
 * leaves recoverable: an event that exists next to a task that also still exists
 * is a visible duplicate the user can delete, while a task deleted with no event
 * written is work that vanished. If the removal fails, the event this call
 * created is deleted again before the error is rethrown, so a failure leaves the
 * user exactly where they started.
 */
export async function convertTaskToEvent(
  userId: string,
  taskId: string,
  calendarId: string,
  zone: string,
): Promise<ConversionResult> {
  const task = await getTask(userId, taskId);
  if (!task) throw new ConversionError('not-found');

  const calendar = await getCalendar(userId, calendarId);
  if (!calendar) throw new ConversionError('invalid-span');

  const built = buildEventInputFromTask(task, calendarId, zone);
  if ('refusal' in built) throw new ConversionError(built.refusal);

  const event = await createEvent(userId, built.body, zone);

  try {
    await deleteTask(userId, taskId);
  } catch (error) {
    /* Undo the half that happened, so a failed conversion changes nothing. */
    await deleteEvent(userId, event.id).catch(() => undefined);
    throw error;
  }

  return { eventId: event.id, taskId, calendarId };
}

/** A refusal with the message the API should show, not a bare string. */
export class ConversionError extends Error {
  readonly refusal: ConversionRefusal;

  constructor(refusal: ConversionRefusal) {
    super(CONVERSION_REFUSALS[refusal]);
    this.name = 'ConversionError';
    this.refusal = refusal;
  }
}

/**
 * The day a conversion would use, for the dialog's "on Fri Oct 30" line.
 *
 * Kept here rather than in the client so the rule ("the due day, else the
 * today of the user's zone") cannot disagree with what `buildEventInputFromTask`
 * actually writes.
 */
export function conversionStartDay(task: Task, zone: string): string | null {
  return task.dueDate ?? (task.dueAtMs ? toDateOnly(task.dueAtMs, zone) : null) ?? null;
}
