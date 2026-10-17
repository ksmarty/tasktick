/**
 * What a reminder's notification opens, and what it offers to do.
 *
 * A reminder already knows the three things a notification needs: which item it
 * is about (`source` + `sourceId`), which occurrence it was for
 * (`occurrenceKey`), and whether that item can be finished from the notification
 * at all. Both the deep link and the button are derived from those, here rather
 * than in the transport, so the web push payload and the button's report back to
 * `/api/reminders/ack` cannot disagree about where a tap goes.
 *
 * The routes are the ones the screens already read:
 *
 *   task   `/tasks?task=<id>`                  opens the task's detail sheet
 *   habit  `/habits?habit=<id>`                opens the habit's editor sheet
 *   event  `/calendar?date=<day>&event=<id>`   selects the day and opens the
 *                                              event's preview card
 *
 * `data` travels with the notification so a button tap reports the item back
 * without the worker having to parse the URL it just opened.
 */
import { isValidDateOnly, toDateOnly } from '@/lib/dates';

/** The three kinds of thing a reminder can be about. */
export type ReminderSource = 'task' | 'event' | 'habit';

/** The reminder fields a link is built from. */
export interface ReminderDigest {
  source: ReminderSource;
  sourceId: string;
  occurrenceKey: string;
  title: string;
}

/** One button on a notification. The id is what `notificationclick` reads. */
export interface ReminderAction {
  action: string;
  title: string;
}

/** The `data` a button tap reports back, plus the tap target and its tag. */
export interface ReminderLink {
  /** An app-absolute path, which is what the worker navigates to. */
  url: string;
  /** Collapses two notifications for the same item and occurrence. */
  tag: string;
  actions: ReminderAction[];
  data: Record<string, string>;
}

/** The id of the one button that finishes the item the reminder is about. */
export const COMPLETE_ACTION = 'complete';

/**
 * The day a habit reminder's occurrence key names.
 *
 * A habit reminder is `<date>:<minute>`, and the date is the day it belongs to —
 * which is the day a check-in from the notification has to write, so it is read
 * back here rather than guessed from "now" (the notification can be tapped the
 * next morning).
 */
export function habitOccurrenceDate(occurrenceKey: string): string | null {
  const date = occurrenceKey.split(':')[0] ?? '';
  return isValidDateOnly(date) ? date : null;
}

/**
 * The instant an event reminder's occurrence names, in epoch milliseconds.
 *
 * An event occurrence key is `<startMs>:<offsetMinutes>` — the instant the event
 * starts, then which of its reminder offsets fired. The day is only known once
 * the start is read in the user's zone, which is why this returns the instant
 * and the caller converts.
 */
function eventStartMs(occurrenceKey: string): number | null {
  const start = Number(occurrenceKey.split(':')[0]);
  return Number.isFinite(start) && start > 0 ? start : null;
}

/**
 * The tap target, tag and buttons for one reminder.
 *
 * A task and a habit get a button that finishes them, because both have a single
 * obvious write and both are things a reminder exists to get done. An event has
 * nothing to tick off, so its notification carries no button at all: the tap is
 * the whole action, and it opens the event's card on the right day.
 */
export function reminderLink(reminder: ReminderDigest, zone: string): ReminderLink {
  const data = {
    source: reminder.source,
    sourceId: reminder.sourceId,
    occurrenceKey: reminder.occurrenceKey,
  };

  if (reminder.source === 'task') {
    return {
      url: `/tasks?task=${encodeURIComponent(reminder.sourceId)}`,
      // One task is one notification: a later reminder for the same task
      // replaces the earlier one rather than stacking beside it.
      tag: `task-${reminder.sourceId}`,
      actions: [{ action: COMPLETE_ACTION, title: 'Complete' }],
      data,
    };
  }

  if (reminder.source === 'habit') {
    const date = habitOccurrenceDate(reminder.occurrenceKey);
    return {
      url: `/habits?habit=${encodeURIComponent(reminder.sourceId)}`,
      // The day is part of the tag, so this morning's reminder and this
      // evening's are two reminders about one habit rather than one.
      tag: `habit-${reminder.sourceId}-${date ?? reminder.occurrenceKey}`,
      actions: [{ action: COMPLETE_ACTION, title: 'Check in' }],
      data,
    };
  }

  const startMs = eventStartMs(reminder.occurrenceKey);
  const date = startMs === null ? null : toDateOnly(startMs, zone);
  const id = encodeURIComponent(reminder.sourceId);
  return {
    url: date ? `/calendar?date=${date}&event=${id}` : `/calendar?event=${id}`,
    tag: `event-${reminder.sourceId}-${startMs ?? reminder.occurrenceKey}`,
    actions: [],
    data,
  };
}
