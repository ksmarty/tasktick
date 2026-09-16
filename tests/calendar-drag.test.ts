/**
 * Drag tests: pointer delta -> snapped new start, day-column clamping.
 *
 * The grid is driven at 60px per hour so one pixel of travel is one minute,
 * which makes every expectation in here checkable by eye.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_HOUR_HEIGHT,
  dragToCellDelta,
  dragToDayDelta,
  dragToStartMinute,
  type DayAxis,
} from '@/components/calendar/geometry';

const HOUR = 60;

describe('dragToStartMinute', () => {
  it('returns the original start when the pointer did not move', () => {
    expect(dragToStartMinute({ startMinute: 540, deltaY: 0, hourHeight: HOUR })).toBe(540);
  });

  it('snaps the dragged start to the quarter hour', () => {
    // 09:00 + 37px (=37m) = 09:37 -> 09:30
    expect(dragToStartMinute({ startMinute: 540, deltaY: 37, hourHeight: HOUR })).toBe(570);
    // 09:00 + 8px -> 09:15
    expect(dragToStartMinute({ startMinute: 540, deltaY: 8, hourHeight: HOUR })).toBe(555);
    // 09:00 - 22px -> 08:45
    expect(dragToStartMinute({ startMinute: 540, deltaY: -22, hourHeight: HOUR })).toBe(525);
  });

  it('scales with the rendered hour height', () => {
    // One full hour of travel is one full hour of time, whatever the row size.
    expect(dragToStartMinute({ startMinute: 540, deltaY: DEFAULT_HOUR_HEIGHT, hourHeight: DEFAULT_HOUR_HEIGHT })).toBe(
      600,
    );
    expect(dragToStartMinute({ startMinute: 0, deltaY: 34, hourHeight: 68 })).toBe(30);
  });

  it('honours a custom snap step', () => {
    expect(dragToStartMinute({ startMinute: 540, deltaY: 20, hourHeight: HOUR, snap: 30 })).toBe(570);
    expect(dragToStartMinute({ startMinute: 540, deltaY: 20, hourHeight: HOUR, snap: 5 })).toBe(560);
  });

  it('keeps the block inside its day', () => {
    // 23:00 with a one-hour block cannot move any later.
    expect(dragToStartMinute({ startMinute: 1380, deltaY: 600, hourHeight: HOUR, durationMinutes: 60 })).toBe(1380);
    // A block at 00:30 cannot move any earlier.
    expect(dragToStartMinute({ startMinute: 30, deltaY: -600, hourHeight: HOUR, durationMinutes: 60 })).toBe(0);
    // An all-day block (1440 minutes long) pins to midnight.
    expect(dragToStartMinute({ startMinute: 0, deltaY: 200, hourHeight: HOUR, durationMinutes: 1440 })).toBe(0);
  });
});

describe('dragToDayDelta', () => {
  it('moves whole columns on a horizontal drag', () => {
    // 100px-wide columns: 120px of travel is one day to the right.
    expect(dragToDayDelta(120, 100, 2, 7)).toBe(1);
    expect(dragToDayDelta(-260, 100, 4, 7)).toBe(-3);
    expect(dragToDayDelta(40, 100, 2, 7)).toBe(0);
  });

  it('cannot push a block out of the visible range', () => {
    expect(dragToDayDelta(900, 100, 1, 7)).toBe(5);
    expect(dragToDayDelta(-900, 100, 1, 7)).toBe(-1);
    expect(dragToDayDelta(900, 100, 0, 1)).toBe(0);
    expect(dragToDayDelta(900, 0, 3, 7)).toBe(0);
  });
});

/** A 7x6 month grid: 100px cells, 120px rows, 42 cells. */
function monthAxis(index: number): DayAxis {
  return { columns: 7, index, count: 42, cellWidth: 100, rowHeight: 120 };
}

describe('dragToCellDelta', () => {
  it('moves a cell per column when dragged sideways', () => {
    expect(dragToCellDelta(120, 0, monthAxis(10))).toBe(1);
    expect(dragToCellDelta(-120, 0, monthAxis(10))).toBe(-1);
    expect(dragToCellDelta(0, 0, monthAxis(10))).toBe(0);
  });

  it('moves a whole week when dragged down a row', () => {
    expect(dragToCellDelta(0, 130, monthAxis(10))).toBe(7);
    expect(dragToCellDelta(0, -130, monthAxis(10))).toBe(-7);
    expect(dragToCellDelta(120, 130, monthAxis(10))).toBe(8);
  });

  it('clamps to the rendered grid', () => {
    expect(dragToCellDelta(0, 2000, monthAxis(3))).toBe(38);
    expect(dragToCellDelta(0, -2000, monthAxis(3))).toBe(-3);
    expect(dragToCellDelta(2000, 0, monthAxis(6))).toBe(0);
  });

  it('stays inside a single-cell (day) grid', () => {
    const dayAxis: DayAxis = { columns: 1, index: 0, count: 1, cellWidth: 320, rowHeight: 0 };
    expect(dragToCellDelta(400, 400, dayAxis)).toBe(0);
  });
});
