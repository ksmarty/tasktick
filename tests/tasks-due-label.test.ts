/**
 * The task row's section-aware due label.
 *
 * `dueLabel` is pure, so the two things that can be wrong are checked directly:
 * the format switches from relative-day-plus-time inside Today to the absolute
 * date everywhere else, and the overdue/today tone does not depend on which
 * format is used. Time is frozen so "today" cannot drift with the wall clock.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { absoluteDayLabel, dueLabel } from '@/components/tasks/due-label';

const ZONE = 'utc';

type DueTask = Parameters<typeof dueLabel>[0];

function task(patch: Partial<DueTask> = {}): DueTask {
  return {
    dueAtMs: null,
    dueDate: null,
    startAtMs: null,
    startDate: null,
    status: 'todo',
    isAllDay: true,
    ...patch,
  };
}

describe('dueLabel — relative inside Today, absolute outside it', () => {
  // A Monday, so the absolute labels below are checkable by hand.
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-05-12T12:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps the relative day and the clock time inside Today', () => {
    const due = dueLabel(
      task({ dueAtMs: Date.parse('2025-05-12T17:00:00Z'), isAllDay: false }),
      ZONE,
      '24h',
    );

    expect(due).toEqual({ label: 'Today 17:00', tone: 'tint', day: '2025-05-12' });
  });

  it('shows the absolute day for the same task outside Today, with no time', () => {
    const due = dueLabel(
      task({ dueAtMs: Date.parse('2025-05-12T17:00:00Z'), isAllDay: false }),
      ZONE,
      '24h',
      true,
    );

    expect(due?.label).toBe('Mon 12 May');
    expect(due?.label).not.toContain(':');
  });

  it('never prints "Tomorrow" for a row outside Today', () => {
    expect(dueLabel(task({ dueDate: '2025-05-13' }), ZONE, '24h')?.label).toBe('Tomorrow');
    expect(dueLabel(task({ dueDate: '2025-05-13' }), ZONE, '24h', true)?.label).toBe('Tue 13 May');
  });

  it('keeps the overdue tone whichever shape it takes', () => {
    const overdue = task({ dueDate: '2025-05-10' });

    expect(dueLabel(overdue, ZONE, '24h')?.tone).toBe('danger');
    expect(dueLabel(overdue, ZONE, '24h', true)?.tone).toBe('danger');
  });

  it('returns null for an undated task in either mode', () => {
    expect(dueLabel(task(), ZONE, '24h')).toBeNull();
    expect(dueLabel(task(), ZONE, '24h', true)).toBeNull();
  });
});

describe('absoluteDayLabel', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-05-12T12:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('reads "Wed 30 Sep" — weekday, day, month', () => {
    expect(absoluteDayLabel('2025-09-30', ZONE)).toBe('Tue 30 Sep');
  });

  it('adds the year only when it is not the current one', () => {
    expect(absoluteDayLabel('2026-09-30', ZONE)).toBe('Wed 30 Sep 2026');
  });
});
