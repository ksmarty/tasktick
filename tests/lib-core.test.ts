import { describe, expect, it } from 'vitest';
import { DateTime } from 'luxon';
import { compareKeys, keyBetween, keyFromMillis, reorderKeys, spreadKeys, DEFAULT_KEY_WIDTH } from '@/lib/fractional';
import {
  addDaysToDateOnly,
  allDayBounds,
  combineDateAndTime,
  dateOnlyToMillis,
  dueWindowBounds,
  eachDayInclusive,
  formatClock,
  formatDateTime,
  formatDayMonth,
  formatFullDate,
  fromDateOnly,
  humanDuration,
  isOverdue,
  isValidDateOnly,
  isValidZone,
  overlaps,
  priorityWeight,
  rangeForView,
  relativeDayLabel,
  shiftViewAnchor,
  startOfWeekDate,
  taskDay,
  toDateOnly,
  weekBounds,
} from '@/lib/dates';
import { asAccentColor, colorForName, accentHex } from '@/lib/colors';
import { ACCENT_COLORS } from '@/lib/types';

describe('fractional keys', () => {
  it('produces keys that sort strictly between their neighbours', () => {
    const first = keyBetween(null, null).key;
    const second = keyBetween(first, null).key;
    const middle = keyBetween(first, second).key;

    expect(compareKeys(first, middle)).toBeLessThan(0);
    expect(compareKeys(middle, second)).toBeLessThan(0);
  });

  it('supports repeated subdivision until the key space runs out, then asks for a renumber', () => {
    let low = keyBetween(null, null).key;
    let high = keyBetween(low, null).key;
    let subdivisions = 0;
    let sawRenumberRequest = false;

    for (let i = 0; i < 200; i++) {
      const result = keyBetween(low, high);
      if (result.needsRenumber) {
        sawRenumberRequest = true;
        break;
      }
      // The new key must genuinely sit between the two.
      expect(compareKeys(low, result.key)).toBeLessThan(0);
      expect(compareKeys(result.key, high)).toBeLessThan(0);
      // Narrow the gap so the next iteration subdivides further.
      if (subdivisions % 2 === 0) low = result.key;
      else high = result.key;
      subdivisions++;
    }

    // Fixed-width keys must eventually exhaust rather than grow unbounded,
    // because a variable-width key would break lexicographic ordering.
    expect(sawRenumberRequest).toBe(true);
    expect(subdivisions).toBeGreaterThan(10);
  });

  it('emits keys of a constant width so string comparison stays valid', () => {
    const keys = [keyBetween(null, null).key, ...spreadKeys(20)];
    for (const key of keys) expect(key).toHaveLength(DEFAULT_KEY_WIDTH);
  });

  it('rejects out-of-order input instead of producing a corrupt key', () => {
    const a = keyBetween(null, null).key;
    const b = keyBetween(a, null).key;
    expect(() => keyBetween(b, a)).toThrow();
  });

  it('spreads keys evenly and in order', () => {
    const keys = spreadKeys(5);
    expect(keys).toHaveLength(5);
    const sorted = [...keys].sort(compareKeys);
    expect(keys).toEqual(sorted);
    expect(new Set(keys).size).toBe(5);
  });

  it('renumbers a reordered id list into ascending keys', () => {
    const result = reorderKeys(['c', 'a', 'b']);
    expect(result.map((r) => r.id)).toEqual(['c', 'a', 'b']);
    const keys = result.map((r) => r.sortOrder);
    expect([...keys].sort(compareKeys)).toEqual(keys);
  });

  it('handles the empty and single-item cases', () => {
    expect(spreadKeys(0)).toEqual([]);
    expect(reorderKeys([])).toEqual([]);
    expect(reorderKeys(['only'])).toHaveLength(1);
  });

  it('escapes a huge timestamp into a valid fixed-width key', () => {
    const key = keyFromMillis(Date.now());
    expect(key).toHaveLength(DEFAULT_KEY_WIDTH);
    expect(compareKeys(keyFromMillis(1000), keyFromMillis(2000))).toBeLessThan(0);
  });
});

describe('date conversions', () => {
  it('validates dates and zones', () => {
    expect(isValidDateOnly('2025-03-10')).toBe(true);
    expect(isValidDateOnly('2025-13-10')).toBe(false);
    expect(isValidDateOnly('10/03/2025')).toBe(false);
    expect(isValidDateOnly(null)).toBe(false);
    expect(isValidZone('Europe/Berlin')).toBe(true);
    expect(isValidZone('Mars/Olympus')).toBe(false);
  });

  it('renders an instant as the floating day seen from a zone', () => {
    // 2025-03-10T23:30Z is already the 11th in Berlin.
    const instant = DateTime.fromISO('2025-03-10T23:30:00Z').toMillis();
    expect(toDateOnly(instant, 'UTC')).toBe('2025-03-10');
    expect(toDateOnly(instant, 'Europe/Berlin')).toBe('2025-03-11');
  });

  it('round-trips a floating day through a zone', () => {
    expect(toDateOnly(dateOnlyToMillis('2025-03-10', 'America/New_York'), 'America/New_York')).toBe('2025-03-10');
    expect(toDateOnly(dateOnlyToMillis('2025-03-10', 'Pacific/Auckland'), 'Pacific/Auckland')).toBe('2025-03-10');
  });

  it('adds days across a DST boundary without drifting an hour', () => {
    // Europe/Berlin springs forward on 2025-03-30.
    expect(addDaysToDateOnly('2025-03-29', 1, 'Europe/Berlin')).toBe('2025-03-30');
    expect(addDaysToDateOnly('2025-03-30', 1, 'Europe/Berlin')).toBe('2025-03-31');
    expect(addDaysToDateOnly('2025-10-26', 1, 'Europe/Berlin')).toBe('2025-10-27');
  });

  it('combines a floating day and a wall-clock time in a named zone', () => {
    const ms = combineDateAndTime('2025-03-10', '09:30', 'Europe/Berlin');
    expect(DateTime.fromMillis(ms, { zone: 'Europe/Berlin' }).toFormat('yyyy-MM-dd HH:mm')).toBe('2025-03-10 09:30');
    // The same wall clock is a different instant in another zone.
    const other = combineDateAndTime('2025-03-10', '09:30', 'America/New_York');
    expect(other).not.toBe(ms);
  });

  it('resolves a non-existent local time (the DST gap) to a valid instant', () => {
    // 02:30 does not exist in Berlin on 2025-03-30.
    const ms = combineDateAndTime('2025-03-30', '02:30', 'Europe/Berlin');
    expect(DateTime.fromMillis(ms).isValid).toBe(true);
  });
});

describe('week and range maths', () => {
  it('honours both week starts', () => {
    // 2025-03-12 is a Wednesday.
    expect(startOfWeekDate('2025-03-12', 1, 'UTC')).toBe('2025-03-10');
    expect(startOfWeekDate('2025-03-12', 0, 'UTC')).toBe('2025-03-09');
    // A Sunday is the START of the week when weekStartsOn is 0, not the end.
    expect(startOfWeekDate('2025-03-09', 0, 'UTC')).toBe('2025-03-09');
    expect(startOfWeekDate('2025-03-09', 1, 'UTC')).toBe('2025-03-03');
  });

  it('computes inclusive week bounds', () => {
    expect(weekBounds('2025-03-12', 1, 'UTC')).toEqual({ start: '2025-03-10', end: '2025-03-16' });
    expect(weekBounds('2025-03-12', 0, 'UTC')).toEqual({ start: '2025-03-09', end: '2025-03-15' });
  });

  it('returns whole weeks for the month view so the grid never has a ragged edge', () => {
    const range = rangeForView('month', '2025-03-15', 'UTC', 1);
    expect(range.days.length % 7).toBe(0);
    expect(range.days.length).toBeGreaterThanOrEqual(28);
    expect(range.days).toContain('2025-03-01');
    expect(range.days).toContain('2025-03-31');
    expect(range.label).toBe('March 2025');
  });

  it('returns a stable six-week grid for every month layout', () => {
    for (const anchor of ['2025-02-01', '2025-03-01', '2025-06-15', '2026-02-28']) {
      expect(rangeForView('month', anchor, 'UTC', 1).days).toHaveLength(42);
    }
  });

  it('produces a half-open window for every view kind', () => {
    for (const view of ['day', 'week', 'month', 'agenda', 'year'] as const) {
      const range = rangeForView(view, '2025-03-15', 'UTC', 1);
      expect(range.endMs).toBeGreaterThan(range.startMs);
      expect(range.days.length).toBeGreaterThan(0);
      expect(range.days[0]).toBe(range.startDate);
      expect(range.days[range.days.length - 1]).toBe(range.endDate);
    }
  });

  it('shifts the anchor by one period at a time', () => {
    expect(shiftViewAnchor('day', '2025-03-15', 1, 'UTC')).toBe('2025-03-16');
    expect(shiftViewAnchor('day', '2025-03-15', -1, 'UTC')).toBe('2025-03-14');
    expect(shiftViewAnchor('week', '2025-03-15', 1, 'UTC')).toBe('2025-03-22');
    expect(shiftViewAnchor('month', '2025-01-31', 1, 'UTC')).toBe('2025-02-01');
    expect(shiftViewAnchor('month', '2025-01-15', -1, 'UTC')).toBe('2024-12-01');
    expect(shiftViewAnchor('year', '2025-06-15', 1, 'UTC')).toBe('2026-01-01');
  });

  it('computes due-window bounds relative to today', () => {
    // Bounds are derived from the real clock, so assert relationships rather
    // than fixed dates.
    const today = dueWindowBounds('today', 'UTC');
    expect(today.from).toBe(today.to);

    const overdue = dueWindowBounds('overdue', 'UTC');
    expect(overdue.from).toBeNull();
    expect(overdue.to! < today.from!).toBe(true);

    const seven = dueWindowBounds('next7days', 'UTC');
    expect(seven.from).toBe(today.from);
    expect(seven.to! > today.from!).toBe(true);

    expect(dueWindowBounds('all', 'UTC')).toEqual({ from: null, to: null });
    expect(dueWindowBounds('noDate', 'UTC')).toEqual({ from: null, to: null });
  });

  it('detects overlap with half-open semantics', () => {
    expect(overlaps(0, 10, 5, 15)).toBe(true);
    expect(overlaps(0, 10, 10, 20)).toBe(false);
    expect(overlaps(10, 20, 0, 10)).toBe(false);
    expect(overlaps(0, 10, 2, 4)).toBe(true);
  });

  it('enumerates days inclusively', () => {
    expect(eachDayInclusive('2025-03-10', '2025-03-12', 'UTC')).toEqual(['2025-03-10', '2025-03-11', '2025-03-12']);
    expect(eachDayInclusive('2025-03-10', '2025-03-10', 'UTC')).toEqual(['2025-03-10']);
  });
});

describe('task presentation helpers', () => {
  const zone = 'UTC';

  it('picks the sort instant from whichever field is set', () => {
    expect(taskDay({ dueDate: '2025-03-10', dueAtMs: null, startAtMs: null, startDate: null }, zone)).toBe('2025-03-10');
    expect(taskDay({ dueDate: null, dueAtMs: dateOnlyToMillis('2025-03-11', zone), startAtMs: null, startDate: null }, zone)).toBe(
      '2025-03-11',
    );
    expect(taskDay({ dueDate: null, dueAtMs: null, startAtMs: null, startDate: '2025-03-12' }, zone)).toBe('2025-03-12');
    expect(taskDay({ dueDate: null, dueAtMs: null, startAtMs: null, startDate: null }, zone)).toBeNull();
  });

  it('never calls a completed task overdue', () => {
    const past = { dueDate: '2000-01-01', dueAtMs: null, status: 'completed' as const, isAllDay: true };
    expect(isOverdue(past, zone)).toBe(false);
    expect(isOverdue({ ...past, status: 'todo' }, zone)).toBe(true);
  });

  it('treats an all-day task due today as not overdue until the day has passed', () => {
    const today = DateTime.now().setZone(zone).toFormat('yyyy-MM-dd');
    expect(isOverdue({ dueDate: today, dueAtMs: null, status: 'todo', isAllDay: true }, zone)).toBe(false);
  });

  it('labels relative days the way a person would', () => {
    const now = DateTime.fromISO('2025-03-10T12:00:00', { zone });
    expect(relativeDayLabel('2025-03-10', zone, now)).toBe('Today');
    expect(relativeDayLabel('2025-03-11', zone, now)).toBe('Tomorrow');
    expect(relativeDayLabel('2025-03-09', zone, now)).toBe('Yesterday');
    expect(relativeDayLabel('2025-03-13', zone, now)).toBe('Thursday');
    expect(relativeDayLabel('2025-03-17', zone, now)).toBe('Next Monday');
    expect(relativeDayLabel('2025-06-01', zone, now)).toBe('Sun Jun 1');
    expect(relativeDayLabel('2026-06-01', zone, now)).toBe('Mon Jun 1 2026');
  });

  it('spells the short day month-first: weekday, month, day', () => {
    // `Sat Oct 8` — the convention the whole app now uses. The timestamp is a
    // real Saturday so the weekday is checkable by hand.
    const today = DateTime.fromISO('2022-10-01T12:00:00', { zone });
    expect(formatDayMonth(DateTime.fromISO('2022-10-08', { zone }), today)).toBe('Sat Oct 8');
  });

  it('shows the year exactly when the date is not in the current year', () => {
    const now = DateTime.fromISO('2025-03-10T12:00:00', { zone });
    // This year: no year.
    expect(formatDayMonth(DateTime.fromISO('2025-10-08', { zone }), now)).toBe('Wed Oct 8');
    // Another year: the year travels with it, so March 2026 cannot read as this
    // year's March.
    expect(formatDayMonth(DateTime.fromISO('2026-10-08', { zone }), now)).toBe('Thu Oct 8 2026');
  });

  it('keeps the year on the deliberately long full date', () => {
    // The selected-day announcement is spelled out and never shortened; it is
    // only reordered month-first like everything else.
    const prefs = { zone, timeFormat: '24h' as const, weekStartsOn: 1 };
    expect(formatFullDate(dateOnlyToMillis('2025-09-30', zone), prefs)).toBe('Tuesday September 30 2025');
  });

  it('puts the month before the day in a date and time', () => {
    const prefs = { zone, timeFormat: '24h' as const, weekStartsOn: 1 };
    expect(formatDateTime(dateOnlyToMillis('2025-09-30', zone), prefs, DateTime.fromISO('2025-03-10', { zone }))).toBe(
      'Tue Sep 30 00:00',
    );
    expect(formatDateTime(dateOnlyToMillis('2026-09-30', zone), prefs, DateTime.fromISO('2025-03-10', { zone }))).toBe(
      'Wed Sep 30 2026 00:00',
    );
  });

  it('formats durations and clocks', () => {
    expect(humanDuration(45)).toBe('45m');
    expect(humanDuration(60)).toBe('1h');
    expect(humanDuration(90)).toBe('1h 30m');
    expect(formatClock(0)).toBe('00:00');
    expect(formatClock(59)).toBe('00:59');
    expect(formatClock(1500)).toBe('25:00');
    expect(formatClock(-5)).toBe('00:00');
  });

  it('normalises all-day bounds to at least one whole day', () => {
    const oneDay = allDayBounds('2025-03-10', null, zone);
    expect(oneDay.endMs - oneDay.startMs).toBe(86_400_000);

    const spanning = allDayBounds('2025-03-10', '2025-03-13', zone);
    expect(spanning.endMs - spanning.startMs).toBe(3 * 86_400_000);
  });

  it('weights priorities for sorting and the matrix', () => {
    expect(priorityWeight('high')).toBeGreaterThan(priorityWeight('medium'));
    expect(priorityWeight('medium')).toBeGreaterThan(priorityWeight('low'));
    expect(priorityWeight('low')).toBeGreaterThan(priorityWeight('none'));
  });

  it('builds a midnight anchor for a floating day', () => {
    const dt = fromDateOnly('2025-03-10', 'Europe/Berlin');
    expect(dt.hour).toBe(0);
    expect(dt.toFormat('yyyy-MM-dd')).toBe('2025-03-10');
  });
});

describe('colour helpers', () => {
  it('falls back to blue for an unknown stored value', () => {
    expect(asAccentColor('chartreuse')).toBe('blue');
    expect(asAccentColor(null)).toBe('blue');
    expect(asAccentColor('green')).toBe('green');
  });

  it('resolves a hex value for every accent, in both appearances', () => {
    for (const color of ACCENT_COLORS) {
      expect(accentHex(color, false)).toMatch(/^#[0-9a-f]{6}$/);
      expect(accentHex(color, true)).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('derives a stable colour from a name', () => {
    expect(colorForName('work', ACCENT_COLORS)).toBe(colorForName('work', ACCENT_COLORS));
    expect(ACCENT_COLORS).toContain(colorForName('anything', ACCENT_COLORS));
    expect(ACCENT_COLORS).toContain(colorForName('', ACCENT_COLORS));
  });
});
