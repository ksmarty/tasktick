/**
 * The task row's section-aware due label.
 *
 * `dueLabel` is pure, so the things that can be wrong are checked directly: the
 * shape switches with the section — relative day plus time in Today, the clock
 * alone in Tomorrow, the absolute date everywhere else — the clock shape covers
 * a time, a span and `All day`, and the overdue/today tone does not depend on
 * which shape is used. Time is frozen so "today" cannot drift with the wall
 * clock.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { absoluteDayLabel, clockLabel, dueLabel, taskClockLabel } from '@/components/tasks/due-label';

const ZONE = 'utc';
const PREFS = { zone: ZONE, timeFormat: '24h', weekStartsOn: 0 } as const;

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

describe('dueLabel — relative in Today, clock in Tomorrow, absolute outside both', () => {
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

  it('drops the day in Tomorrow and keeps the clock time', () => {
    // The section header says "Tomorrow"; the row's one trailing slot is worth
    // more spent on *when* than on repeating the day it is filed under.
    const due = dueLabel(
      task({ dueAtMs: Date.parse('2025-05-13T17:00:00Z'), isAllDay: false }),
      ZONE,
      '24h',
      'clock',
    );

    expect(due?.label).toBe('17:00');
    expect(due?.label).not.toContain('Tomorrow');
  });

  it('reads "All day" in Tomorrow for a task with no clock time', () => {
    expect(dueLabel(task({ dueDate: '2025-05-13' }), ZONE, '24h', 'clock')?.label).toBe('All day');
  });

  it('reads the span a task with both a start and a due occupies', () => {
    const due = dueLabel(
      task({
        startAtMs: Date.parse('2025-05-13T09:00:00Z'),
        dueAtMs: Date.parse('2025-05-13T11:00:00Z'),
        isAllDay: false,
      }),
      ZONE,
      '24h',
      'clock',
    );

    expect(due?.label).toBe('09:00 – 11:00');
  });

  it('shows the absolute day for the same task outside Today, with no time', () => {
    const due = dueLabel(
      task({ dueAtMs: Date.parse('2025-05-12T17:00:00Z'), isAllDay: false }),
      ZONE,
      '24h',
      'absolute',
    );

    expect(due?.label).toBe('Mon May 12');
    expect(due?.label).not.toContain(':');
  });

  it('never prints "Tomorrow" for a row outside Today', () => {
    expect(dueLabel(task({ dueDate: '2025-05-13' }), ZONE, '24h')?.label).toBe('Tomorrow');
    expect(dueLabel(task({ dueDate: '2025-05-13' }), ZONE, '24h', 'absolute')?.label).toBe('Tue May 13');
  });

  it('keeps the overdue tone whichever shape it takes', () => {
    const overdue = task({ dueDate: '2025-05-10' });

    expect(dueLabel(overdue, ZONE, '24h')?.tone).toBe('danger');
    expect(dueLabel(overdue, ZONE, '24h', 'absolute')?.tone).toBe('danger');
    expect(dueLabel(overdue, ZONE, '24h', 'clock')?.tone).toBe('danger');
  });

  it('returns null for an undated task in every shape', () => {
    expect(dueLabel(task(), ZONE, '24h')).toBeNull();
    expect(dueLabel(task(), ZONE, '24h', 'absolute')).toBeNull();
    expect(dueLabel(task(), ZONE, '24h', 'clock')).toBeNull();
  });
});

describe('clockLabel — a time, a span, or All day', () => {
  const at = (iso: string) => Date.parse(iso);

  it('reads "All day" for an all-day item, even though it has instants', () => {
    // An all-day event's start and end are real midnights; without this the row
    // would read "00:00 – 00:00".
    expect(clockLabel({ startMs: at('2025-05-13T00:00:00Z'), endMs: at('2025-05-14T00:00:00Z'), isAllDay: true }, PREFS)).toBe(
      'All day',
    );
  });

  it('reads a single time for an item with no end', () => {
    expect(clockLabel({ startMs: at('2025-05-13T17:00:00Z'), endMs: null, isAllDay: false }, PREFS)).toBe('17:00');
  });

  it('reads a zero-length item as a time, not as a span of no length', () => {
    const start = at('2025-05-13T17:00:00Z');
    expect(clockLabel({ startMs: start, endMs: start, isAllDay: false }, PREFS)).toBe('17:00');
  });

  it('reads the span with an en dash, and with "to" when it is spoken', () => {
    const item = { startMs: at('2025-05-13T09:00:00Z'), endMs: at('2025-05-13T10:30:00Z'), isAllDay: false };
    expect(clockLabel(item, PREFS)).toBe('09:00 – 10:30');
    // A screen reader announces a dash as punctuation; "to" is what a person says.
    expect(clockLabel(item, PREFS, 'to')).toBe('09:00 to 10:30');
  });

  it('honours the 12-hour preference', () => {
    const item = { startMs: at('2025-05-13T17:00:00Z'), endMs: at('2025-05-13T18:00:00Z'), isAllDay: false };
    expect(clockLabel(item, { ...PREFS, timeFormat: '12h' })).toBe('5:00 PM – 6:00 PM');
  });

  it('takes a task’s own span, its due time, or its start time alone', () => {
    expect(
      taskClockLabel(
        { startAtMs: at('2025-05-13T09:00:00Z'), dueAtMs: at('2025-05-13T11:00:00Z'), isAllDay: false },
        PREFS,
      ),
    ).toBe('09:00 – 11:00');
    expect(taskClockLabel({ startAtMs: null, dueAtMs: at('2025-05-13T17:00:00Z'), isAllDay: false }, PREFS)).toBe('17:00');
    expect(taskClockLabel({ startAtMs: at('2025-05-13T17:00:00Z'), dueAtMs: null, isAllDay: false }, PREFS)).toBe('17:00');
    expect(taskClockLabel({ startAtMs: null, dueAtMs: null, isAllDay: true }, PREFS)).toBe('All day');
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

  it('reads "Tue Sep 30" — weekday, month, day', () => {
    expect(absoluteDayLabel('2025-09-30', ZONE)).toBe('Tue Sep 30');
  });

  it('adds the year only when it is not the current one', () => {
    expect(absoluteDayLabel('2026-09-30', ZONE)).toBe('Wed Sep 30 2026');
  });
});
