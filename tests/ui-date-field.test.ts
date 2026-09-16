/**
 * `DateField`'s string maths: the `YYYY-MM-DD` round trip, calendar arithmetic
 * that must never cross a timezone, and the six-week grid.
 */
import { describe, expect, it } from 'vitest';
import {
  addDays,
  clampDateOnly,
  compareDateOnly,
  daysInMonth,
  diffDays,
  formatDateLong,
  formatDateOnly,
  formatMonthLabel,
  isValidDateOnly,
  monthGrid,
  moveGridFocus,
  normaliseDateOnly,
  parseDateOnly,
  quickDateOptions,
  shiftMonth,
  shiftMonthKeepDay,
  todayDateOnly,
  weekdayIndex,
} from '@/components/ui/date-field';

describe('parseDateOnly / formatDateOnly', () => {
  it('round-trips a valid day', () => {
    const parts = parseDateOnly('2025-09-24');
    expect(parts).toEqual({ year: 2025, month: 9, day: 24 });
    expect(formatDateOnly(parts!)).toBe('2025-09-24');
  });

  it('round-trips through the normaliser', () => {
    expect(normaliseDateOnly('2024-02-29')).toBe('2024-02-29');
    expect(normaliseDateOnly('0001-01-01')).toBe('0001-01-01');
  });

  it('rejects anything that is not a real calendar day', () => {
    for (const input of ['', 'today', '2025-2-3', '2025/09/24', '2025-13-01', '2025-00-10', '2025-02-30', '2023-02-29']) {
      expect(parseDateOnly(input)).toBeNull();
      expect(normaliseDateOnly(input)).toBeNull();
      expect(isValidDateOnly(input)).toBe(false);
    }
  });

  it('accepts leap days only in leap years', () => {
    expect(parseDateOnly('2024-02-29')).not.toBeNull();
    expect(parseDateOnly('2100-02-29')).toBeNull();
  });

  it('treats null and undefined as "no date"', () => {
    expect(parseDateOnly(null)).toBeNull();
    expect(parseDateOnly(undefined)).toBeNull();
    expect(normaliseDateOnly(null)).toBeNull();
  });
});

describe('daysInMonth', () => {
  it('knows the month lengths, including February', () => {
    expect(daysInMonth(2025, 1)).toBe(31);
    expect(daysInMonth(2025, 2)).toBe(28);
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2025, 4)).toBe(30);
    expect(daysInMonth(2025, 12)).toBe(31);
  });
});

describe('addDays', () => {
  it('crosses month and year boundaries', () => {
    expect(addDays('2025-01-31', 1)).toBe('2025-02-01');
    expect(addDays('2025-12-31', 1)).toBe('2026-01-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
    expect(addDays('2023-02-28', 1)).toBe('2023-03-01');
  });

  it('is a no-op for zero days', () => {
    expect(addDays('2025-09-24', 0)).toBe('2025-09-24');
  });

  it('round-trips over a year', () => {
    expect(addDays(addDays('2025-09-24', 365), -365)).toBe('2025-09-24');
  });

  it('refuses a malformed input instead of guessing', () => {
    expect(() => addDays('24/09/2025', 1)).toThrow(RangeError);
  });
});

describe('diffDays and compareDateOnly', () => {
  it('measures whole days in both directions', () => {
    expect(diffDays('2025-09-24', '2025-09-25')).toBe(1);
    expect(diffDays('2025-09-25', '2025-09-24')).toBe(-1);
    expect(diffDays('2025-01-01', '2026-01-01')).toBe(365);
  });

  it('orders ISO strings', () => {
    expect(compareDateOnly('2025-09-24', '2025-09-25')).toBe(-1);
    expect(compareDateOnly('2025-10-01', '2025-09-30')).toBe(1);
    expect(compareDateOnly('2025-09-24', '2025-09-24')).toBe(0);
  });
});

describe('weekdayIndex', () => {
  it('is 0 for Sunday and 6 for Saturday', () => {
    expect(weekdayIndex('2025-09-21')).toBe(0);
    expect(weekdayIndex('2025-09-27')).toBe(6);
  });
});

describe('clampDateOnly', () => {
  it('keeps a day inside an inclusive window', () => {
    expect(clampDateOnly('2025-09-01', '2025-09-10', '2025-09-20')).toBe('2025-09-10');
    expect(clampDateOnly('2025-09-30', '2025-09-10', '2025-09-20')).toBe('2025-09-20');
    expect(clampDateOnly('2025-09-15', '2025-09-10', '2025-09-20')).toBe('2025-09-15');
    expect(clampDateOnly('2025-09-15', undefined, undefined)).toBe('2025-09-15');
  });
});

describe('shiftMonth / shiftMonthKeepDay', () => {
  it('wraps around the year', () => {
    expect(shiftMonth(2025, 12, 1)).toEqual({ year: 2026, month: 1 });
    expect(shiftMonth(2025, 1, -1)).toEqual({ year: 2024, month: 12 });
    expect(shiftMonth(2025, 6, -7)).toEqual({ year: 2024, month: 11 });
  });

  it('keeps the day of month, shortening only when the month is shorter', () => {
    expect(shiftMonthKeepDay('2025-01-31', 1)).toBe('2025-02-28');
    expect(shiftMonthKeepDay('2024-01-31', 1)).toBe('2024-02-29');
    expect(shiftMonthKeepDay('2025-03-15', -1)).toBe('2025-02-15');
    expect(shiftMonthKeepDay('2025-12-15', 1)).toBe('2026-01-15');
  });
});

describe('monthGrid', () => {
  it('always returns six whole weeks', () => {
    for (const [year, month] of [
      [2025, 2],
      [2025, 9],
      [2024, 2],
      [2026, 3],
    ] as const) {
      expect(monthGrid(year, month)).toHaveLength(42);
    }
  });

  it('starts on the requested first day of the week', () => {
    const mondayFirst = monthGrid(2025, 9, 1);
    const sundayFirst = monthGrid(2025, 9, 0);

    expect(weekdayIndex(mondayFirst[0].date)).toBe(1);
    expect(weekdayIndex(sundayFirst[0].date)).toBe(0);
  });

  it('contains every day of the month exactly once, in order', () => {
    const cells = monthGrid(2025, 9);
    const inMonth = cells.filter((cell) => cell.inMonth).map((cell) => cell.date);

    expect(inMonth[0]).toBe('2025-09-01');
    expect(inMonth[inMonth.length - 1]).toBe('2025-09-30');
    expect(inMonth).toHaveLength(30);
  });

  it('pads February with trailing days from the next month', () => {
    const cells = monthGrid(2025, 2);
    const last = cells[cells.length - 1];

    expect(cells[0].date < '2025-02-01').toBe(true);
    expect(last.inMonth).toBe(false);
    expect(last.date > '2025-02-28').toBe(true);
  });
});

describe('moveGridFocus', () => {
  it('moves a day at a time with the horizontal arrows', () => {
    expect(moveGridFocus('2025-09-24', 'ArrowLeft')).toBe('2025-09-23');
    expect(moveGridFocus('2025-09-24', 'ArrowRight')).toBe('2025-09-25');
    expect(moveGridFocus('2025-09-30', 'ArrowRight')).toBe('2025-10-01');
  });

  it('moves a week at a time with the vertical arrows', () => {
    expect(moveGridFocus('2025-09-24', 'ArrowUp')).toBe('2025-09-17');
    expect(moveGridFocus('2025-09-24', 'ArrowDown')).toBe('2025-10-01');
  });

  it('jumps to the ends of the week with Home and End', () => {
    // 2025-09-24 is a Wednesday; Monday-start weeks run 22..28.
    expect(moveGridFocus('2025-09-24', 'Home', 1)).toBe('2025-09-22');
    expect(moveGridFocus('2025-09-24', 'End', 1)).toBe('2025-09-28');
    expect(moveGridFocus('2025-09-24', 'Home', 0)).toBe('2025-09-21');
    expect(moveGridFocus('2025-09-24', 'End', 0)).toBe('2025-09-27');
  });

  it('changes month with PageUp and PageDown', () => {
    expect(moveGridFocus('2025-09-24', 'PageUp')).toBe('2025-08-24');
    expect(moveGridFocus('2025-09-24', 'PageDown')).toBe('2025-10-24');
    expect(moveGridFocus('2025-03-31', 'PageDown')).toBe('2025-04-30');
  });
});

describe('quickDateOptions', () => {
  it('offers Today, Tomorrow and Next week as floating days', () => {
    const options = quickDateOptions('2025-09-24');

    expect(options.map((option) => option.label)).toEqual(['Today', 'Tomorrow', 'Next week']);
    expect(options.map((option) => option.date)).toEqual(['2025-09-24', '2025-09-25', '2025-10-01']);
  });
});

describe('presentation helpers', () => {
  it('formats a full label without touching the locale', () => {
    expect(formatDateLong('2025-09-24')).toBe('Wed 24 Sep 2025');
    expect(formatDateLong('not-a-date')).toBe('not-a-date');
  });

  it('formats a month heading', () => {
    expect(formatMonthLabel(2025, 9)).toBe('September 2025');
  });

  it('reads today off the local calendar rather than UTC', () => {
    // 00:30 local on the 2nd is still the 2nd for the user, whatever UTC says.
    expect(todayDateOnly(new Date(2025, 8, 2, 0, 30))).toBe('2025-09-02');
    expect(todayDateOnly(new Date(2025, 11, 31, 23, 59))).toBe('2025-12-31');
  });
});
