/**
 * Month-grid tests: chunking the server's padded day list into six whole weeks,
 * weekday header rotation and all-day bar packing.
 *
 * The day lists come from `rangeForView` on purpose: that is the exact input the
 * grid receives over the wire, so these tests fail if the two ever disagree
 * about what a month window is.
 */
import { describe, expect, it } from 'vitest';
import {
  MONTH_COLUMNS,
  MONTH_ROWS,
  buildMonthRows,
  layoutAllDayLanes,
  weekdayLabels,
} from '@/components/calendar/geometry';
import { eachDayInclusive, rangeForView } from '@/lib/dates';
import type { CalendarItem } from '@/lib/types';

const ZONE = 'Europe/Berlin';

function item(overrides: Partial<CalendarItem> & Pick<CalendarItem, 'startMs' | 'endMs'>): CalendarItem {
  return {
    key: 'event:1:0',
    kind: 'event',
    id: '1',
    title: 'Test',
    isAllDay: true,
    color: 'blue',
    calendarId: 'cal-1',
    ...overrides,
  };
}

/** Start-of-day instant for a floating date, derived through lib/dates. */
function dayStart(date: string): number {
  return rangeForView('day', date, ZONE, 1).startMs;
}

describe('buildMonthRows', () => {
  it('chunks a 42-day month window into six rows of seven', () => {
    const range = rangeForView('month', '2025-03-17', ZONE, 1);
    expect(range.days).toHaveLength(MONTH_ROWS * MONTH_COLUMNS);

    const rows = buildMonthRows(range.days, '2025-03-17');
    expect(rows).toHaveLength(MONTH_ROWS);
    for (const row of rows) expect(row).toHaveLength(MONTH_COLUMNS);
  });

  it('preserves the server order and marks only the anchor month as in-month', () => {
    // March 2025 starts on a Saturday: with a Monday week start the grid opens
    // on 24 February and closes on 6 April.
    const range = rangeForView('month', '2025-03-17', ZONE, 1);
    const rows = buildMonthRows(range.days, '2025-03-17');
    const cells = rows.flat();

    expect(cells.map((cell) => cell.date)).toEqual(range.days);
    expect(cells[0]).toEqual({ date: '2025-02-24', inMonth: false });
    expect(cells[cells.length - 1]).toEqual({ date: '2025-04-06', inMonth: false });

    const inMonth = cells.filter((cell) => cell.inMonth).map((cell) => cell.date);
    expect(inMonth[0]).toBe('2025-03-01');
    expect(inMonth[inMonth.length - 1]).toBe('2025-03-31');
    expect(inMonth).toHaveLength(31);
  });

  it('follows the user week start', () => {
    const range = rangeForView('month', '2025-03-17', ZONE, 0);
    const cells = buildMonthRows(range.days, '2025-03-17').flat();
    expect(cells[0].date).toBe('2025-02-23'); // Sunday
    expect(cells[6].date).toBe('2025-03-01');
  });

  it('caps the grid at six rows so the layout cannot jump', () => {
    // A 7-week list is not something a month view may show.
    const days = eachDayInclusive('2025-01-01', '2025-02-18', ZONE);
    expect(days).toHaveLength(49);
    expect(buildMonthRows(days, '2025-01-15')).toHaveLength(MONTH_ROWS);
  });

  it('is empty for an empty window instead of inventing days', () => {
    expect(buildMonthRows([], '2025-03-01')).toEqual([]);
  });
});

describe('weekdayLabels', () => {
  it('rotates the captions to the configured week start', () => {
    expect(weekdayLabels(1)).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
    expect(weekdayLabels(0)).toEqual(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);
    expect(weekdayLabels(1, 'initial')).toEqual(['M', 'T', 'W', 'T', 'F', 'S', 'S']);
    expect(weekdayLabels(1, 'long')[0]).toBe('Monday');
  });
});

describe('layoutAllDayLanes', () => {
  const week = rangeForView('week', '2025-03-12', ZONE, 1).days; // Mon 10 .. Sun 16

  it('draws a multi-day item as one bar spanning its days', () => {
    const trip = item({ startMs: dayStart('2025-03-11'), endMs: dayStart('2025-03-14') }); // 11th-13th
    const { lanes, laneCount } = layoutAllDayLanes([trip], week, ZONE);

    expect(laneCount).toBe(1);
    expect(lanes).toHaveLength(1);
    expect(lanes[0].startIndex).toBe(1);
    expect(lanes[0].span).toBe(3);
  });

  it('stacks overlapping items into separate lanes', () => {
    const a = item({ key: 'a', startMs: dayStart('2025-03-10'), endMs: dayStart('2025-03-12') });
    const b = item({ key: 'b', startMs: dayStart('2025-03-11'), endMs: dayStart('2025-03-13') });
    const { lanes, laneCount } = layoutAllDayLanes([a, b], week, ZONE);

    expect(laneCount).toBe(2);
    expect(lanes.find((lane) => lane.item.key === 'a')?.lane).toBe(0);
    expect(lanes.find((lane) => lane.item.key === 'b')?.lane).toBe(1);
  });

  it('reuses a lane once it is free again', () => {
    const a = item({ key: 'a', startMs: dayStart('2025-03-10'), endMs: dayStart('2025-03-11') });
    const b = item({ key: 'b', startMs: dayStart('2025-03-11'), endMs: dayStart('2025-03-12') });
    const { laneCount } = layoutAllDayLanes([a, b], week, ZONE);
    expect(laneCount).toBe(1);
  });

  it('ignores timed items (they belong to the timed grid)', () => {
    const timed = item({ isAllDay: false, startMs: dayStart('2025-03-10') + 3600_000, endMs: dayStart('2025-03-10') + 7200_000 });
    expect(layoutAllDayLanes([timed], week, ZONE).lanes).toHaveLength(0);
  });

  it('skips items outside the visible window', () => {
    const far = item({ startMs: dayStart('2025-04-01'), endMs: dayStart('2025-04-02') });
    expect(layoutAllDayLanes([far], week, ZONE).lanes).toHaveLength(0);
  });

  it('clamps a bar that starts before the window so it still reads as continuous', () => {
    const long = item({ startMs: dayStart('2025-03-01'), endMs: dayStart('2025-03-13') });
    const { lanes } = layoutAllDayLanes([long], week, ZONE);
    expect(lanes[0].startIndex).toBe(0);
    expect(lanes[0].span).toBe(3);
  });
});
