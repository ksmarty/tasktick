/**
 * The label an all-day item carries where a clock time would go.
 *
 * Pure function only — there is no jsdom in this repo, so nothing here renders.
 * The two things that can be wrong are both arithmetic a reviewer can check by
 * hand: where the exclusive `endMs` lands the last covered day, and how a span
 * reads inside one month versus across two.
 *
 * The instants are built through `dateOnlyToMillis`, the same helper the
 * calendar screen uses, so the test cannot disagree with the app about what a
 * floating day means in a zone.
 */
import { describe, expect, it } from 'vitest';
import { allDayDateLabel } from '@/components/calendar/item-labels';
import { dateOnlyToMillis } from '@/lib/dates';
import type { CalendarItem } from '@/lib/types';

const ZONE = 'Europe/Berlin';

/** An all-day item whose exclusive end is the start of `endDate`. */
function allDay(startDate: string, endDate: string): CalendarItem {
  return {
    key: 'event:1:0',
    kind: 'event',
    id: '1',
    title: 'Trip',
    startMs: dateOnlyToMillis(startDate, ZONE),
    endMs: dateOnlyToMillis(endDate, ZONE),
    isAllDay: true,
    color: 'blue',
    calendarId: 'cal-1',
  };
}

describe('allDayDateLabel', () => {
  it('shows a single day for a one-day item', () => {
    expect(allDayDateLabel(allDay('2025-09-18', '2025-09-19'), ZONE)).toBe('18 Sep');
  });

  it('treats the exclusive end as the last day covered', () => {
    // 18th to the 20th inclusive is end = start of the 21st.
    expect(allDayDateLabel(allDay('2025-09-18', '2025-09-21'), ZONE)).toBe('18–20 Sep');
  });

  it('names both months when a span crosses one', () => {
    expect(allDayDateLabel(allDay('2025-09-30', '2025-10-03'), ZONE)).toBe('30 Sep – 2 Oct');
  });

  it('never invents a day for a degenerate zero-length item', () => {
    const start = dateOnlyToMillis('2025-09-18', ZONE);
    const item: CalendarItem = { ...allDay('2025-09-18', '2025-09-19'), startMs: start, endMs: start };
    expect(allDayDateLabel(item, ZONE)).toBe('18 Sep');
  });
});
