/**
 * The colour a calendar is painted in, `colorOverride` included.
 *
 * This is the value the sidebar dot, the day sheet, the calendar-screen filter
 * chip and the settings row all use, so a bug here is "I can't change the colour
 * of this calendar" everywhere at once — which is exactly what a CalDAV
 * calendar did. Its override is stored as a palette *token* (`red`), and
 * `calendarColorHex` used to resolve only `#rrggbb` literals, then fall back to
 * the calendar's base token. A chosen colour therefore painted as blue.
 */
import { describe, expect, it } from 'vitest';
import { calendarColorHex, customCalendarHex } from '@/components/calendar/colors';
import { accentHex } from '@/lib/colors';
import type { Calendar } from '@/lib/types';

const calendar = (color: string, colorOverride: string | null): Calendar =>
  ({ color, colorOverride }) as unknown as Calendar;

describe('calendarColorHex', () => {
  it('paints the palette token a user chose for a synced calendar', () => {
    // The reported bug: the override is a token, not a literal, so it must go
    // through the accent map rather than being ignored in favour of `color`.
    expect(calendarColorHex(calendar('blue', 'red'))).toBe(accentHex('red'));
    expect(calendarColorHex(calendar('blue', 'red'))).not.toBe(accentHex('blue'));
  });

  it('paints a literal remote colour verbatim', () => {
    expect(calendarColorHex(calendar('blue', '#ff00aa'))).toBe('#ff00aa');
    expect(calendarColorHex(calendar('blue', '#f0a'))).toBe('#f0a');
  });

  it('falls back to the calendar base colour when nothing is overridden', () => {
    expect(calendarColorHex(calendar('green', null))).toBe(accentHex('green'));
  });

  it('accepts a missing calendar', () => {
    expect(calendarColorHex(null)).toBe(accentHex('blue'));
    expect(calendarColorHex(undefined)).toBe(accentHex('blue'));
  });

  it('uses the dark palette when asked', () => {
    expect(calendarColorHex(calendar('blue', 'red'), true)).toBe(accentHex('red', true));
  });
});

describe('customCalendarHex', () => {
  it('only accepts a literal colour, trimming surrounding space', () => {
    expect(customCalendarHex(' #ff00aa ')).toBe('#ff00aa');
    expect(customCalendarHex('#AABBCC')).toBe('#AABBCC');
  });

  it('rejects a palette token, which the accent map handles instead', () => {
    expect(customCalendarHex('red')).toBeNull();
    expect(customCalendarHex('')).toBeNull();
    expect(customCalendarHex(null)).toBeNull();
  });

  it('rejects text that merely starts like a colour', () => {
    expect(customCalendarHex('#ff00aa; background: red')).toBeNull();
    expect(customCalendarHex('rgb(255, 0, 170)')).toBeNull();
  });
});
