/**
 * Pure geometry for the habit heatmap: the week grid, the first-week offset,
 * the month labels and the cell intensity ramp.
 */
import { describe, expect, it } from 'vitest';
import {
  HEATMAP_DAYS,
  HEATMAP_LEVELS,
  buildHeatmapGrid,
  combineHabitEntries,
  habitsCheckedOn,
  heatmapCellLabel,
  heatmapDateLabel,
  heatmapRangeLabel,
  heatmapWindow,
  intensityLevel,
} from '@/components/habits/heatmap';
import type { DateOnly, Habit } from '@/lib/types';

const TODAY: DateOnly = '2025-03-12';

function grid(options: Partial<Parameters<typeof buildHeatmapGrid>[0]> = {}) {
  return buildHeatmapGrid({ from: '2025-01-01', to: '2025-03-12', today: TODAY, weekStartsOn: 1, ...options });
}

describe('buildHeatmapGrid', () => {
  it('lays out whole weeks of exactly seven rows', () => {
    const result = grid();

    expect(result.weeks.length).toBeGreaterThan(0);
    for (const week of result.weeks) expect(week).toHaveLength(7);
  });

  it('covers every day of the window, in order and exactly once', () => {
    const result = grid();
    const dates = result.weeks.flat().filter((cell) => cell !== null).map((cell) => cell.date);

    expect(dates[0]).toBe('2025-01-01');
    expect(dates[dates.length - 1]).toBe('2025-03-12');
    expect(new Set(dates).size).toBe(dates.length);
    // 31 + 28 + 12 days of 2025 up to 12 March.
    expect(dates).toHaveLength(71);
  });

  it('pads the first week with nulls for a window that starts mid-week', () => {
    // 1 Jan 2025 is a Wednesday; with Monday as the first day two cells are
    // outside the window.
    const mondayFirst = grid({ weekStartsOn: 1 });
    const firstWeek = mondayFirst.weeks[0];

    expect(firstWeek[0]).toBeNull();
    expect(firstWeek[1]).toBeNull();
    expect(firstWeek[2]?.date).toBe('2025-01-01');
    expect(firstWeek[6]?.date).toBe('2025-01-05');
  });

  it('rotates the first-week offset with the chosen week start', () => {
    const sundayFirst = grid({ weekStartsOn: 0 });
    const firstWeek = sundayFirst.weeks[0];

    expect(firstWeek[0]).toBeNull();
    expect(firstWeek[1]).toBeNull();
    expect(firstWeek[2]).toBeNull();
    expect(firstWeek[3]?.date).toBe('2025-01-01');
    expect(firstWeek[3]?.weekday).toBe(3);
  });

  it('leaves the trailing cells of a partial week empty', () => {
    const result = grid({ from: '2025-03-01', to: '2025-03-12', weekStartsOn: 1 });
    const lastWeek = result.weeks[result.weeks.length - 1];
    // 12 March 2025 is a Wednesday, so Thursday onwards is not in the window.
    expect(lastWeek[2]?.date).toBe('2025-03-12');
    expect(lastWeek[3]).toBeNull();
    expect(lastWeek[6]).toBeNull();
  });

  it('orders the weekday rows from the configured first day', () => {
    expect(grid({ weekStartsOn: 1 }).rows.map((row) => row.label)).toEqual([
      'Mon',
      'Tue',
      'Wed',
      'Thu',
      'Fri',
      'Sat',
      'Sun',
    ]);
    expect(grid({ weekStartsOn: 1 }).rows.map((row) => row.weekday)).toEqual([1, 2, 3, 4, 5, 6, 0]);
    expect(grid({ weekStartsOn: 0 }).rows[0]).toEqual({ weekday: 0, label: 'Sun' });
    expect(grid().labelledRows).toEqual([1, 3, 5]);
  });

  it('labels each month on the week it begins', () => {
    const result = grid();

    expect(result.months.map((month) => month.label)).toEqual(['Jan', 'Feb', 'Mar']);
    // January starts in the very first column (padded Monday/Tuesday).
    expect(result.months[0].weekIndex).toBe(0);
    // 1 Feb 2025 is a Saturday: its week starts Monday 27 January — four weeks
    // after the week of 30 December.
    expect(result.months[1].weekIndex).toBe(4);
    expect(result.weeks[4].find((cell) => cell?.date === '2025-01-27')).not.toBeNull();
    // 1 March 2025 is a Saturday too: Monday 24 February is four weeks later.
    expect(result.months[2].weekIndex).toBe(8);
  });

  it('labels a window that opens mid-month with the month it opens in', () => {
    const result = grid({ from: '2025-02-10', to: '2025-03-12' });

    expect(result.months[0]).toEqual({ label: 'Feb', weekIndex: 0 });
    expect(result.months[1].label).toBe('Mar');
  });

  it('never emits two labels for the same month in a row', () => {
    const result = grid({ from: '2024-01-01', to: '2025-03-12' });

    // Fifteen months are touched, and the labels follow one another in order.
    expect(result.months).toHaveLength(15);
    expect(result.months[0].label).toBe('Jan');
    expect(result.months[14].label).toBe('Mar');
    for (let index = 1; index < result.months.length; index += 1) {
      expect(result.months[index].weekIndex).toBeGreaterThan(result.months[index - 1].weekIndex);
    }
  });

  it('marks each cell with its entry and intensity level', () => {
    const result = grid({
      entries: { '2025-01-01': 2, '2025-02-02': 8 },
      target: 8,
    });
    const cells = result.weeks.flat().filter((cell) => cell !== null);
    const first = cells.find((cell) => cell.date === '2025-01-01');
    const full = cells.find((cell) => cell.date === '2025-02-02');

    expect(first?.count).toBe(2);
    expect(first?.level).toBe(1);
    expect(full?.count).toBe(8);
    expect(full?.level).toBe(HEATMAP_LEVELS);
    expect(cells.find((cell) => cell.date === '2025-01-03')?.level).toBe(0);
  });

  it('treats a zero or negative stored count as an empty cell', () => {
    const result = grid({ entries: { '2025-01-02': 0, '2025-01-03': -4 }, target: 1 });
    const cells = result.weeks.flat().filter((cell) => cell !== null);

    expect(cells.find((cell) => cell.date === '2025-01-02')?.count).toBeNull();
    expect(cells.find((cell) => cell.date === '2025-01-03')?.count).toBeNull();
  });

  it('walks the trailing year for a 53-week window', () => {
    const window = heatmapWindow('2025-03-12');
    expect(window.from).toBe('2024-03-13');
    expect(window.to).toBe('2025-03-12');

    const result = buildHeatmapGrid({ ...window, today: window.to, weekStartsOn: 1 });
    expect(result.weeks.length).toBeGreaterThanOrEqual(52);
    expect(result.weeks.length).toBeLessThanOrEqual(54);
    expect(HEATMAP_DAYS).toBe(365);
  });
});

describe('intensityLevel', () => {
  it('maps a count onto the four-step ramp', () => {
    expect(intensityLevel(0, 8)).toBe(0);
    expect(intensityLevel(null, 8)).toBe(0);
    expect(intensityLevel(undefined, 8)).toBe(0);
    expect(intensityLevel(1, 8)).toBe(1);
    expect(intensityLevel(2, 8)).toBe(1);
    expect(intensityLevel(3, 8)).toBe(2);
    expect(intensityLevel(6, 8)).toBe(3);
    expect(intensityLevel(8, 8)).toBe(4);
    expect(intensityLevel(20, 8)).toBe(4);
  });

  it('fills the cell for a habit with no numeric target', () => {
    expect(intensityLevel(1, 0)).toBe(HEATMAP_LEVELS);
    expect(intensityLevel(1, Number.NaN)).toBe(HEATMAP_LEVELS);
    expect(intensityLevel(0, 1)).toBe(0);
  });
});

describe('heatmapCellLabel', () => {
  it('reads as "<date>, <count> of <target> <unit>"', () => {
    expect(heatmapCellLabel('2025-03-12', 3, { target: 8, unit: 'glasses' })).toBe('12 March 2025, 3 of 8 glasses');
  });

  it('handles a boolean habit, an empty day and a combined grid', () => {
    expect(heatmapCellLabel('2025-03-12', 1, { target: 1 })).toBe('12 March 2025, done');
    expect(heatmapCellLabel('2025-03-12', 0, { target: 8 })).toBe('12 March 2025, not logged');
    expect(heatmapCellLabel('2025-03-12', 4, { noun: 'habits' })).toBe('12 March 2025, 4 habits');
    expect(heatmapCellLabel('2025-03-12', 0, { noun: 'habits' })).toBe('12 March 2025, no habits');
  });

  it('formats the leading date in long form', () => {
    expect(heatmapDateLabel('2025-03-12')).toBe('12 March 2025');
    expect(heatmapDateLabel('2025-11-01')).toBe('1 November 2025');
  });
});

describe('heatmapRangeLabel', () => {
  it('collapses a single-year range', () => {
    expect(heatmapRangeLabel('2024-03-14', '2025-03-12')).toBe('Mar 2024 – Mar 2025');
    expect(heatmapRangeLabel('2025-01-01', '2025-03-12')).toBe('Jan – Mar 2025');
  });
});

function habit(id: string, entries: Record<DateOnly, number>): Habit {
  return {
    id,
    userId: 'u1',
    name: id,
    description: null,
    icon: null,
    color: 'blue',
    goalType: 'boolean',
    goalTarget: 1,
    unit: null,
    frequency: 'daily',
    weekDays: null,
    timesPerPeriod: 1,
    startDate: '2024-01-01',
    reminderAtMs: null,
    archived: false,
    sortOrder: 'a',
    createdAt: 0,
    updatedAt: 0,
    entries,
  };
}

describe('combineHabitEntries', () => {
  it('counts how many habits were kept on each day', () => {
    const combined = combineHabitEntries([
      habit('water', { '2025-03-10': 3, '2025-03-11': 8 }),
      habit('run', { '2025-03-10': 1 }),
      habit('read', {}),
    ]);

    expect(combined.entries).toEqual({ '2025-03-10': 2, '2025-03-11': 1 });
    expect(combined.max).toBe(2);
  });

  it('ignores habits that are missing their entry map', () => {
    const bare = habit('bare', {});
    delete bare.entries;

    expect(combineHabitEntries([bare]).entries).toEqual({});
    expect(combineHabitEntries([bare]).max).toBe(0);
  });
});

describe('habitsCheckedOn', () => {
  it('returns the habits logged on a day', () => {
    const water = habit('water', { '2025-03-10': 1 });
    const run = habit('run', { '2025-03-11': 1 });

    expect(habitsCheckedOn([water, run], '2025-03-10').map((h) => h.id)).toEqual(['water']);
    expect(habitsCheckedOn([water, run], '2025-03-09')).toEqual([]);
  });
});
