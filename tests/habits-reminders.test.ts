/**
 * Habit reminders: the stored shape and the editor's edge conversion.
 *
 * A habit reminder is a wall-clock time of day, so it is stored as minutes since
 * local midnight — the same `number[]` list representation the calendar already
 * uses for an event's reminders, rather than a second one. These are the two
 * pure pieces worth pinning without a renderer: how a list is normalised on the
 * way in (empty, duplicate and out-of-range cases), and the `HH:mm` <->
 * minutes round trip the editor's native time inputs depend on.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { normalizeReminderMinutes } from '@/server/repos/habits';
import { minutesToTime, timeToMinutes } from '@/components/habits/period';

const EDITOR = readFileSync(new URL('../src/components/habits/HabitEditorSheet.tsx', import.meta.url), 'utf8');

describe('normalizeReminderMinutes', () => {
  it('treats no list, an empty list and a cleared list as “no reminders”', () => {
    expect(normalizeReminderMinutes(null)).toBeNull();
    expect(normalizeReminderMinutes(undefined)).toBeNull();
    expect(normalizeReminderMinutes([])).toBeNull();
  });

  it('keeps three distinct times, sorted ascending', () => {
    expect(normalizeReminderMinutes([1080, 540, 450])).toEqual([450, 540, 1080]);
  });

  it('collapses the same time twice into one reminder', () => {
    // Two identical wall-clock times would fire together; the second copy can
    // only be a mistake, so it is dropped rather than stored twice.
    expect(normalizeReminderMinutes([540, 540, 540])).toEqual([540]);
    expect(normalizeReminderMinutes([450, 540, 450])).toEqual([450, 540]);
  });

  it('clamps each value into a single day', () => {
    expect(normalizeReminderMinutes([-5, 1500])).toEqual([0, 1439]);
  });
});

describe('the editor’s HH:mm <-> minutes edge', () => {
  it('round-trips the times a time input produces', () => {
    for (const time of ['00:00', '07:30', '09:00', '18:00', '23:59'] as const) {
      expect(minutesToTime(timeToMinutes(time))).toBe(time);
    }
  });

  it('maps midnight and the last minute to the day’s bounds', () => {
    expect(timeToMinutes('00:00')).toBe(0);
    expect(timeToMinutes('23:59')).toBe(1439);
    expect(minutesToTime(450)).toBe('07:30');
    expect(minutesToTime(1080)).toBe('18:00');
  });
});

describe('the habit editor offers an unbounded list, not one slot', () => {
  it('renders a row per reminder with its own remove control', () => {
    // The old editor had a single `type="time"` input with `id="habit-reminder"`
    // and one Clear button. The list is the fix: a row per stored time, each
    // removable on its own, plus an Add button for the next one.
    expect(EDITOR).toContain('Add reminder');
    expect(EDITOR).toContain('reminders.map((time, index) => (');
    expect(EDITOR).toContain('aria-label={`Remove reminder ${index + 1}`}');
    expect(EDITOR).not.toContain('id="habit-reminder"');
  });

  it('states that reminders are stored but never delivered', () => {
    // Nothing in this app dispatches reminders; the note must not imply one.
    expect(EDITOR).toContain('this app does not deliver reminder notifications yet');
  });
});
