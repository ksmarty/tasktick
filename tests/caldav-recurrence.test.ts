/**
 * RRULE expansion tests. The interesting cases are all timezone cases: an
 * occurrence must keep its *wall clock* across a DST switch, which means the
 * instant between two occurrences is 167/169 hours rather than 168.
 */
import { describe, expect, it } from 'vitest';
import { DateTime } from 'luxon';
import { expandRecurrence } from '@/server/caldav';

const iso = (ms: number): string => new Date(ms).toISOString();
const localWall = (ms: number, zone: string): string =>
  DateTime.fromMillis(ms, { zone }).toFormat("yyyy-MM-dd'T'HH:mm:ss");

const NY = 'America/New_York';
/** 2024-03-02 09:00 America/New_York (EST, UTC-5). */
const WEEKLY_START = DateTime.fromObject({ year: 2024, month: 3, day: 2, hour: 9 }, { zone: NY }).toMillis();

describe('expandRecurrence', () => {
  it('keeps the wall clock across the spring-forward boundary', () => {
    const occurrences = expandRecurrence({
      rrule: 'FREQ=WEEKLY;BYDAY=SA;COUNT=4',
      startMs: WEEKLY_START,
      timezone: NY,
      durationMs: 60 * 60 * 1000,
      range: {
        startMs: DateTime.fromISO('2024-03-01T00:00:00', { zone: NY }).toMillis(),
        endMs: DateTime.fromISO('2024-04-01T00:00:00', { zone: NY }).toMillis(),
      },
    });

    expect(occurrences.map((occurrence) => iso(occurrence.startMs))).toEqual([
      '2024-03-02T14:00:00.000Z', // EST
      '2024-03-09T14:00:00.000Z', // EST, one week later (168 h)
      '2024-03-16T13:00:00.000Z', // EDT — clocks moved forward on Mar 10
      '2024-03-23T13:00:00.000Z',
    ]);

    // Every occurrence is still 09:00 local, which is the whole point.
    for (const occurrence of occurrences) expect(localWall(occurrence.startMs, NY)).toMatch(/T09:00:00$/);
    expect(occurrences[1]!.startMs - occurrences[0]!.startMs).toBe(168 * 3600_000);
    expect(occurrences[2]!.startMs - occurrences[1]!.startMs).toBe(167 * 3600_000);
    expect(occurrences.every((occurrence) => occurrence.endMs === occurrence.startMs + 3600_000)).toBe(true);

    // Matches an independent Luxon computation for the shifted occurrence.
    const expected = DateTime.fromObject({ year: 2024, month: 3, day: 16, hour: 9 }, { zone: NY }).toMillis();
    expect(occurrences[2]!.startMs).toBe(expected);
  });

  it('keeps the wall clock across the fall-back boundary', () => {
    const startMs = DateTime.fromObject({ year: 2024, month: 11, day: 1, hour: 9 }, { zone: NY }).toMillis();
    const occurrences = expandRecurrence({
      rrule: 'FREQ=DAILY;COUNT=5',
      startMs,
      timezone: NY,
      range: { startMs: startMs - 1000, endMs: startMs + 10 * 24 * 3600_000 },
    });

    expect(occurrences.map((occurrence) => iso(occurrence.startMs))).toEqual([
      '2024-11-01T13:00:00.000Z', // EDT
      '2024-11-02T13:00:00.000Z',
      '2024-11-03T14:00:00.000Z', // EST — clocks moved back at 02:00 on Nov 3
      '2024-11-04T14:00:00.000Z',
      '2024-11-05T14:00:00.000Z',
    ]);
    expect(occurrences[2]!.startMs - occurrences[1]!.startMs).toBe(25 * 3600_000);
    expect(occurrences[3]!.startMs - occurrences[2]!.startMs).toBe(24 * 3600_000);
    for (const occurrence of occurrences) expect(localWall(occurrence.startMs, NY)).toMatch(/T09:00:00$/);

    const expected = DateTime.fromObject({ year: 2024, month: 11, day: 3, hour: 9 }, { zone: NY }).toMillis();
    expect(occurrences[2]!.startMs).toBe(expected);
  });

  it('removes EXDATE occurrences whether they are floating, UTC or date-only', () => {
    const range = {
      startMs: DateTime.fromISO('2024-03-01T00:00:00', { zone: NY }).toMillis(),
      endMs: DateTime.fromISO('2024-04-01T00:00:00', { zone: NY }).toMillis(),
    };
    const base = { rrule: 'FREQ=WEEKLY;BYDAY=SA;COUNT=4', startMs: WEEKLY_START, timezone: NY, range };

    const floating = expandRecurrence({ ...base, exdates: ['20240316T090000'] });
    expect(floating.map((occurrence) => iso(occurrence.startMs))).toEqual([
      '2024-03-02T14:00:00.000Z',
      '2024-03-09T14:00:00.000Z',
      '2024-03-23T13:00:00.000Z',
    ]);

    // The same instant expressed in UTC excludes the same occurrence.
    const utc = expandRecurrence({ ...base, exdates: ['20240316T130000Z'] });
    expect(utc.map((occurrence) => iso(occurrence.startMs))).toEqual(floating.map((occurrence) => iso(occurrence.startMs)));

    // A `VALUE=DATE` EXDATE drops everything on that day.
    const byDate = expandRecurrence({ ...base, exdates: ['20240309'] });
    expect(byDate.map((occurrence) => iso(occurrence.startMs))).toEqual([
      '2024-03-02T14:00:00.000Z',
      '2024-03-16T13:00:00.000Z',
      '2024-03-23T13:00:00.000Z',
    ]);
  });

  it('adds RDATE occurrences, inheriting the start time of day for date-only values', () => {
    const occurrences = expandRecurrence({
      rrule: 'FREQ=WEEKLY;BYDAY=SA;COUNT=2',
      startMs: WEEKLY_START,
      timezone: NY,
      rdates: ['20240320T083000', '20240321'],
      range: {
        startMs: DateTime.fromISO('2024-03-01T00:00:00', { zone: NY }).toMillis(),
        endMs: DateTime.fromISO('2024-04-01T00:00:00', { zone: NY }).toMillis(),
      },
    });

    expect(occurrences.map((occurrence) => iso(occurrence.startMs))).toEqual([
      '2024-03-02T14:00:00.000Z',
      '2024-03-09T14:00:00.000Z',
      '2024-03-20T12:30:00.000Z', // 08:30 EDT
      '2024-03-21T13:00:00.000Z', // date-only RDATE → 09:00 local
    ]);
    expect(occurrences.every((occurrence) => occurrence.endMs === null)).toBe(true);
  });

  it('treats a missing or unparseable rule as a single occurrence', () => {
    expect(expandRecurrence({ rrule: null, startMs: WEEKLY_START, timezone: NY, range: { startMs: 0, endMs: 2 ** 45 } })).toEqual([
      { startMs: WEEKLY_START, endMs: null },
    ]);
    expect(
      expandRecurrence({ rrule: 'FREQ=NONSENSE', startMs: WEEKLY_START, timezone: NY, range: { startMs: 0, endMs: 2 ** 45 } }),
    ).toEqual([{ startMs: WEEKLY_START, endMs: null }]);
  });

  it('honours the half-open range window', () => {
    const occurrences = expandRecurrence({
      rrule: 'FREQ=DAILY;COUNT=10',
      startMs: WEEKLY_START,
      timezone: NY,
      range: { startMs: WEEKLY_START, endMs: WEEKLY_START + 2 * 86400_000 },
    });
    expect(occurrences.map((occurrence) => iso(occurrence.startMs))).toEqual([
      iso(WEEKLY_START),
      iso(WEEKLY_START + 86400_000),
    ]);
  });

  it('caps pathological rules with maxOccurrences', () => {
    const occurrences = expandRecurrence({
      rrule: 'FREQ=SECONDLY',
      startMs: WEEKLY_START,
      timezone: 'UTC',
      maxOccurrences: 5,
      range: { startMs: WEEKLY_START, endMs: WEEKLY_START + 30 * 86400_000 },
    });
    expect(occurrences).toHaveLength(5);
    expect(occurrences.map((occurrence) => occurrence.startMs)).toEqual([
      WEEKLY_START,
      WEEKLY_START + 1000,
      WEEKLY_START + 2000,
      WEEKLY_START + 3000,
      WEEKLY_START + 4000,
    ]);
  });

  it('respects UNTIL and treats an unknown timezone as UTC', () => {
    const until = expandRecurrence({
      rrule: 'FREQ=DAILY;UNTIL=20240305T000000Z',
      startMs: WEEKLY_START, // 2024-03-02 14:00Z
      timezone: NY,
      range: { startMs: WEEKLY_START - 3600_000, endMs: WEEKLY_START + 30 * 86400_000 },
    });
    expect(until.map((occurrence) => iso(occurrence.startMs))).toEqual([
      '2024-03-02T14:00:00.000Z',
      '2024-03-03T14:00:00.000Z',
      '2024-03-04T14:00:00.000Z',
    ]);

    const bogusZone = expandRecurrence({
      rrule: 'FREQ=DAILY;COUNT=2',
      startMs: Date.UTC(2024, 2, 2, 9, 0, 0),
      timezone: 'Mars/Olympus_Mons',
      range: { startMs: 0, endMs: 2 ** 45 },
    });
    expect(bogusZone.map((occurrence) => iso(occurrence.startMs))).toEqual([
      '2024-03-02T09:00:00.000Z',
      '2024-03-03T09:00:00.000Z',
    ]);
  });
});
