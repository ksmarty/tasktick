/**
 * Custom reminder offsets, as the event editor compiles them.
 *
 * Pure arithmetic and formatting only, so the cases a renderer cannot reach are
 * still checked: the one representation the calendar stores (minutes before the
 * occurrence), the words a custom offset reads as, which offsets need their own
 * chip rather than a preset toggle, and the 70-day bound `createEventSchema`
 * already enforces on the wire.
 */
import { describe, expect, it } from 'vitest';
import {
  MAX_REMINDER_MINUTES,
  customReminderOffsets,
  formatReminderOffset,
  reminderOffsetFrom,
} from '@/components/calendar/reminder-offset';

const PRESET_MINUTES = [0, 5, 10, 15, 30, 60, 1440];

describe('formatReminderOffset', () => {
  it('reads zero as the start rather than "0 minutes before"', () => {
    expect(formatReminderOffset(0)).toBe('At the start');
  });

  it('uses the largest whole unit that divides the offset', () => {
    expect(formatReminderOffset(45)).toBe('45 min before');
    expect(formatReminderOffset(60)).toBe('1 hour before');
    expect(formatReminderOffset(120)).toBe('2 hours before');
    expect(formatReminderOffset(1440)).toBe('1 day before');
    expect(formatReminderOffset(2880)).toBe('2 days before');
  });

  it('does not round a mixed offset up to a unit it is not', () => {
    // 90 minutes is not "1.5 hours" — the unit has to divide evenly.
    expect(formatReminderOffset(90)).toBe('90 min before');
    expect(formatReminderOffset(1505)).toBe('1505 min before');
  });
});

describe('customReminderOffsets', () => {
  it('keeps only the values the presets do not cover, in order', () => {
    expect(customReminderOffsets([1440, 45, 10, 0, 90], PRESET_MINUTES)).toEqual([45, 90]);
  });

  it('is empty when every stored offset is a preset', () => {
    expect(customReminderOffsets([0, 10, 60], PRESET_MINUTES)).toEqual([]);
  });
});

describe('reminderOffsetFrom', () => {
  it('compiles the amount into minutes before, the stored unit', () => {
    expect(reminderOffsetFrom(30, 'minutes')).toEqual({ ok: true, minutes: 30 });
    expect(reminderOffsetFrom(2, 'hours')).toEqual({ ok: true, minutes: 120 });
    expect(reminderOffsetFrom(1, 'days')).toEqual({ ok: true, minutes: 1440 });
  });

  it('accepts the 70-day boundary and refuses one day past it', () => {
    expect(reminderOffsetFrom(70, 'days')).toEqual({ ok: true, minutes: MAX_REMINDER_MINUTES });
    expect(reminderOffsetFrom(71, 'days').ok).toBe(false);
  });

  it('refuses zero, a fraction, and a missing value', () => {
    expect(reminderOffsetFrom(0, 'minutes').ok).toBe(false);
    expect(reminderOffsetFrom(-5, 'minutes').ok).toBe(false);
    expect(reminderOffsetFrom(1.5, 'hours').ok).toBe(false);
    expect(reminderOffsetFrom(Number.NaN, 'minutes').ok).toBe(false);
  });
});
