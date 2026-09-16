/**
 * Floating-day string maths for `DateField` — pure, and deliberately free of
 * any timezone involvement.
 *
 * A `DateOnly` is `YYYY-MM-DD` with no zone attached. Every function here works
 * on that string: parsing splits characters, formatting pads them, and calendar
 * arithmetic goes through `Date.UTC`, which is used purely as a Gregorian
 * calendar calculator (`getUTC*`/`setUTC*` never convert between zones). The
 * value that goes in therefore comes out byte-identical, on any device, in any
 * timezone — which is exactly what an all-day item needs.
 */
import type { DateOnly } from '@/lib/types';

const ISO_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
const MONTH_LONG = [
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
] as const;

export interface DateParts {
  year: number;
  /** 1-based month, unlike `Date#getUTCMonth`. */
  month: number;
  /** 1-based day of month. */
  day: number;
}

function pad(value: number, length = 2): string {
  return String(value).padStart(length, '0');
}

/** Number of days in a 1-based month. `daysInMonth(2024, 2) === 29`. */
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Parses `YYYY-MM-DD` strictly. Returns `null` for anything else, including
 * well-formed strings that are not real days (`2025-02-30`).
 */
export function parseDateOnly(value: string | null | undefined): DateParts | null {
  if (!value) return null;
  const match = ISO_PATTERN.exec(value);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > daysInMonth(year, month)) return null;

  return { year, month, day };
}

/** Type guard mirroring `src/lib/dates.ts#isValidDateOnly`, without Luxon. */
export function isValidDateOnly(value: unknown): value is DateOnly {
  return typeof value === 'string' && parseDateOnly(value) !== null;
}

/** Formats date parts as `YYYY-MM-DD`. Does not validate. */
export function formatDateOnly(parts: DateParts): DateOnly {
  return `${pad(parts.year, 4)}-${pad(parts.month)}-${pad(parts.day)}`;
}

/** Round-trips a string through parse+format, returning `null` when invalid. */
export function normaliseDateOnly(value: string | null | undefined): DateOnly | null {
  const parts = parseDateOnly(value);
  return parts ? formatDateOnly(parts) : null;
}

function toUtc(date: DateOnly): Date {
  const parts = parseDateOnly(date);
  if (!parts) throw new RangeError(`Not a YYYY-MM-DD date: ${String(date)}`);
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
}

function fromUtc(date: Date): DateOnly {
  return formatDateOnly({
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  });
}

/** Shifts a day string by whole days. Handles month, year and leap-day edges. */
export function addDays(date: DateOnly, days: number): DateOnly {
  const utc = toUtc(date);
  utc.setUTCDate(utc.getUTCDate() + days);
  return fromUtc(utc);
}

/** Whole days from `from` to `to` (`to - from`); negative when `to` is earlier. */
export function diffDays(from: DateOnly, to: DateOnly): number {
  return Math.round((toUtc(to).getTime() - toUtc(from).getTime()) / 86_400_000);
}

/** 0 = Sunday … 6 = Saturday. */
export function weekdayIndex(date: DateOnly): number {
  return toUtc(date).getUTCDay();
}

/** ISO strings sort lexicographically, which is the whole point of the format. */
export function compareDateOnly(a: DateOnly, b: DateOnly): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/** Keeps `date` inside an optional `[min, max]` window. */
export function clampDateOnly(date: DateOnly, min?: DateOnly | null, max?: DateOnly | null): DateOnly {
  if (min && compareDateOnly(date, min) < 0) return min;
  if (max && compareDateOnly(date, max) > 0) return max;
  return date;
}

/** Steps a year/month pair, normalising the wrap around December/January. */
export function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const zeroBased = year * 12 + (month - 1) + delta;
  return { year: Math.floor(zeroBased / 12), month: (((zeroBased % 12) + 12) % 12) + 1 };
}

/** Moves to another month, keeping the day of month where the target allows it. */
export function shiftMonthKeepDay(date: DateOnly, delta: number): DateOnly {
  const parts = parseDateOnly(date);
  if (!parts) return date;
  const next = shiftMonth(parts.year, parts.month, delta);
  return formatDateOnly({ ...next, day: Math.min(parts.day, daysInMonth(next.year, next.month)) });
}

export interface DateCell {
  date: DateOnly;
  /** False for the leading/trailing days that only exist to square off the grid. */
  inMonth: boolean;
}

/**
 * The 42-cell (six-week) grid for a month. Six weeks always, so the grid never
 * changes height as the user pages through months and the rows do not jump.
 */
export function monthGrid(year: number, month: number, weekStartsOn = 1): DateCell[] {
  const first = formatDateOnly({ year, month, day: 1 });
  const lead = (weekdayIndex(first) - weekStartsOn + 7) % 7;
  const start = addDays(first, -lead);

  return Array.from({ length: 42 }, (_, index) => {
    const date = addDays(start, index);
    const parts = parseDateOnly(date);
    return { date, inMonth: parts?.year === year && parts.month === month };
  });
}

/** Today as a floating day, read off the device's *local* calendar. */
export function todayDateOnly(now: Date = new Date()): DateOnly {
  return formatDateOnly({ year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() });
}

/** Month heading, e.g. `"September 2025"`. */
export function formatMonthLabel(year: number, month: number): string {
  return `${MONTH_LONG[month - 1] ?? ''} ${year}`.trim();
}

/** Full label used on the field and on each day button, e.g. `"Wed 24 Sep 2025"`. */
export function formatDateLong(date: DateOnly): string {
  const parts = parseDateOnly(date);
  if (!parts) return date;
  return `${WEEKDAY_SHORT[weekdayIndex(date)]} ${parts.day} ${MONTH_SHORT[parts.month - 1]} ${parts.year}`;
}

export type DateQuickChoice = 'today' | 'tomorrow' | 'next_week';

export interface DateQuickOption {
  choice: DateQuickChoice;
  label: string;
  date: DateOnly;
}

/** The three shortcuts iOS offers above the calendar. */
export function quickDateOptions(today: DateOnly): DateQuickOption[] {
  return [
    { choice: 'today', label: 'Today', date: today },
    { choice: 'tomorrow', label: 'Tomorrow', date: addDays(today, 1) },
    { choice: 'next_week', label: 'Next week', date: addDays(today, 7) },
  ];
}

export type GridMoveKey =
  | 'ArrowLeft'
  | 'ArrowRight'
  | 'ArrowUp'
  | 'ArrowDown'
  | 'Home'
  | 'End'
  | 'PageUp'
  | 'PageDown';

/**
 * Where the grid's roving focus lands for a key press. Mirrors what
 * `NSDatePicker` does: arrows move a day/week, Home/End jump to the ends of the
 * week, PageUp/PageDown change month.
 */
export function moveGridFocus(date: DateOnly, key: GridMoveKey, weekStartsOn = 1): DateOnly {
  const lead = (weekdayIndex(date) - weekStartsOn + 7) % 7;
  switch (key) {
    case 'ArrowLeft':
      return addDays(date, -1);
    case 'ArrowRight':
      return addDays(date, 1);
    case 'ArrowUp':
      return addDays(date, -7);
    case 'ArrowDown':
      return addDays(date, 7);
    case 'Home':
      return addDays(date, -lead);
    case 'End':
      return addDays(date, 6 - lead);
    case 'PageUp':
      return shiftMonthKeepDay(date, -1);
    case 'PageDown':
      return shiftMonthKeepDay(date, 1);
    default:
      return date;
  }
}
