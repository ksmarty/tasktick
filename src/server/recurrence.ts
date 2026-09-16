/**
 * Server-side recurrence.
 *
 * The calendar engine lives in one place only (`@/server/caldav/ical`), because
 * getting RRULE + DST + EXDATE right twice is how you end up with two different
 * answers to "when is the next occurrence". This module is the neutral import
 * point for everything that is not CalDAV — tasks, agendas, the ICS feed — and
 * gives us a single seam to swap the implementation.
 */
import { expandRecurrence } from './caldav/ical';
import type { RecurrenceExpansionInput, RecurrenceOccurrence } from './caldav/types';

export { expandRecurrence } from './caldav/ical';
export type { RecurrenceExpansionInput, RecurrenceOccurrence } from './caldav/types';

import { DateTime } from 'luxon';
import { fromDateOnly, toDateOnly, nowIn, type DateRange } from '@/lib/dates';
import type { DateOnly, Millis, Task } from '@/lib/types';

/**
 * The occurrence immediately after the one being completed.
 *
 * `recurrenceMode` decides what "next" is measured from, and getting this wrong
 * is easy and subtle:
 *
 *   - `due`        — measure from the occurrence that was just completed. The
 *                    schedule is fixed, so ticking a task off early still keeps
 *                    the cadence, and a task due next year advances by exactly
 *                    one period instead of staying on the same day.
 *   - `completion` — measure from the moment it was actually finished. The
 *                    cadence restarts, which is what "3 days after I last did it"
 *                    has to mean.
 *
 * An overdue series is then stepped forward past *now*, because landing on a
 * date that has already passed would make the task instantly overdue again and
 * the user would have to complete it repeatedly to catch up.
 *
 * Returns null when the rule is exhausted (COUNT/UNTIL, or the search window ran
 * out), in which case the caller leaves the task completed.
 */
export function nextOccurrence(
  task: Pick<Task, 'dueAtMs' | 'dueDate' | 'timezone' | 'recurrenceRule' | 'recurrenceMode'>,
  afterMs: Millis,
  fallbackZone: string,
): { dueAtMs: Millis | null; dueDate: DateOnly | null } | null {
  const rule = task.recurrenceRule;
  if (!rule) return null;

  const zone = task.timezone ?? fallbackZone;
  const anchorMs = task.dueAtMs ?? (task.dueDate ? fromDateOnly(task.dueDate, zone).toMillis() : null);
  if (anchorMs === null) return null;

  const completionBased = task.recurrenceMode === 'completion';
  const duration = task.dueAtMs ? 0 : 24 * 60 * 60 * 1000;

  /**
   * Where the rule's grid starts.
   *
   * `due` mode expands from the task's own schedule. `completion` mode has to
   * re-anchor the grid at the moment of completion — keeping the task's
   * time-of-day — because "every 3 days" means "3 days after I finished", not
   * "the next slot on a grid anchored at the original date". Expanding from the
   * original anchor would also leave a far-future task stuck forever, since the
   * first slot after now would be its own existing date.
   */
  const expandAnchorMs = completionBased ? completionAnchor(task, anchorMs, afterMs, zone) : anchorMs;

  // One generous expansion, then select from it. The window only needs to reach
  // far enough for the overdue-advance loop below; the occurrence cap is the
  // real guard against a pathological rule such as FREQ=SECONDLY.
  const occurrences = expandRecurrence({
    rrule: rule,
    startMs: expandAnchorMs,
    durationMs: duration,
    timezone: zone,
    // Back off by a second so the anchor occurrence itself is inside the window.
    range: { startMs: expandAnchorMs - 1000, endMs: expandAnchorMs + 1000 * 60 * 60 * 24 * 365 * 10 },
    maxOccurrences: 2000,
  }).sort((a, b) => a.startMs - b.startMs);

  if (!occurrences.length) return null;

  // Strictly after the anchor, so the occurrence being completed is never
  // selected again.
  let index = occurrences.findIndex((occurrence) => occurrence.startMs > expandAnchorMs);
  if (index === -1) return null;

  // Skip anything that is already in the past (an overdue `due`-mode series).
  while (index < occurrences.length && occurrences[index].startMs <= afterMs) index++;
  if (index >= occurrences.length) return null;

  const next = occurrences[index];

  if (task.dueAtMs) {
    return { dueAtMs: next.startMs, dueDate: toDateOnly(next.startMs, zone) };
  }
  return { dueDate: toDateOnly(next.startMs, zone), dueAtMs: null };
}

/**
 * The instant a `completion`-mode series should be re-anchored at.
 *
 * For a timed task this is the completion moment carrying over the task's
 * original wall-clock time, so "every weekday at 09:00" completed on a Saturday
 * afternoon restarts as 09:00 rather than 14:00. For an all-day task it is the
 * start of the completion day, so the result stays a floating date.
 */
function completionAnchor(
  task: Pick<Task, 'dueAtMs' | 'dueDate'>,
  anchorMs: Millis,
  afterMs: Millis,
  zone: string,
): Millis {
  if (!task.dueAtMs) return fromDateOnly(toDateOnly(afterMs, zone), zone).toMillis();

  const original = DateTime.fromMillis(anchorMs, { zone });
  const completion = DateTime.fromMillis(afterMs, { zone });
  return completion
    .set({ hour: original.hour, minute: original.minute, second: 0, millisecond: 0 })
    .toMillis();
}

/** Every occurrence of a recurring task that falls inside a window. */
export function expandTaskOccurrences(
  task: Pick<Task, 'dueAtMs' | 'dueDate' | 'timezone' | 'recurrenceRule'>,
  range: Pick<DateRange, 'startMs' | 'endMs'>,
  fallbackZone: string,
): Millis[] {
  if (!task.recurrenceRule) {
    const single = task.dueAtMs ?? (task.dueDate ? fromDateOnly(task.dueDate, task.timezone ?? fallbackZone).toMillis() : null);
    return single !== null && single >= range.startMs && single < range.endMs ? [single] : [];
  }

  const zone = task.timezone ?? fallbackZone;
  const anchorMs = task.dueAtMs ?? (task.dueDate ? fromDateOnly(task.dueDate, zone).toMillis() : null);
  if (anchorMs === null) return [];

  return expandRecurrence({
    rrule: task.recurrenceRule,
    startMs: anchorMs,
    durationMs: task.dueAtMs ? 0 : 24 * 60 * 60 * 1000,
    timezone: zone,
    range,
    maxOccurrences: 2000,
  }).map((o) => o.startMs);
}

/** True when the rule has a bounded end (COUNT or UNTIL). */
export function isBoundedRule(rule: string | null | undefined): boolean {
  return Boolean(rule && /\b(COUNT|UNTIL)=/i.test(rule));
}

/** The zone to interpret a task's floating fields in. */
export function taskZone(task: Pick<Task, 'timezone'>, userZone: string): string {
  return task.timezone ?? userZone;
}

export function todayDateOnly(zone: string): DateOnly {
  return nowIn(zone).toFormat('yyyy-MM-dd');
}
