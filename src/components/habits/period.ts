/**
 * Habit presentation helpers.
 *
 * Everything here is a pure read of what the server already computed. The one
 * rule this module obeys without exception: **it never re-derives a streak, a
 * completion rate or a period total.** Those arrive on the `Habit` payload
 * (`streak`, `longestStreak`, `completionRate`, `progress`, `doneToday`) and are
 * formatted here, never recalculated — a second definition of "streak" in the
 * client would drift from the server's within one release.
 *
 * The single thing that *is* mirrored is the schedule (`isHabitDueOn`), because
 * marking which weekdays a habit is expected on is presentation, not scoring.
 */
import {
  addDaysToDateOnly,
  formatTime,
  monthBounds,
  startOfWeekDate,
  weekBounds,
  type FormatPrefs,
} from '@/lib/dates';
import { weekdayOfDate } from '@/lib/rrule';
import type { DateOnly, Habit, HabitFrequency } from '@/lib/types';

const ZONE = 'utc';

/* -------------------------------------------------------------------------- */
/* windows                                                                    */
/* -------------------------------------------------------------------------- */

export type HabitWindow = 'week' | 'month' | 'year';

export const HABIT_WINDOWS: readonly { value: HabitWindow; label: string }[] = [
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: 'year', label: 'Year' },
];

export interface HabitWindowRange {
  from: DateOnly;
  to: DateOnly;
  label: string;
}

/**
 * The `from`/`to` query parameters for a window, always ending today so the
 * current period is included.
 */
export function habitWindowRange(window: HabitWindow, today: DateOnly, weekStartsOn: number): HabitWindowRange {
  switch (window) {
    case 'week':
      return { from: weekBounds(today, weekStartsOn, ZONE).start, to: today, label: 'This week' };
    case 'month': {
      const bounds = monthBounds(today, ZONE);
      const month = monthName(today);
      return { from: bounds.start, to: today, label: `${month} to date` };
    }
    case 'year':
    default:
      return { from: `${today.slice(0, 4)}-01-01`, to: today, label: `${today.slice(0, 4)} to date` };
  }
}

function monthName(date: DateOnly): string {
  const names = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ];
  const index = Number.parseInt(date.slice(5, 7), 10) - 1;
  return names[index] ?? date.slice(0, 7);
}

/* -------------------------------------------------------------------------- */
/* schedule presentation                                                      */
/* -------------------------------------------------------------------------- */

export const WEEKDAY_INITIALS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'] as const;
export const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

/**
 * Whether the habit is expected on `date`.
 *
 * Mirrors the server's `isScheduledOn` (src/server/repos/habits.ts) for the
 * strip and the day picker. It is used to *emphasise* scheduled days, never to
 * score them.
 */
export function isHabitDueOn(
  habit: Pick<Habit, 'frequency' | 'weekDays' | 'startDate'>,
  date: DateOnly,
): boolean {
  if (date < habit.startDate) return false;
  if (habit.frequency !== 'custom') return true;
  const days = habit.weekDays?.length ? habit.weekDays : [0, 1, 2, 3, 4, 5, 6];
  return days.includes(weekdayOfDate(date));
}

export interface WeekStripDay {
  date: DateOnly;
  /** Row position in the user's week. */
  index: number;
  weekday: number;
  initial: string;
  /** Expected per the schedule. */
  due: boolean;
  /** Amount the server has stored for that day. */
  logged: number;
  isToday: boolean;
}

/** The seven days of the week containing `today`, in the user's week order. */
export function weekStripDays(
  habit: Pick<Habit, 'frequency' | 'weekDays' | 'startDate' | 'entries'>,
  today: DateOnly,
  weekStartsOn: number,
): WeekStripDay[] {
  const start = startOfWeekDate(today, weekStartsOn, ZONE);
  return Array.from({ length: 7 }, (_, index) => {
    const date = addDaysToDateOnly(start, index, ZONE);
    const weekday = weekdayOfDate(date);
    return {
      date,
      index,
      weekday,
      initial: WEEKDAY_INITIALS[weekday],
      due: isHabitDueOn(habit, date),
      logged: habit.entries?.[date] ?? 0,
      isToday: date === today,
    };
  });
}

/** Human description of the schedule, e.g. `Mon, Wed, Fri` or `3× per week`. */
export function frequencySummary(
  habit: Pick<Habit, 'frequency' | 'weekDays' | 'timesPerPeriod'>,
): string {
  switch (habit.frequency) {
    case 'daily':
      return 'Every day';
    case 'weekly':
      return `${habit.timesPerPeriod || 1}× per week`;
    case 'monthly':
      return `${habit.timesPerPeriod || 1}× per month`;
    case 'custom': {
      const days = habit.weekDays?.length ? [...habit.weekDays].sort((a, b) => a - b) : [];
      if (days.length === 0) return 'Custom';
      if (days.length === 7) return 'Every day';
      const order = [1, 2, 3, 4, 5, 6, 0];
      return order
        .filter((day) => days.includes(day))
        .map((day) => WEEKDAY_SHORT[day])
        .join(', ');
    }
    default:
      return 'Every day';
  }
}

/** The goal in words, e.g. `8 glasses a day`, `30 min a day`, `Once a day`. */
export function goalSummary(habit: Pick<Habit, 'goalType' | 'goalTarget' | 'unit' | 'frequency'>): string {
  if (habit.goalType === 'boolean') return 'Once a day';
  const unit = habit.unit ?? (habit.goalType === 'duration' ? 'min' : '');
  const target = Math.max(1, habit.goalTarget);
  const amount = `${target}${unit ? ` ${unit}` : ''}`;
  return habit.frequency === 'weekly'
    ? `${amount} a week`
    : habit.frequency === 'monthly'
      ? `${amount} a month`
      : `${amount} a day`;
}

/* -------------------------------------------------------------------------- */
/* the current period                                                         */
/* -------------------------------------------------------------------------- */

export interface HabitProgressView {
  /** True for `count` / `duration` habits, which have a numeric target. */
  counted: boolean;
  /** Amount logged in the current period. */
  logged: number;
  /** Amount required for the period to count. */
  target: number;
  unit: string | null;
  /** `0..1`, straight from the server's `progress`. */
  fraction: number;
  /** Short label for the check-in control, e.g. `3/8 glasses`. */
  label: string;
  /** What the period is, so the UI can say "3 of 8 this week". */
  periodNoun: 'today' | 'this week' | 'this month';
}

/**
 * The current period, as the server sees it.
 *
 * For a daily habit this is literally the day's entry from the `entries` map,
 * which is what makes `3/8 glasses` exact. For a weekly or monthly habit the
 * period spans several days and only the server can aggregate it, so the raw
 * amount is presented back from `progress` rather than summed here.
 */
export function habitProgressView(habit: Habit, today: DateOnly): HabitProgressView {
  const counted = habit.goalType !== 'boolean';
  const periodic = habit.frequency === 'weekly' || habit.frequency === 'monthly';
  const target = periodic
    ? Math.max(1, habit.timesPerPeriod || habit.goalTarget || 1)
    : Math.max(1, habit.goalTarget || 1);
  const fraction = clamp01(habit.progress ?? (habit.doneToday ? 1 : 0));
  const unit = habit.goalType === 'duration' ? habit.unit ?? 'min' : habit.unit;

  const logged = counted
    ? periodic
      ? Math.round(fraction * target)
      : habit.entries?.[today] ?? 0
    : habit.doneToday
      ? 1
      : 0;

  const label = counted
    ? `${logged}/${target}${unit ? ` ${unit}` : ''}`
    : habit.doneToday
      ? 'Done'
      : 'Not yet';

  return {
    counted,
    logged,
    target,
    unit,
    fraction,
    label,
    periodNoun: periodic ? (habit.frequency === 'weekly' ? 'this week' : 'this month') : 'today',
  };
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/** `day` / `week` / `month`, for the streak badge. */
export function streakUnit(frequency: HabitFrequency): string {
  if (frequency === 'weekly') return 'week';
  if (frequency === 'monthly') return 'month';
  return 'day';
}

/** Accessible name for the streak badge, e.g. `5 day streak`. */
export function streakLabel(streak: number, frequency: HabitFrequency): string {
  const unit = streakUnit(frequency);
  if (streak <= 0) return 'No streak yet';
  return `${streak} ${unit}${streak === 1 ? '' : 's'} streak`;
}

/** Compact ratio label, e.g. `5/8`. */
export function progressCountLabel(view: HabitProgressView): string {
  return `${view.logged}/${view.target}`;
}

/** `72% this month`, or `No completions yet`. */
export function completionLabel(rate: number | undefined, windowLabel: string): string {
  if (rate === undefined || rate === null || !Number.isFinite(rate)) return `No data for ${windowLabel.toLowerCase()}`;
  const percent = Math.round(clamp01(rate) * 100);
  if (percent === 0) return `Nothing completed ${windowLabel.toLowerCase()}`;
  return `${percent}% completed ${windowLabel.toLowerCase()}`;
}

/** The reminder as a clock time in the user's format, or `null` when unset. */
export function reminderLabel(
  habit: Pick<Habit, 'reminderAtMs'>,
  prefs: FormatPrefs,
): string | null {
  if (!habit.reminderAtMs) return null;
  return formatTime(habit.reminderAtMs, prefs);
}

/* -------------------------------------------------------------------------- */
/* optimistic check-in                                                        */
/* -------------------------------------------------------------------------- */

export interface CheckInChange {
  date: DateOnly;
  /** Replaces the entry. `null` clears it. */
  count?: number | null;
  /** Increments the existing entry. */
  delta?: number;
}

/**
 * The local patch applied to a habit the moment a check-in is sent.
 *
 * Deliberately conservative: it touches only the `entries` map — the same
 * `date -> number` values the endpoint returns — plus `doneToday` for a boolean
 * habit, where "an entry exists" and "the goal is met" are the same statement.
 * Everything the server derives (streak, completion rate, `progress` for a
 * multi-day period) is left alone and corrected by the refresh that follows.
 */
export function applyCheckInOptimistically(habit: Habit, change: CheckInChange): Habit {
  const entries: Record<DateOnly, number> = { ...(habit.entries ?? {}) };
  const previous = entries[change.date] ?? 0;

  let next = previous;
  if (change.delta !== undefined) next = Math.max(0, previous + change.delta);
  else if (change.count !== undefined && change.count !== null) next = Math.max(0, change.count);
  else next = 0;

  if (next > 0) entries[change.date] = next;
  else delete entries[change.date];

  const patch: Habit = { ...habit, entries };
  if (habit.goalType === 'boolean') {
    patch.doneToday = next > 0;
    patch.progress = next > 0 ? 1 : 0;
  }
  return patch;
}

/** Short phrase for the toast that follows a check-in. */
export function checkInChangeLabel(habit: Habit, change: CheckInChange): string {
  if (habit.goalType === 'boolean') {
    const done = change.count !== undefined && change.count !== null ? change.count > 0 : (change.delta ?? 0) > 0;
    return done ? `${habit.name} done for today` : `${habit.name} unchecked`;
  }
  if (change.delta !== undefined) {
    return change.delta >= 0 ? `${habit.name} +${change.delta}` : `${habit.name} ${change.delta}`;
  }
  return `${habit.name} set to ${change.count ?? 0}`;
}
