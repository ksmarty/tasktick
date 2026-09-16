/**
 * Pure geometry for the calendar views.
 *
 * Plain functions over numbers and dates — no React, no store, no fetch — so the
 * fiddly arithmetic (an hour is N pixels, a drag snaps to the quarter hour, a
 * month is six rows of seven) can be tested without a DOM. See
 * `tests/calendar-geometry.test.ts`, `tests/calendar-drag.test.ts` and
 * `tests/calendar-month-grid.test.ts`.
 *
 * Two rules this module exists to enforce:
 *
 *   · Instant <-> pixel conversion happens here and nowhere else, so the gutter,
 *     the blocks and the drag ghost can never disagree about where 09:00 is.
 *   · The month grid is *chunked*, never rebuilt. The server has already padded
 *     `days` out to whole weeks (see `rangeForView`); that list is the single
 *     source of truth for which days exist, so this module only slices it.
 *
 * Recurrence expansion, occurrence generation and timed-overlap columns are
 * deliberately absent: the server owns all three and sends the results.
 */
import { timeIn, toDateOnly } from '@/lib/dates';
import type { CalendarItem, DateOnly, Millis, TimeOnly } from '@/lib/types';

/* -------------------------------------------------------------------------- */
/* constants                                                                  */
/* -------------------------------------------------------------------------- */

export const MINUTES_PER_HOUR = 60;
export const MINUTES_PER_DAY = 24 * MINUTES_PER_HOUR;
export const HOURS_PER_DAY = 24;

/** Time-grid row heights, in px. Taller on a roomy viewport, iOS-like on a phone. */
export const DEFAULT_HOUR_HEIGHT = 56;
export const DESKTOP_HOUR_HEIGHT = 68;

/** Rescheduling granularity. */
export const SNAP_MINUTES = 15;

/** A 15-minute block is still tappable at this height. */
export const MIN_BLOCK_PX = 22;

/** Apple's minimum comfortable touch target. */
export const MIN_TOUCH_TARGET_PX = 44;

/** Six whole weeks is the tallest a month can be, so the grid never jumps. */
export const MONTH_ROWS = 6;
export const MONTH_COLUMNS = 7;

/** Hold this long to lift a block (and to create one from an empty slot). */
export const LONG_PRESS_MS = 250;

/** A finger that travels further than this is scrolling, not pressing. */
export const PRESS_SLOP_PX = 8;

/** Pointer travel (px) after which a mouse drag lifts a block straight away. */
export const MOUSE_DRAG_SLOP_PX = 4;

/** Horizontal pointer travel (px) that pages to the previous/next period. */
export const SWIPE_PAGE_PX = 60;

/* -------------------------------------------------------------------------- */
/* minutes <-> pixels                                                          */
/* -------------------------------------------------------------------------- */

export function minutesToPixels(minutes: number, hourHeight: number = DEFAULT_HOUR_HEIGHT): number {
  return (minutes / MINUTES_PER_HOUR) * hourHeight;
}

export function pixelsToMinutes(pixels: number, hourHeight: number = DEFAULT_HOUR_HEIGHT): number {
  if (hourHeight <= 0) return 0;
  return (pixels / hourHeight) * MINUTES_PER_HOUR;
}

export function snapMinutes(minutes: number, step: number = SNAP_MINUTES): number {
  if (step <= 0) return Math.round(minutes);
  return Math.round(minutes / step) * step;
}

/** The snapped minute-of-day a vertical offset from the grid's top represents. */
export function pixelsToSnappedMinutes(
  pixels: number,
  hourHeight: number = DEFAULT_HOUR_HEIGHT,
  step: number = SNAP_MINUTES,
): number {
  return snapMinutes(pixelsToMinutes(pixels, hourHeight), step);
}

export function clamp(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.min(Math.max(value, min), max);
}

export function clampMinutes(minutes: number, min = 0, max = MINUTES_PER_DAY): number {
  return clamp(minutes, min, max);
}

/* -------------------------------------------------------------------------- */
/* instants <-> minute of day                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Minute-of-day for an instant, read in the user's zone.
 *
 * Routed through `lib/dates` rather than doing its own timezone maths, so the
 * DST and week-start rules stay in exactly one place.
 */
export function minuteOfDay(instantMs: Millis, zone: string): number {
  const [hours, minutes] = timeIn(instantMs, zone).split(':');
  return Number(hours) * MINUTES_PER_HOUR + Number(minutes);
}

/** Minutes from midnight for a floating `HH:mm`, or 0 when unset. */
export function timeToMinute(time: TimeOnly | null | undefined): number {
  if (!time) return 0;
  const [hours, minutes] = time.split(':');
  const h = Number.parseInt(hours, 10);
  const m = Number.parseInt(minutes, 10);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return 0;
  return clampMinutes(h * MINUTES_PER_HOUR + m);
}

/** Floating `HH:mm` for a minute-of-day, clamped into the day. */
export function minuteToTime(minute: number): TimeOnly {
  const value = clampMinutes(Math.round(minute));
  const h = Math.floor(value / MINUTES_PER_HOUR);
  const m = value % MINUTES_PER_HOUR;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Label for a gutter row: `09:00` in 24-hour mode, `9 AM` in 12-hour mode. */
export function formatHourLabel(hour: number, timeFormat: '12h' | '24h'): string {
  const h = ((Math.floor(hour) % HOURS_PER_DAY) + HOURS_PER_DAY) % HOURS_PER_DAY;
  if (timeFormat === '24h') return `${String(h).padStart(2, '0')}:00`;
  const suffix = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12} ${suffix}`;
}

/** Label for the drag ghost: `14:15` or `2:15 PM`. */
export function formatMinuteLabel(minute: number, timeFormat: '12h' | '24h'): string {
  const value = clampMinutes(Math.round(minute));
  const h = Math.floor(value / MINUTES_PER_HOUR);
  const mm = String(value % MINUTES_PER_HOUR).padStart(2, '0');
  if (timeFormat === '24h') return `${String(h).padStart(2, '0')}:${mm}`;
  const suffix = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${mm} ${suffix}`;
}

/* -------------------------------------------------------------------------- */
/* drag maths                                                                  */
/* -------------------------------------------------------------------------- */

export interface DragToStartInput {
  /** The block's current start, minutes from midnight. */
  startMinute: number;
  /** Vertical pointer travel since the drag began, in px (down is positive). */
  deltaY: number;
  hourHeight?: number;
  /** Snap granularity; defaults to a quarter hour. */
  snap?: number;
  /** Block length, used to keep the block inside its day. */
  durationMinutes?: number;
}

/**
 * The snapped start minute a dragged block lands on.
 *
 * The result is clamped so a block can never start before midnight or end after
 * it — the grid has no row for "tomorrow" and a silent overflow there is how
 * calendars end up showing an event on the wrong day.
 */
export function dragToStartMinute(input: DragToStartInput): number {
  const {
    startMinute,
    deltaY,
    hourHeight = DEFAULT_HOUR_HEIGHT,
    snap = SNAP_MINUTES,
    durationMinutes = 0,
  } = input;

  const raw = startMinute + pixelsToMinutes(deltaY, hourHeight);
  const snapped = snapMinutes(raw, snap);
  const maxStart = MINUTES_PER_DAY - clamp(durationMinutes, 0, MINUTES_PER_DAY);
  return clampMinutes(snapped, 0, maxStart);
}

/**
 * Whole-day column shift for a horizontal drag.
 *
 * `dayIndex` is the block's own column and `columns` the number of visible
 * columns, so a drag can never push a block out of the rendered range (which
 * would silently move it to a day the user cannot see).
 */
export function dragToDayDelta(deltaX: number, columnWidth: number, dayIndex: number, columns: number): number {
  if (columnWidth <= 0 || columns <= 1) return 0;
  const raw = Math.round(deltaX / columnWidth);
  return clamp(raw, -dayIndex, columns - 1 - dayIndex);
}

/** The cell lattice a drag moves across. */
export interface DayAxis {
  /** Cells per row: 7 for the month and week grids, 1 for the day grid. */
  columns: number;
  /** Flat index of the block's own cell within the visible range. */
  index: number;
  /** Total visible cells. */
  count: number;
  /** Cell width in px. */
  cellWidth: number;
  /** Row height in px; 0 disables vertical day movement (the timed grid). */
  rowHeight: number;
}

/**
 * Flat cell offset for a drag, in either direction.
 *
 * Built on `dragToDayDelta` so the horizontal rule (never leave the rendered
 * range) holds in the month grid too, where a drag may also cross whole weeks.
 */
export function dragToCellDelta(deltaX: number, deltaY: number, axis: DayAxis): number {
  const column = axis.columns > 0 ? axis.index % axis.columns : 0;
  const horizontal = dragToDayDelta(deltaX, axis.cellWidth, column, Math.max(axis.columns, 1));
  const rows = axis.rowHeight > 0 ? Math.round(deltaY / axis.rowHeight) : 0;
  return clamp(horizontal + rows * Math.max(axis.columns, 1), -axis.index, axis.count - 1 - axis.index);
}

/* -------------------------------------------------------------------------- */
/* month grid                                                                  */
/* -------------------------------------------------------------------------- */

export interface MonthCell {
  date: DateOnly;
  /** False for the days that pad the month out to a whole week. */
  inMonth: boolean;
}

/**
 * Chunks the server's padded day list into whole weeks.
 *
 * The list already starts on the user's week-start day and runs for whole weeks
 * (42 days for a month), so a plain slice is always correct. Capped at six rows
 * so the grid's height cannot change between months.
 */
export function buildMonthRows(
  days: readonly DateOnly[],
  anchor: DateOnly,
  rows: number = MONTH_ROWS,
): MonthCell[][] {
  const monthKey = anchor.slice(0, 7);
  const out: MonthCell[][] = [];

  for (let index = 0; index < days.length && out.length < rows; index += MONTH_COLUMNS) {
    out.push(
      days.slice(index, index + MONTH_COLUMNS).map((date) => ({ date, inMonth: date.slice(0, 7) === monthKey })),
    );
  }

  return out;
}

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WEEKDAY_INITIALS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

/** Weekday captions rotated to the user's `weekStartsOn` (0 = Sunday). */
export function weekdayLabels(
  weekStartsOn: number,
  style: 'long' | 'short' | 'initial' = 'short',
): string[] {
  const source = style === 'long' ? WEEKDAY_NAMES : style === 'initial' ? WEEKDAY_INITIALS : WEEKDAY_SHORT;
  return Array.from({ length: MONTH_COLUMNS }, (_, index) => source[(index + weekStartsOn) % MONTH_COLUMNS]);
}

/* -------------------------------------------------------------------------- */
/* all-day strip                                                               */
/* -------------------------------------------------------------------------- */

export interface AllDayLane {
  item: CalendarItem;
  /** Column index of the bar's first day. */
  startIndex: number;
  /** How many day columns the bar spans. */
  span: number;
  /** Row of the strip the bar sits in. */
  lane: number;
}

/**
 * Packs all-day items into lanes so a multi-day item draws as ONE bar.
 *
 * This is presentation-only packing over `days` — it is not the timed overlap
 * layout, which the server computes and sends as `layout`.
 */
export function layoutAllDayLanes(
  items: readonly CalendarItem[],
  days: readonly DateOnly[],
  zone: string,
): { lanes: AllDayLane[]; laneCount: number } {
  if (days.length === 0) return { lanes: [], laneCount: 0 };

  const indexOf = new Map(days.map((day, index) => [day, index]));
  const first = days[0];
  const last = days[days.length - 1];
  const entries: Omit<AllDayLane, 'lane'>[] = [];

  for (const item of items) {
    if (!item.isAllDay) continue;

    const firstDay = toDateOnly(item.startMs, zone);
    const lastDay = toDateOnly(Math.max(item.startMs, item.endMs - 1), zone);
    if (lastDay < first || firstDay > last) continue;

    // Clamp a block that starts before or ends after the visible window so it
    // still reads as continuous rather than vanishing at the edge.
    const resolvedStart = indexOf.get(firstDay) ?? (firstDay < first ? 0 : -1);
    const resolvedEnd = indexOf.get(lastDay) ?? (lastDay > last ? days.length - 1 : -1);
    if (resolvedStart < 0 || resolvedEnd < 0 || resolvedEnd < resolvedStart) continue;

    entries.push({ item, startIndex: resolvedStart, span: resolvedEnd - resolvedStart + 1 });
  }

  entries.sort((a, b) => a.startIndex - b.startIndex || b.span - a.span);

  const laneEnds: number[] = [];
  const lanes: AllDayLane[] = [];

  for (const entry of entries) {
    let lane = laneEnds.findIndex((end) => end < entry.startIndex);
    if (lane < 0) {
      lane = laneEnds.length;
      laneEnds.push(entry.startIndex + entry.span - 1);
    } else {
      laneEnds[lane] = entry.startIndex + entry.span - 1;
    }
    lanes.push({ ...entry, lane });
  }

  return { lanes, laneCount: laneEnds.length };
}

/* -------------------------------------------------------------------------- */
/* contrast                                                                    */
/* -------------------------------------------------------------------------- */

/** WCAG relative luminance for an `#rrggbb` string. */
export function relativeLuminance(hex: string): number {
  const clean = hex.replace('#', '').trim();
  if (!/^[0-9a-f]{6}$/i.test(clean)) return 0;

  const channels = [0, 2, 4]
    .map((offset) => Number.parseInt(clean.slice(offset, offset + 2), 16) / 255)
    .map((value) => (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));

  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

/**
 * Which text colour to draw on a filled accent block.
 *
 * `'dark'` for the bright accents (yellow, orange, green), `'light'` for the
 * dark ones (blue, indigo, purple, red, grey). Never assume white text on a
 * coloured block — that is exactly how a yellow event becomes unreadable.
 */
export function readableTextOn(hex: string): 'light' | 'dark' {
  return relativeLuminance(hex) > 0.36 ? 'dark' : 'light';
}
