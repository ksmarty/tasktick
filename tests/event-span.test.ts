/**
 * All-day span tests.
 *
 * The exclusive end is the whole point: a one-day event runs from its start to
 * the next day. Sending the same day twice used to be stored verbatim, which
 * made the editor show an event that ended the day before it started and made
 * the calendar server receive `DTEND == DTSTART`.
 */
import { describe, expect, it } from 'vitest';
import { exclusiveDayEnd } from '@/lib/dates';
import { serializeEvent } from '@/server/caldav';

const ZONE = 'America/New_York';

describe('exclusiveDayEnd', () => {
  it('turns one day into a one-day span', () => {
    expect(exclusiveDayEnd('2026-11-01', '2026-11-01', ZONE)).toBe('2026-11-02');
  });

  it('treats a missing end as one day', () => {
    expect(exclusiveDayEnd('2026-11-01', null, ZONE)).toBe('2026-11-02');
    expect(exclusiveDayEnd('2026-11-01', undefined, ZONE)).toBe('2026-11-02');
  });

  it('keeps an end that already runs past the start', () => {
    expect(exclusiveDayEnd('2026-11-01', '2026-11-04', ZONE)).toBe('2026-11-04');
  });

  it('crosses a month and a year boundary', () => {
    expect(exclusiveDayEnd('2026-10-31', '2026-10-31', ZONE)).toBe('2026-11-01');
    expect(exclusiveDayEnd('2026-12-31', '2026-12-31', ZONE)).toBe('2027-01-01');
  });

  it('still advances by one day across a daylight-saving change', () => {
    // 2026-03-08 is the US spring-forward day: a millisecond-based +24h would
    // land on the 9th at 23:00 and format back as the 9th, not the 9th… or the
    // 8th, depending on direction. A calendar-day add has no such risk.
    expect(exclusiveDayEnd('2026-03-08', null, ZONE)).toBe('2026-03-09');
    expect(exclusiveDayEnd('2026-11-01', null, ZONE)).toBe('2026-11-02');
  });

  it('repairs an end stored before the start', () => {
    expect(exclusiveDayEnd('2026-11-01', '2026-10-31', ZONE)).toBe('2026-11-02');
  });
});

describe('the serialised event', () => {
  const allDay = (startDate: string, endDate: string | null): string =>
    serializeEvent(
      {
        uid: 'all-day@example.com',
        summary: 'Trip',
        isAllDay: true,
        startDate,
        endDate,
        timezone: ZONE,
      },
      { dtstamp: new Date('2026-10-01T12:00:00Z') },
    );

  it('writes a DTEND after the DTSTART for a one-day event', () => {
    const ics = allDay('2026-11-01', '2026-11-02');

    expect(ics).toContain('DTSTART;VALUE=DATE:20261101');
    expect(ics).toContain('DTEND;VALUE=DATE:20261102');
  });

  it('never writes DTEND equal to DTSTART', () => {
    // A zero-length all-day event is invalid (RFC 5545 3.8.2.2) and some
    // servers drop the resource, which then reads as a delete on the next pull.
    const ics = allDay('2026-11-01', null);

    expect(ics).toContain('DTEND;VALUE=DATE:20261102');
    expect(ics).not.toContain('DTEND;VALUE=DATE:20261101');
  });

  it('keeps a multi-day span intact', () => {
    const ics = allDay('2026-11-01', '2026-11-05');

    expect(ics).toContain('DTSTART;VALUE=DATE:20261101');
    expect(ics).toContain('DTEND;VALUE=DATE:20261105');
  });
});
