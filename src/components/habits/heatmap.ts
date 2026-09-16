/**
 * Heatmap geometry, intensity and labels.
 *
 * Pure and DOM-free: the grid is a plain data structure so the layout rules
 * (which cell lands in which column, where a month label goes) can be tested
 * without jsdom. The component only turns the result into divs.
 *
 * Floating days (`YYYY-MM-DD`) are used throughout — never instants — because a
 * heatmap is a calendar artifact. `lib/dates` pins Luxon to UTC, so all the
 * arithmetic here is exact.
 */
import { DateTime } from 'luxon';
import { addDaysToDateOnly, startOfWeekDate } from '@/lib/dates';
import { weekdayOfDate } from '@/lib/rrule';
import type { DateOnly, Habit } from '@/lib/types';

const ZONE = 'utc';

/** The trailing window a habit heatmap shows: a full year, GitHub-style. */
export const HEATMAP_DAYS = 365;

/** Discrete intensity steps a cell can take. */
export const HEATMAP_LEVELS = 4;

const MONTH_SHORT = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

/** Indexed by `Date.getUTCDay()`: 0 = Sunday. */
const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

/**
 * Rows that get a weekday label. GitHub labels the 2nd, 4th and 6th row rather
 * than all seven, which keeps the gutter narrow without losing orientation.
 */
export const HEATMAP_LABELLED_ROWS: readonly number[] = [1, 3, 5];

export interface HeatmapWindow {
  from: DateOnly;
  to: DateOnly;
}

/** The trailing 12 months ending on `today`, inclusive. */
export function heatmapWindow(today: DateOnly, days: number = HEATMAP_DAYS): HeatmapWindow {
  return { from: addDaysToDateOnly(today, -(days - 1), ZONE), to: today };
}

export interface HeatmapCell {
  date: DateOnly;
  /** Column, 0-based. */
  weekIndex: number;
  /** Row, 0-based, in the rotated (week-start aware) order. */
  row: number;
  /** `Date.getUTCDay()` of the date, 0 = Sunday. */
  weekday: number;
  /** Raw entry for the day, or `null` when nothing was logged. */
  count: number | null;
  /** `0..HEATMAP_LEVELS`. 0 is an empty cell. */
  level: number;
}

export interface HeatmapMonthLabel {
  /** Short month name, e.g. `Mar`. */
  label: string;
  /** Column the label sits above. */
  weekIndex: number;
}

export interface HeatmapRow {
  /** `Date.getUTCDay()` value for this row. */
  weekday: number;
  label: string;
}

export interface HeatmapGrid {
  /** `weeks.length * 7` slots; `null` marks a day outside `[from, to]`. */
  weeks: (HeatmapCell | null)[][];
  /** One label per month that the window touches, positioned at its first week. */
  months: HeatmapMonthLabel[];
  /** The seven rows in display order, starting at the user's first weekday. */
  rows: HeatmapRow[];
  /** Row indices that carry a visible weekday label. */
  labelledRows: readonly number[];
  from: DateOnly;
  to: DateOnly;
  today: DateOnly;
}

/** How many of `levels` a logged amount fills, relative to the habit's goal. */
export function intensityLevel(count: number | null | undefined, target: number, levels: number = HEATMAP_LEVELS): number {
  if (count === null || count === undefined || !Number.isFinite(count) || count <= 0) return 0;
  // A boolean habit (or a combined count with no meaningful target) is either
  // logged or not, so any entry fills the cell completely.
  if (!Number.isFinite(target) || target <= 0) return levels;
  const ratio = Math.min(1, count / target);
  return Math.min(levels, Math.max(1, Math.ceil(ratio * levels)));
}

/** `12 March 2025` — the leading half of every cell's accessible name. */
export function heatmapDateLabel(date: DateOnly): string {
  const parsed = DateTime.fromFormat(date, 'yyyy-MM-dd');
  return parsed.isValid ? parsed.toFormat('d LLLL yyyy') : date;
}

export interface HeatmapCellLabelOptions {
  /** Amount that counts as a full cell. Omit for a boolean-style habit. */
  target?: number;
  /** Unit shown after the numbers, e.g. `glasses`. */
  unit?: string | null;
  /** Plural noun for a combined grid, e.g. `habits`. Switches to "N habits". */
  noun?: string | null;
}

/**
 * The accessible name of one cell, e.g. `12 March 2025, 3 of 8 glasses`.
 *
 * A screen reader cannot see the colour ramp, so the label has to carry both
 * the date and the amount that the shade encodes.
 */
export function heatmapCellLabel(
  date: DateOnly,
  count: number | null | undefined,
  options: HeatmapCellLabelOptions = {},
): string {
  const day = heatmapDateLabel(date);
  const amount = count ?? 0;

  if (options.noun) {
    if (amount <= 0) return `${day}, no ${options.noun}`;
    return `${day}, ${amount} ${options.noun}`;
  }

  if (amount > 0) {
    const target = options.target ?? 0;
    if (target > 1) {
      const unit = options.unit ? ` ${options.unit}` : '';
      return `${day}, ${amount} of ${target}${unit}`;
    }
    return `${day}, done`;
  }

  return `${day}, not logged`;
}

/** Short caption for the window, e.g. `Apr 2024 – Apr 2025`. */
export function heatmapRangeLabel(from: DateOnly, to: DateOnly): string {
  const start = DateTime.fromFormat(from, 'yyyy-MM-dd');
  const end = DateTime.fromFormat(to, 'yyyy-MM-dd');
  if (!start.isValid || !end.isValid) return `${from} – ${to}`;
  if (start.year === end.year) return `${start.toFormat('LLL')} – ${end.toFormat('LLL yyyy')}`;
  return `${start.toFormat('LLL yyyy')} – ${end.toFormat('LLL yyyy')}`;
}

export interface BuildHeatmapGridOptions {
  from: DateOnly;
  to: DateOnly;
  today: DateOnly;
  /** First day of the week, 0 = Sunday. */
  weekStartsOn: number;
  /** `date -> count` as returned by the API. */
  entries?: Record<DateOnly, number> | null;
  /** Amount that counts as a full cell. */
  target?: number;
  levels?: number;
}

/**
 * Lays out the grid: whole weeks from the start of the week containing `from`
 * through the week containing `to`.
 *
 * The first column is padded with `null` when the window starts mid-week, which
 * is what keeps every row aligned with its weekday for any `weekStartsOn`.
 */
export function buildHeatmapGrid(options: BuildHeatmapGridOptions): HeatmapGrid {
  const { from, to, today, weekStartsOn, entries, target = 0 } = options;
  const levels = options.levels ?? HEATMAP_LEVELS;
  const firstWeekStart = startOfWeekDate(from, weekStartsOn, ZONE);

  const weeks: (HeatmapCell | null)[][] = [];
  let weekIndex = 0;

  for (let cursor = firstWeekStart; cursor <= to; cursor = addDaysToDateOnly(cursor, 7, ZONE), weekIndex += 1) {
    const week: (HeatmapCell | null)[] = [];
    for (let row = 0; row < 7; row += 1) {
      const date = addDaysToDateOnly(cursor, row, ZONE);
      if (date < from || date > to) {
        week.push(null);
        continue;
      }
      const raw = entries?.[date];
      const count = typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? raw : null;
      week.push({
        date,
        weekIndex,
        row,
        weekday: weekdayOfDate(date),
        count,
        level: intensityLevel(count, target, levels),
      });
    }
    weeks.push(week);
  }

  // A month is labelled on the week where it *starts*, so the label always sits
  // above the first column that belongs to that month. A week can straddle two
  // months (27 Jan – 2 Feb), and then it is the month that begins inside it that
  // gets the label. The very first week also carries its own month, otherwise a
  // window opening mid-month would show no label until the next month begins.
  const months: HeatmapMonthLabel[] = [];
  let labelledMonth: string | null = null;

  for (const week of weeks) {
    const first = week.find((cell): cell is HeatmapCell => cell !== null);
    if (!first) continue;
    const startingCell = week.find((cell) => cell !== null && cell.date.endsWith('-01'));
    if (!startingCell && labelledMonth !== null) continue;

    const cell = startingCell ?? first;
    const monthKey = cell.date.slice(0, 7);
    if (monthKey === labelledMonth) continue;

    months.push({ label: MONTH_SHORT[Number.parseInt(monthKey.slice(5, 7), 10) - 1] ?? monthKey, weekIndex: cell.weekIndex });
    labelledMonth = monthKey;
  }

  const rows: HeatmapRow[] = Array.from({ length: 7 }, (_, row) => {
    const weekday = (weekStartsOn + row) % 7;
    return { weekday, label: WEEKDAY_SHORT[weekday] };
  });

  return { weeks, months, rows, labelledRows: HEATMAP_LABELLED_ROWS, from, to, today };
}

export interface CombinedEntries {
  /** `date -> number of habits checked in that day`. */
  entries: Record<DateOnly, number>;
  /** The busiest day in the window, used as the intensity ceiling. */
  max: number;
}

/**
 * Collapses several habits into one "how many habits did I keep that day" series
 * for the combined heatmap. This is a plain count of the server-provided entry
 * maps — no streak or completion maths is re-derived here.
 */
export function combineHabitEntries(habits: readonly Habit[]): CombinedEntries {
  const entries: Record<DateOnly, number> = {};
  let max = 0;

  for (const habit of habits) {
    if (!habit.entries) continue;
    for (const [date, count] of Object.entries(habit.entries)) {
      if (!(count > 0)) continue;
      const next = (entries[date] ?? 0) + 1;
      entries[date] = next;
      if (next > max) max = next;
    }
  }

  return { entries, max };
}

/** Habits that logged something on `date`, for the combined cell's detail view. */
export function habitsCheckedOn(habits: readonly Habit[], date: DateOnly): Habit[] {
  return habits.filter((habit) => (habit.entries?.[date] ?? 0) > 0);
}
