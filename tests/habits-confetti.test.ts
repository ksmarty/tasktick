/**
 * The habits celebration contract.
 *
 * The confetti is fired only for the tap that *completes* a habit, so the
 * crossing rule lives in `period.ts` and is pinned here: a boolean is completed
 * by being checked (not unchecked), and a counted habit only when the amount
 * crosses its target — the tap that fills the goal, never every increment and
 * never a decrement. The page used to carry this privately, which meant the one
 * rule that decides whether a burst happens had no test.
 */
import { describe, expect, it } from 'vitest';
import { checkInCompletes } from '@/components/habits/period';
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
    reminderAtMs: null,
    archived: false,
    sortOrder: 'a',
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

describe('checkInCompletes — the crossing, not the state', () => {
  it('fires for the boolean tap that checks, never the one that un-checks', () => {
    const boolean = habit({ goalType: 'boolean', goalTarget: 1, doneToday: false });
    expect(checkInCompletes(boolean, { date: TODAY, count: 1 }, TODAY)).toBe(true);
    expect(checkInCompletes(boolean, { date: TODAY, count: null }, TODAY)).toBe(false);
  });

  it('fires only on the increment that fills a daily goal', () => {
    const daily = habit({ goalTarget: 8 });
    const at = (logged: number) => ({ ...daily, entries: { [TODAY]: logged } });

    expect(checkInCompletes(at(0), { date: TODAY, delta: 1 }, TODAY)).toBe(false);
    expect(checkInCompletes(at(6), { date: TODAY, delta: 1 }, TODAY)).toBe(false);
    expect(checkInCompletes(at(7), { date: TODAY, delta: 1 }, TODAY)).toBe(true);
    // Past the goal is not another completion.
    expect(checkInCompletes(at(8), { date: TODAY, delta: 1 }, TODAY)).toBe(false);
    // And neither is taking one back.
    expect(checkInCompletes(at(8), { date: TODAY, delta: -1 }, TODAY)).toBe(false);
    expect(checkInCompletes(at(7), { date: TODAY, delta: -1 }, TODAY)).toBe(false);
  });

  it('reads a weekly goal from the server period total', () => {
    const weekly = habit({ frequency: 'weekly', timesPerPeriod: 3, goalTarget: 3, progress: 2 / 3 });

    expect(checkInCompletes(weekly, { date: TODAY, delta: 1 }, TODAY)).toBe(true);
    // One short is not a completion; already met is not another one.
    expect(checkInCompletes({ ...weekly, progress: 1 / 3 }, { date: TODAY, delta: 1 }, TODAY)).toBe(false);
    expect(checkInCompletes({ ...weekly, progress: 1 }, { date: TODAY, delta: 1 }, TODAY)).toBe(false);
    expect(checkInCompletes({ ...weekly, progress: 1 }, { date: TODAY, delta: -1 }, TODAY)).toBe(false);
  });

  it('treats a leap straight past the target as one completion', () => {
    const weekly = habit({ frequency: 'weekly', timesPerPeriod: 3, goalTarget: 3, progress: 1 / 3 });
    expect(checkInCompletes(weekly, { date: TODAY, delta: 2 }, TODAY)).toBe(true);
  });
});
