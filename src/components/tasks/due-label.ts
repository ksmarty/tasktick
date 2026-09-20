/**
 * The due-date label a task row carries, and the tone that colours it.
 *
 * Pure and separate from `TaskMeta` so the two things that can be wrong — the
 * section-aware format and the overdue/today tone — are unit-tested without a
 * DOM (the repo runs vitest in node with no jsdom, so a `.tsx` module cannot be
 * imported there).
 *
 * The label has two shapes:
 *
 *  - **Inside Today:** the relative day plus the clock time, e.g. `Today 17:00`.
 *    A time is what the user acts on when the row is due now.
 *  - **Anywhere else:** the absolute day, e.g. `Wed 30 Sep`. A time is noise
 *    under "Next 7 days" or "Later", where an event three weeks out reads the
 *    same as one tomorrow morning.
 *
 * The tone is independent of the format, so an overdue date stays destructive
 * whichever shape it takes.
 */
import { formatDayMonth, formatTime, fromDateOnly, isOverdue, relativeDayLabel, taskDay, todayIn } from '@/lib/dates';
import type { DateOnly, Task } from '@/lib/types';

export type DueTone = 'danger' | 'tint' | 'secondary';

export interface DueLabel {
  label: string;
  tone: DueTone;
  /** The floating day the label refers to. */
  day: string;
}

/** The task fields the label derives from. */
export type DueLabelTask = Pick<
  Task,
  'dueAtMs' | 'dueDate' | 'startAtMs' | 'startDate' | 'status' | 'isAllDay'
>;

/**
 * The absolute day a row outside the Today section carries: `Tue Sep 30`.
 *
 * The year is added only when it is not the current one (`Tue Sep 30 2026`),
 * so a date that crosses a new year is unambiguous without every ordinary date
 * carrying four extra digits. The spelling itself lives in `formatDayMonth`,
 * next to the rest of the date convention.
 */
export function absoluteDayLabel(day: DateOnly, zone: string): string {
  const target = fromDateOnly(day, zone);
  const today = fromDateOnly(todayIn(zone), zone);
  return formatDayMonth(target, today);
}

/**
 * "Today 17:00", "Yesterday", "Thu 22 May" — plus the colour that tells the user
 * whether it is late, due now, or simply scheduled.
 *
 * `showDate` swaps the relative label for the absolute day; the caller passes it
 * for every section except Today (see `DueDateLabel`).
 */
export function dueLabel(
  task: DueLabelTask,
  zone: string,
  timeFormat: '12h' | '24h',
  showDate = false,
): DueLabel | null {
  const day = taskDay(task, zone);
  if (!day) return null;

  const overdue = isOverdue(task, zone);
  const dueToday = !overdue && day === todayIn(zone);
  const withTime = task.dueAtMs !== null && !task.isAllDay;
  const time = withTime
    ? ` ${formatTime(task.dueAtMs as number, { zone, timeFormat, weekStartsOn: 0 })}`
    : '';

  return {
    label: showDate ? absoluteDayLabel(day, zone) : `${relativeDayLabel(day, zone)}${time}`,
    tone: overdue ? 'danger' : dueToday ? 'tint' : 'secondary',
    day,
  };
}
