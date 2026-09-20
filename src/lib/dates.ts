/**
 * Date and time helpers.
 *
 * Everything is timezone-aware through Luxon. The two representations used
 * across the app are kept strictly separate:
 *
 *   - **Instants** (`Millis`, an epoch number) for anything with a clock time.
 *   - **Floating days** (`DateOnly`, `YYYY-MM-DD`) for all-day items, which have
 *     no timezone at all and must never be shifted by one.
 *
 * Mixing the two is the single most common source of off-by-one-day calendar
 * bugs, so no function here accepts an ambiguous argument.
 */
import { DateTime, Interval, Settings } from 'luxon';
import type { DateOnly, Millis, Priority, Task } from './types';

Settings.defaultZone = 'utc';

export const DATE_FORMAT = 'yyyy-MM-dd';

/* -------------------------------------------------------------------------- */
/* conversions                                                                */
/* -------------------------------------------------------------------------- */

export function toMillis(dt: DateTime): Millis {
  return dt.toMillis();
}

/** Current instant in a named zone. */
export function nowIn(zone: string): DateTime {
  return DateTime.now().setZone(zone);
}

export function nowMs(): Millis {
  return Date.now();
}

/** The floating calendar day an instant falls on, as seen from `zone`. */
export function toDateOnly(instantMs: Millis, zone: string): DateOnly {
  return DateTime.fromMillis(instantMs, { zone }).toFormat(DATE_FORMAT);
}

/** Midnight at the start of a floating day, in `zone`. */
export function fromDateOnly(date: DateOnly, zone: string): DateTime {
  return DateTime.fromFormat(date, DATE_FORMAT, { zone }).startOf('day');
}

export function dateOnlyToMillis(date: DateOnly, zone: string): Millis {
  return fromDateOnly(date, zone).toMillis();
}

export function isValidDateOnly(value: unknown): value is DateOnly {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && DateTime.fromFormat(value, DATE_FORMAT).isValid;
}

export function isValidZone(zone: string): boolean {
  return DateTime.local().setZone(zone).isValid;
}

/** Today's floating day in `zone`. */
export function todayIn(zone: string): DateOnly {
  return nowIn(zone).toFormat(DATE_FORMAT);
}

export function addDaysToDateOnly(date: DateOnly, days: number, zone: string): DateOnly {
  return fromDateOnly(date, zone).plus({ days }).toFormat(DATE_FORMAT);
}

/**
 * Combines a floating day with a wall-clock time into an instant.
 *
 * DST-safe: Luxon resolves a non-existent local time (the spring-forward gap)
 * by advancing to the next valid instant rather than producing an invalid Date.
 */
export function combineDateAndTime(date: DateOnly, time: string | null, zone: string): Millis {
  const base = fromDateOnly(date, zone);
  if (!time) return base.toMillis();
  const [hh, mm] = time.split(':').map((n) => Number.parseInt(n, 10));
  const combined = base.set({ hour: hh || 0, minute: mm || 0, second: 0, millisecond: 0 });
  return combined.isValid ? combined.toMillis() : base.toMillis();
}

/** Splits an instant into the local `HH:mm` a user would recognise. */
export function timeIn(instantMs: Millis, zone: string): string {
  return DateTime.fromMillis(instantMs, { zone }).toFormat('HH:mm');
}

/* -------------------------------------------------------------------------- */
/* ranges                                                                     */
/* -------------------------------------------------------------------------- */

export type CalendarViewKind = 'day' | 'week' | 'month' | 'agenda' | 'year';

export interface DateRange {
  /** Inclusive start instant. */
  startMs: Millis;
  /** Exclusive end instant. */
  endMs: Millis;
  /** First floating day of the range. */
  startDate: DateOnly;
  /** Last floating day of the range, inclusive. */
  endDate: DateOnly;
  /** Every day in the range, in order. */
  days: DateOnly[];
  label: string;
}

/**
 * The visible window for a calendar view.
 *
 * Month and week views are padded out to whole weeks so the grid never has a
 * ragged edge — the padded days are still returned so the grid can grey them.
 */
export function rangeForView(
  view: CalendarViewKind,
  anchor: DateOnly,
  zone: string,
  weekStartsOn: number,
): DateRange {
  const base = fromDateOnly(anchor, zone);
  let start: DateTime;
  let end: DateTime;
  let label: string;

  switch (view) {
    case 'day':
      start = base.startOf('day');
      end = start.plus({ days: 1 });
      label = base.toFormat('cccc LLLL d');
      break;

    case 'week': {
      start = startOfWeek(base, weekStartsOn).startOf('day');
      end = start.plus({ weeks: 1 });
      const last = end.minus({ days: 1 });
      // Month first, as everywhere else: `Oct 8–14 2026`. The month is stated
      // once for a week inside one month and repeated across two, so the range
      // never reads as a bare pair of days.
      label =
        start.hasSame(last, 'month')
          ? `${start.toFormat('LLL d')}–${last.toFormat('d yyyy')}`
          : `${start.toFormat('LLL d')} – ${last.toFormat('LLL d yyyy')}`;
      break;
    }

    case 'month': {
      const firstOfMonth = base.startOf('month');
      start = startOfWeek(firstOfMonth, weekStartsOn).startOf('day');
      // Six weeks covers every possible month layout, so the grid height is
      // stable and the user's eye does not have to re-find the rows.
      end = start.plus({ weeks: 6 });
      label = base.toFormat('LLLL yyyy');
      break;
    }

    case 'year': {
      start = DateTime.fromObject({ year: base.year, month: 1, day: 1 }, { zone }).startOf('day');
      end = start.plus({ years: 1 });
      label = String(base.year);
      break;
    }

    case 'agenda':
    default:
      start = base.startOf('day');
      end = start.plus({ days: 30 });
      label = 'Next 30 days';
      break;
  }

  const days: DateOnly[] = [];
  for (let cursor = start; cursor < end; cursor = cursor.plus({ days: 1 })) {
    days.push(cursor.toFormat(DATE_FORMAT));
  }

  return {
    startMs: start.toMillis(),
    endMs: end.toMillis(),
    startDate: start.toFormat(DATE_FORMAT),
    endDate: end.minus({ days: 1 }).toFormat(DATE_FORMAT),
    days,
    label,
  };
}

/** Shifts the anchor by one view-sized step, for previous/next navigation. */
export function shiftViewAnchor(view: CalendarViewKind, anchor: DateOnly, delta: number, zone: string): DateOnly {
  const base = fromDateOnly(anchor, zone);
  switch (view) {
    case 'day':
      return base.plus({ days: delta }).toFormat(DATE_FORMAT);
    case 'week':
      return base.plus({ weeks: delta }).toFormat(DATE_FORMAT);
    case 'month':
      return base.plus({ months: delta }).startOf('month').toFormat(DATE_FORMAT);
    case 'year':
      return base.plus({ years: delta }).startOf('year').toFormat(DATE_FORMAT);
    default:
      return base.plus({ days: 30 * delta }).toFormat(DATE_FORMAT);
  }
}

export function startOfWeek(dt: DateTime, weekStartsOn: number): DateTime {
  // Luxon weekday: 1 = Monday ... 7 = Sunday.
  const luxonTarget = weekStartsOn === 0 ? 7 : weekStartsOn;
  const diff = (dt.weekday - luxonTarget + 7) % 7;
  return dt.minus({ days: diff });
}

export function startOfWeekDate(date: DateOnly, weekStartsOn: number, zone: string): DateOnly {
  return startOfWeek(fromDateOnly(date, zone), weekStartsOn).toFormat(DATE_FORMAT);
}

/** Inclusive [start, end] of the ISO-ish week containing `date`. */
export function weekBounds(date: DateOnly, weekStartsOn: number, zone: string): { start: DateOnly; end: DateOnly } {
  const start = startOfWeek(fromDateOnly(date, zone), weekStartsOn);
  return { start: start.toFormat(DATE_FORMAT), end: start.plus({ days: 6 }).toFormat(DATE_FORMAT) };
}

export function monthBounds(date: DateOnly, zone: string): { start: DateOnly; end: DateOnly } {
  const base = fromDateOnly(date, zone);
  return {
    start: base.startOf('month').toFormat(DATE_FORMAT),
    end: base.endOf('month').toFormat(DATE_FORMAT),
  };
}

/** Windows used by the smart lists. */
export function dueWindowBounds(
  window: 'overdue' | 'today' | 'tomorrow' | 'next7days' | 'next30days' | 'all' | 'noDate',
  zone: string,
): { from: DateOnly | null; to: DateOnly | null } {
  const today = nowIn(zone).startOf('day');
  switch (window) {
    case 'overdue':
      return { from: null, to: today.minus({ days: 1 }).toFormat(DATE_FORMAT) };
    case 'today':
      return { from: today.toFormat(DATE_FORMAT), to: today.toFormat(DATE_FORMAT) };
    case 'tomorrow': {
      const t = today.plus({ days: 1 }).toFormat(DATE_FORMAT);
      return { from: t, to: t };
    }
    case 'next7days':
      return { from: today.toFormat(DATE_FORMAT), to: today.plus({ days: 7 }).toFormat(DATE_FORMAT) };
    case 'next30days':
      return { from: today.toFormat(DATE_FORMAT), to: today.plus({ days: 30 }).toFormat(DATE_FORMAT) };
    case 'noDate':
      return { from: null, to: null };
    default:
      return { from: null, to: null };
  }
}

/* -------------------------------------------------------------------------- */
/* presentation                                                               */
/* -------------------------------------------------------------------------- */

export interface FormatPrefs {
  zone: string;
  timeFormat: '12h' | '24h';
  weekStartsOn: number;
}

const timePattern = (prefs: FormatPrefs) => (prefs.timeFormat === '12h' ? 'h:mm a' : 'HH:mm');

/**
 * The app's short day format: weekday, month, day — `Sat Oct 8`.
 *
 * Month-first, like the long forms below it. The whole codebase used to read
 * day-first (`8 Oct`); this is the one spelling of a day and every caller now
 * goes through a helper that emits it.
 */
export const DAY_MONTH_FORMAT = 'ccc LLL d';

/**
 * `Sat Oct 8`, with the year appended only when `dt` is not in `today`'s
 * calendar year — `Sat Oct 8 2026`.
 *
 * The year is the one thing that changes which day a bare date names, so it is
 * shown exactly when it is not the year the reader is already in. A date that
 * crosses a new year is unambiguous without every ordinary date carrying four
 * extra digits; the rule is applied in one place so no surface can disagree
 * with another about it.
 */
export function formatDayMonth(dt: DateTime, today: DateTime): string {
  return dt.year === today.year ? dt.toFormat(DAY_MONTH_FORMAT) : dt.toFormat(`${DAY_MONTH_FORMAT} yyyy`);
}

export function formatTime(instantMs: Millis, prefs: FormatPrefs): string {
  return DateTime.fromMillis(instantMs, { zone: prefs.zone }).toFormat(timePattern(prefs));
}

export function formatDateTime(instantMs: Millis, prefs: FormatPrefs, now = nowIn(prefs.zone)): string {
  const dt = DateTime.fromMillis(instantMs, { zone: prefs.zone });
  return `${formatDayMonth(dt, now)} ${dt.toFormat(timePattern(prefs))}`;
}

/**
 * The deliberately long form — `Saturday October 8 2026`.
 *
 * Month-first like everything else, but the weekday and month are spelled out
 * and the year is kept: this is the label a screen reader announces for a
 * selected day, where the full name is the point and the year is part of it.
 * Not run through `formatDayMonth`, so it is never shortened to `Sat Oct 8`.
 */
export function formatFullDate(instantMs: Millis, prefs: FormatPrefs): string {
  return DateTime.fromMillis(instantMs, { zone: prefs.zone }).toFormat('cccc LLLL d yyyy');
}

/**
 * The human label TickTick shows next to a task: "Today", "Tomorrow",
 * "Yesterday", a weekday inside the coming week, otherwise an absolute date.
 */
export function relativeDayLabel(date: DateOnly, zone: string, now = nowIn(zone)): string {
  const target = fromDateOnly(date, zone);
  const today = now.startOf('day');
  const diffDays = Math.round(target.diff(today, 'days').days);

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Tomorrow';
  if (diffDays === -1) return 'Yesterday';
  if (diffDays > 1 && diffDays < 7) return target.toFormat('cccc');
  if (diffDays === 7) return 'Next ' + target.toFormat('cccc');
  if (diffDays < -1 && diffDays > -7) return `Last ${target.toFormat('cccc')}`;
  return formatDayMonth(target, today);
}

/** The instant a task should be sorted and displayed by. */
export function taskSortInstant(task: Pick<Task, 'dueAtMs' | 'dueDate' | 'startAtMs' | 'startDate'>, zone: string): Millis | null {
  if (task.dueAtMs) return task.dueAtMs;
  if (task.dueDate) return dateOnlyToMillis(task.dueDate, zone);
  if (task.startAtMs) return task.startAtMs;
  if (task.startDate) return dateOnlyToMillis(task.startDate, zone);
  return null;
}

/** The floating day a task sits on, used for grouping into day sections. */
export function taskDay(
  task: Pick<Task, 'dueAtMs' | 'dueDate' | 'startAtMs' | 'startDate'>,
  zone: string,
): DateOnly | null {
  if (task.dueDate) return task.dueDate;
  if (task.dueAtMs) return toDateOnly(task.dueAtMs, zone);
  if (task.startDate) return task.startDate;
  if (task.startAtMs) return toDateOnly(task.startAtMs, zone);
  return null;
}

export function isOverdue(
  task: Pick<Task, 'dueAtMs' | 'dueDate' | 'status' | 'isAllDay'>,
  zone: string,
  now = nowIn(zone),
): boolean {
  if (task.status === 'completed' || task.status === 'wont_do') return false;
  if (task.dueAtMs) return task.dueAtMs < now.toMillis();
  if (task.dueDate) return fromDateOnly(task.dueDate, zone) < now.startOf('day');
  return false;
}

export function isToday(
  task: Pick<Task, 'dueAtMs' | 'dueDate' | 'startAtMs' | 'startDate'>,
  zone: string,
  now = nowIn(zone),
): boolean {
  const day = taskDay(task, zone);
  return day === now.toFormat(DATE_FORMAT);
}

/** Overlap test used by the calendar's day/week column layout. */
export function overlaps(aStart: Millis, aEnd: Millis, bStart: Millis, bEnd: Millis): boolean {
  return aStart < bEnd && bStart < aEnd;
}

export function minutesBetween(startMs: Millis, endMs: Millis): number {
  return Math.round((endMs - startMs) / 60_000);
}

export function clampToDay(instantMs: Millis, date: DateOnly, zone: string): Millis {
  const dayStart = fromDateOnly(date, zone);
  const dayEnd = dayStart.plus({ days: 1 });
  if (instantMs < dayStart.toMillis()) return dayStart.toMillis();
  if (instantMs > dayEnd.toMillis()) return dayEnd.toMillis();
  return instantMs;
}

/** Duration as a compact human string: `1h 30m`, `45m`, `2h`. */
export function humanDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

/** Seconds as `MM:SS`, used by the focus timer. */
export function formatClock(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** Combines a floating day and an exclusive end into an instant pair for the grid. */
export function allDayBounds(startDate: DateOnly, endDate: DateOnly | null, zone: string): { startMs: Millis; endMs: Millis } {
  const start = fromDateOnly(startDate, zone);
  // RFC 5545 DTEND for a DATE-valued event is exclusive; we store it that way
  // and normalise for display so a one-day event spans exactly one day.
  const end = endDate ? fromDateOnly(endDate, zone) : start.plus({ days: 1 });
  return { startMs: start.toMillis(), endMs: Math.max(end.toMillis(), start.plus({ days: 1 }).toMillis()) };
}

export function eachDayInclusive(startDate: DateOnly, endDate: DateOnly, zone: string): DateOnly[] {
  const out: DateOnly[] = [];
  const start = fromDateOnly(startDate, zone);
  const end = fromDateOnly(endDate, zone);
  const interval = Interval.fromDateTimes(start, end.plus({ days: 1 }));
  for (const day of interval.splitBy({ days: 1 })) {
    out.push(day.start!.toFormat(DATE_FORMAT));
  }
  return out;
}

export const PRIORITY_ORDER: Record<Priority, number> = { high: 0, medium: 1, low: 2, none: 3 };

/** Numeric weight used by the Eisenhower matrix and the sort comparators. */
export function priorityWeight(priority: Priority): number {
  switch (priority) {
    case 'high':
      return 3;
    case 'medium':
      return 2;
    case 'low':
      return 1;
    default:
      return 0;
  }
}

export function relativeTimeAgo(instantMs: Millis, nowMsValue = Date.now()): string {
  const diff = Math.round((nowMsValue - instantMs) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86_400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604_800) return `${Math.floor(diff / 86_400)}d ago`;
  return formatDayMonth(DateTime.fromMillis(instantMs), DateTime.fromMillis(nowMsValue));
}
