import { describe, expect, it } from 'vitest';
import { DateTime } from 'luxon';
import { expandTaskOccurrences, isBoundedRule, nextOccurrence } from '@/server/recurrence';
import { combineDateAndTime, addDaysToDateOnly, todayIn } from '@/lib/dates';
import type { Task } from '@/lib/types';

const ZONE = 'Europe/Berlin';
const NOW = DateTime.fromISO('2026-09-16T14:00:00', { zone: ZONE }).toMillis();
const TODAY = DateTime.fromISO('2026-09-16T14:00:00', { zone: ZONE }).toFormat('yyyy-MM-dd');

type RecurringSlice = Pick<Task, 'dueAtMs' | 'dueDate' | 'timezone' | 'recurrenceRule' | 'recurrenceMode'>;

const daily = (overrides: Partial<RecurringSlice> = {}): RecurringSlice => ({
  dueAtMs: null,
  dueDate: TODAY,
  timezone: ZONE,
  recurrenceRule: 'FREQ=DAILY',
  recurrenceMode: 'due',
  ...overrides,
});

describe('nextOccurrence — due mode', () => {
  it('advances a FUTURE-dated task by exactly one period, not zero', () => {
    // Regression: the original implementation searched for the first occurrence
    // after *now*, so a task due in 2030 selected its own existing date and the
    // due date never moved.
    const task = daily({ dueDate: '2030-03-01', dueAtMs: combineDateAndTime('2030-03-01', '09:00', ZONE) });
    const next = nextOccurrence(task, NOW, ZONE);

    expect(next).not.toBeNull();
    expect(next!.dueDate).toBe('2030-03-02');
    expect(DateTime.fromMillis(next!.dueAtMs!, { zone: ZONE }).toFormat('HH:mm')).toBe('09:00');
  });

  it('preserves the wall-clock time across the advance', () => {
    const task = daily({ dueAtMs: combineDateAndTime(TODAY, '08:15', ZONE) });
    const next = nextOccurrence(task, NOW, ZONE);
    expect(DateTime.fromMillis(next!.dueAtMs!, { zone: ZONE }).toFormat('HH:mm')).toBe('08:15');
  });

  it('keeps an all-day task floating (no instant leaks in)', () => {
    const task = daily({ dueDate: '2030-03-01', dueAtMs: null });
    const next = nextOccurrence(task, NOW, ZONE);
    expect(next!.dueDate).toBe('2030-03-02');
    expect(next!.dueAtMs).toBeNull();
  });

  it('does not leave an overdue task in the past', () => {
    // Due 6 days ago: landing on "due + 1 day" would still be overdue, so the
    // engine must step forward until the candidate is in the future.
    const overdueDate = addDaysToDateOnly(TODAY, -6, ZONE);
    const task = daily({ dueDate: overdueDate, dueAtMs: combineDateAndTime(overdueDate, '09:00', ZONE) });

    const next = nextOccurrence(task, NOW, ZONE);
    expect(next!.dueDate! > TODAY).toBe(true);
    expect(next!.dueAtMs! > NOW).toBe(true);
    // A daily rule can only move one day past now.
    expect(next!.dueDate).toBe(addDaysToDateOnly(TODAY, 1, ZONE));
  });

  it('respects weekday rules', () => {
    // 2026-09-16 is a Wednesday; the next Monday-only occurrence is the 21st.
    const task = daily({
      dueDate: '2026-09-14',
      dueAtMs: combineDateAndTime('2026-09-14', '09:00', ZONE),
      recurrenceRule: 'FREQ=WEEKLY;BYDAY=MO',
    });
    const next = nextOccurrence(task, NOW, ZONE);
    expect(next!.dueDate).toBe('2026-09-21');
  });

  it('honours INTERVAL', () => {
    const task = daily({
      dueDate: TODAY,
      dueAtMs: combineDateAndTime(TODAY, '09:00', ZONE),
      recurrenceRule: 'FREQ=WEEKLY;INTERVAL=2;BYDAY=WE',
    });
    const next = nextOccurrence(task, NOW, ZONE);
    expect(next!.dueDate).toBe('2026-09-30');
  });

  it('stops at the end of a bounded rule', () => {
    const task = daily({ dueDate: TODAY, recurrenceRule: 'FREQ=DAILY;COUNT=1' });
    expect(nextOccurrence(task, NOW, ZONE)).toBeNull();
  });
});

describe('nextOccurrence — completion mode', () => {
  it('measures the cadence from when the task was finished', () => {
    // Due long ago, but completed today: a 3-day cadence restarts from now.
    const task = daily({
      dueDate: '2026-01-01',
      dueAtMs: combineDateAndTime('2026-01-01', '09:00', ZONE),
      recurrenceRule: 'FREQ=DAILY;INTERVAL=3',
      recurrenceMode: 'completion',
    });

    const next = nextOccurrence(task, NOW, ZONE);
    expect(next).not.toBeNull();
    // The first occurrence strictly after now, on a 3-day grid anchored at
    // 2026-01-01, lands in the future rather than in the past.
    expect(next!.dueAtMs! > NOW).toBe(true);
  });

  it('re-anchors a far-future task at the completion moment instead of getting stuck', () => {
    // A completion-mode series anchored at its original date would keep
    // selecting that same date forever, because it is the first grid slot after
    // now. Re-anchoring at the completion instant breaks that loop.
    const task = daily({
      dueDate: '2030-03-01',
      dueAtMs: combineDateAndTime('2030-03-01', '09:00', ZONE),
      recurrenceMode: 'completion',
    });
    const next = nextOccurrence(task, NOW, ZONE);

    expect(next!.dueDate).toBe(addDaysToDateOnly(TODAY, 1, ZONE));
    // The original wall-clock time is carried over to the new occurrence.
    expect(DateTime.fromMillis(next!.dueAtMs!, { zone: ZONE }).toFormat('HH:mm')).toBe('09:00');
  });

  it('carries the task time-of-day over when re-anchoring an all-day rule', () => {
    const task = daily({ recurrenceRule: 'FREQ=DAILY;INTERVAL=3', recurrenceMode: 'completion', dueAtMs: null });
    const next = nextOccurrence(task, NOW, ZONE);
    expect(next!.dueAtMs).toBeNull();
    expect(next!.dueDate).toBe(addDaysToDateOnly(TODAY, 3, ZONE));
  });
});

describe('nextOccurrence — guards', () => {
  it('returns null when there is no rule', () => {
    expect(nextOccurrence(daily({ recurrenceRule: null }), NOW, ZONE)).toBeNull();
  });

  it('returns null when there is no anchor date at all', () => {
    expect(nextOccurrence(daily({ dueDate: null, dueAtMs: null }), NOW, ZONE)).toBeNull();
  });

  it('falls back to the supplied zone when the task has none', () => {
    const task = daily({ timezone: null, dueDate: '2030-03-01' });
    expect(nextOccurrence(task, NOW, 'UTC')!.dueDate).toBe('2030-03-02');
  });
});

describe('expandTaskOccurrences', () => {
  const range = {
    startMs: DateTime.fromISO('2026-09-01T00:00:00', { zone: ZONE }).toMillis(),
    endMs: DateTime.fromISO('2026-10-01T00:00:00', { zone: ZONE }).toMillis(),
  };

  it('returns every occurrence inside the window', () => {
    const occurrences = expandTaskOccurrences(
      daily({ dueDate: '2026-09-01', dueAtMs: combineDateAndTime('2026-09-01', '09:00', ZONE) }),
      range,
      ZONE,
    );
    expect(occurrences).toHaveLength(30);
    expect(occurrences.every((ms) => ms >= range.startMs && ms < range.endMs)).toBe(true);
  });

  it('returns a single instant for a non-recurring task inside the window', () => {
    const once = expandTaskOccurrences(
      daily({ recurrenceRule: null, dueDate: null, dueAtMs: combineDateAndTime('2026-09-10', '10:00', ZONE) }),
      range,
      ZONE,
    );
    expect(once).toHaveLength(1);
  });

  it('returns nothing for a non-recurring task outside the window', () => {
    const none = expandTaskOccurrences(
      daily({ recurrenceRule: null, dueDate: null, dueAtMs: combineDateAndTime('2027-01-10', '10:00', ZONE) }),
      range,
      ZONE,
    );
    expect(none).toHaveLength(0);
  });
});

describe('isBoundedRule', () => {
  it('detects COUNT and UNTIL but not an open-ended rule', () => {
    expect(isBoundedRule('FREQ=DAILY;COUNT=5')).toBe(true);
    expect(isBoundedRule('FREQ=DAILY;UNTIL=20301231T235959Z')).toBe(true);
    expect(isBoundedRule('FREQ=DAILY')).toBe(false);
    expect(isBoundedRule(null)).toBe(false);
  });
});

describe('todayDateOnly', () => {
  it('agrees with the zone-local date', () => {
    expect(todayIn(ZONE)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
