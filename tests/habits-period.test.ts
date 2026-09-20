/**
 * Habit period and streak presentation.
 *
 * The point of these tests is the contract: the shapes the views render are
 * derived from the server's own numbers (`streak`, `progress`, `doneToday`,
 * `entries`) and never re-computed locally.
 */
import { describe, expect, it } from 'vitest';
import {
  applyCheckInOptimistically,
  checkInChangeLabel,
  completionLabel,
  frequencySummary,
  goalSummary,
  habitProgressView,
  habitWindowRange,
  isHabitDueOn,
  longDateLabel,
  reminderLabels,
  streakLabel,
  streakUnit,
  weekStripDays,
} from '@/components/habits/period';
import type { DateOnly, Habit } from '@/lib/types';

const TODAY: DateOnly = '2025-03-12';

function habit(overrides: Partial<Habit> = {}): Habit {
  return {
    id: 'h1',
    userId: 'u1',
    name: 'Drink water',
    description: null,
    icon: 'droplets',
    color: 'cyan',
    goalType: 'count',
    goalTarget: 8,
    unit: 'glasses',
    frequency: 'daily',
    weekDays: null,
    timesPerPeriod: 1,
    startDate: '2025-01-01',
    reminders: null,
    archived: false,
    sortOrder: 'a',
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

describe('habitWindowRange', () => {
  it('starts the week, month or year at the right day and always ends today', () => {
    expect(habitWindowRange('week', TODAY, 1)).toEqual({ from: '2025-03-10', to: TODAY, label: 'This week' });
    // Sunday-first weeks put 12 March in the week that began on the 9th.
    expect(habitWindowRange('week', TODAY, 0).from).toBe('2025-03-09');
    expect(habitWindowRange('month', TODAY, 1)).toEqual({ from: '2025-03-01', to: TODAY, label: 'March to date' });
    expect(habitWindowRange('year', TODAY, 1)).toEqual({ from: '2025-01-01', to: TODAY, label: '2025 to date' });
  });
});

describe('longDateLabel', () => {
  it('spells a floating day out in full', () => {
    expect(longDateLabel('2025-03-12')).toBe('March 12 2025');
    expect(longDateLabel('2025-11-01')).toBe('November 1 2025');
  });

  it('falls back to the raw value when the day is unparseable', () => {
    expect(longDateLabel('not-a-date' as DateOnly)).toBe('not-a-date');
  });
});

describe('isHabitDueOn', () => {
  it('treats daily, weekly and monthly habits as due every day', () => {
    expect(isHabitDueOn(habit({ frequency: 'daily' }), TODAY)).toBe(true);
    expect(isHabitDueOn(habit({ frequency: 'weekly' }), TODAY)).toBe(true);
    expect(isHabitDueOn(habit({ frequency: 'monthly' }), TODAY)).toBe(true);
  });

  it('respects the weekday set for a custom habit', () => {
    const custom = habit({ frequency: 'custom', weekDays: [1, 3, 5] });
    // 12 March 2025 is a Wednesday.
    expect(isHabitDueOn(custom, '2025-03-12')).toBe(true);
    expect(isHabitDueOn(custom, '2025-03-13')).toBe(false);
    expect(isHabitDueOn(custom, '2025-03-11')).toBe(false);
  });

  it('is never due before the habit started', () => {
    expect(isHabitDueOn(habit({ startDate: '2025-04-01' }), TODAY)).toBe(false);
  });
});

describe('weekStripDays', () => {
  it('returns the seven days of the current week, oldest first', () => {
    const days = weekStripDays(habit({ weekDays: [1, 3, 5], frequency: 'custom' }), TODAY, 1);

    expect(days.map((day) => day.date)).toEqual([
      '2025-03-10',
      '2025-03-11',
      '2025-03-12',
      '2025-03-13',
      '2025-03-14',
      '2025-03-15',
      '2025-03-16',
    ]);
    expect(days.map((day) => day.initial)).toEqual(['M', 'T', 'W', 'T', 'F', 'S', 'S']);
    expect(days.filter((day) => day.due).map((day) => day.date)).toEqual(['2025-03-10', '2025-03-12', '2025-03-14']);
    expect(days.filter((day) => day.isToday).map((day) => day.date)).toEqual([TODAY]);
  });

  it('reads the logged amount straight from the entries map', () => {
    const days = weekStripDays(habit({ entries: { '2025-03-12': 3 } }), TODAY, 1);

    expect(days.find((day) => day.isToday)?.logged).toBe(3);
    expect(days.find((day) => day.date === '2025-03-11')?.logged).toBe(0);
  });
});

describe('habitProgressView', () => {
  it('shows the day\'s entry against the goal for a counted habit', () => {
    const view = habitProgressView(habit({ entries: { [TODAY]: 3 }, progress: 0.375 }), TODAY);

    expect(view.counted).toBe(true);
    expect(view.logged).toBe(3);
    expect(view.target).toBe(8);
    expect(view.label).toBe('3/8 glasses');
    expect(view.periodNoun).toBe('today');
  });

  it('falls back to the server progress when the period spans several days', () => {
    const view = habitProgressView(
      habit({ frequency: 'weekly', timesPerPeriod: 3, goalTarget: 3, entries: { '2025-03-10': 1, '2025-03-11': 1 }, progress: 2 / 3 }),
      TODAY,
    );

    expect(view.logged).toBe(2);
    expect(view.target).toBe(3);
    expect(view.label).toBe('2/3 glasses');
    expect(view.periodNoun).toBe('this week');
  });

  it('reports a boolean habit as done or not yet', () => {
    const done = habitProgressView(habit({ goalType: 'boolean', goalTarget: 1, unit: null, doneToday: true, progress: 1 }), TODAY);
    const open = habitProgressView(habit({ goalType: 'boolean', goalTarget: 1, unit: null, doneToday: false, progress: 0 }), TODAY);

    expect(done.counted).toBe(false);
    expect(done.label).toBe('Done');
    expect(open.label).toBe('Not yet');
  });

  it('reads a duration habit in its own unit', () => {
    const view = habitProgressView(
      habit({ goalType: 'duration', goalTarget: 30, unit: null, entries: { [TODAY]: 20 }, progress: 0.66 }),
      TODAY,
    );
    expect(view.label).toBe('20/30 min');
  });

  it('never exceeds the goal in the label', () => {
    const view = habitProgressView(habit({ entries: { [TODAY]: 12 }, progress: 1 }), TODAY);
    expect(view.logged).toBe(12);
    expect(view.fraction).toBe(1);
    // 12/8 glasses is the honest reading of an over-achieved day.
    expect(view.label).toBe('12/8 glasses');
  });
});

describe('streak labels', () => {
  it('uses the period the habit is measured in', () => {
    expect(streakUnit('daily')).toBe('day');
    expect(streakUnit('custom')).toBe('day');
    expect(streakUnit('weekly')).toBe('week');
    expect(streakUnit('monthly')).toBe('month');
  });

  it('pluralises and handles an empty streak', () => {
    expect(streakLabel(1, 'daily')).toBe('1 day streak');
    expect(streakLabel(5, 'weekly')).toBe('5 weeks streak');
    expect(streakLabel(0, 'daily')).toBe('No streak yet');
  });

  it('formats the completion rate the server already computed', () => {
    expect(completionLabel(0.72, 'This week')).toBe('72% completed this week');
    expect(completionLabel(0, 'This month')).toBe('Nothing completed this month');
    expect(completionLabel(undefined, '2025 to date')).toBe('No data for 2025 to date');
  });
});

describe('habit summaries', () => {
  it('describes the goal in words', () => {
    expect(goalSummary(habit())).toBe('8 glasses a day');
    expect(goalSummary(habit({ goalType: 'boolean', goalTarget: 1, unit: null }))).toBe('Once a day');
    expect(goalSummary(habit({ goalType: 'duration', goalTarget: 30, unit: null }))).toBe('30 min a day');
    expect(goalSummary(habit({ frequency: 'weekly', timesPerPeriod: 3, goalTarget: 3 }))).toBe('3 glasses a week');
  });

  it('describes the schedule in words', () => {
    expect(frequencySummary(habit({ frequency: 'daily' }))).toBe('Every day');
    expect(frequencySummary(habit({ frequency: 'weekly', timesPerPeriod: 3 }))).toBe('3× per week');
    expect(frequencySummary(habit({ frequency: 'monthly', timesPerPeriod: 2 }))).toBe('2× per month');
    expect(frequencySummary(habit({ frequency: 'custom', weekDays: [5, 1, 3] }))).toBe('Mon, Wed, Fri');
    expect(frequencySummary(habit({ frequency: 'custom', weekDays: [0, 1, 2, 3, 4, 5, 6] }))).toBe('Every day');
    expect(frequencySummary(habit({ frequency: 'custom', weekDays: null }))).toBe('Custom');
  });

  it('formats each reminder in the user\'s clock format, ascending', () => {
    const prefs = { zone: 'utc', timeFormat: '12h' as const, weekStartsOn: 1 };

    expect(reminderLabels(habit({ reminders: [450] }), prefs)).toEqual(['7:30 AM']);
    expect(reminderLabels(habit({ reminders: [450] }), { ...prefs, timeFormat: '24h' })).toEqual(['07:30']);
    // Minutes since midnight, listed in the order the server stores them.
    expect(reminderLabels(habit({ reminders: [450, 540, 1080] }), prefs)).toEqual([
      '7:30 AM',
      '9:00 AM',
      '6:00 PM',
    ]);
    expect(reminderLabels(habit(), prefs)).toEqual([]);
  });
});

describe('applyCheckInOptimistically', () => {
  it('increments the day\'s entry without touching derived fields', () => {
    const before = habit({ entries: { [TODAY]: 2 }, streak: 4, completionRate: 0.5, progress: 0.25 });
    const after = applyCheckInOptimistically(before, { date: TODAY, delta: 1 });

    expect(after.entries?.[TODAY]).toBe(3);
    expect(after.streak).toBe(4);
    expect(after.completionRate).toBe(0.5);
    expect(after.progress).toBe(0.25);
  });

  it('clears the entry when the count drops to zero', () => {
    const after = applyCheckInOptimistically(habit({ entries: { [TODAY]: 1 } }), { date: TODAY, delta: -1 });
    expect(after.entries?.[TODAY]).toBeUndefined();
  });

  it('never goes below zero', () => {
    const after = applyCheckInOptimistically(habit({ entries: {} }), { date: TODAY, delta: -1 });
    expect(after.entries).toEqual({});
  });

  it('sets doneToday for a boolean habit, which is the same statement as an entry', () => {
    const before = habit({ goalType: 'boolean', goalTarget: 1, doneToday: false, progress: 0 });
    const checked = applyCheckInOptimistically(before, { date: TODAY, count: 1 });
    const cleared = applyCheckInOptimistically(checked, { date: TODAY, count: null });

    expect(checked.doneToday).toBe(true);
    expect(checked.progress).toBe(1);
    expect(cleared.doneToday).toBe(false);
    expect(cleared.entries?.[TODAY]).toBeUndefined();
  });

  it('leaves doneToday alone for a counted habit, where only the server can judge it', () => {
    const before = habit({ doneToday: false, entries: { [TODAY]: 7 } });
    const after = applyCheckInOptimistically(before, { date: TODAY, delta: 1 });

    expect(after.entries?.[TODAY]).toBe(8);
    expect(after.doneToday).toBe(false);
  });

  it('replaces a historical entry without disturbing the others', () => {
    const after = applyCheckInOptimistically(habit({ entries: { '2025-03-10': 3 } }), { date: TODAY, count: 5 });

    expect(after.entries).toEqual({ '2025-03-10': 3, [TODAY]: 5 });
  });
});

describe('checkInChangeLabel', () => {
  it('describes a boolean toggle and a counted step', () => {
    expect(checkInChangeLabel(habit({ goalType: 'boolean' }), { date: TODAY, count: 1 })).toBe('Drink water done for today');
    expect(checkInChangeLabel(habit({ goalType: 'boolean' }), { date: TODAY, count: null })).toBe('Drink water unchecked');
    expect(checkInChangeLabel(habit(), { date: TODAY, delta: 1 })).toBe('Drink water +1');
    expect(checkInChangeLabel(habit(), { date: TODAY, delta: -1 })).toBe('Drink water -1');
  });
});
