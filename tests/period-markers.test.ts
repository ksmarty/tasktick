/**
 * The cycle month's marks, and the date wording the period screens use.
 *
 * These are the two pure modules in the period UI, so they are the two that can
 * actually be tested rather than source-pinned. The point of testing them is that
 * the marks are the only place the client interprets the server's prediction: a
 * range that is off by a day, or an end date treated as exclusive, would paint the
 * wrong days on the month with no error anywhere.
 *
 * `dayMarks` must never *derive* a date — it only compares against the four
 * ranges the prediction carries — and these cases pin that contract from both
 * sides: a day just inside each boundary is marked, a day just outside is not.
 */
import { describe, expect, it } from 'vitest';
import { dayMarks, hasMarks, markWords, marksForDays } from '@/components/period/markers';
import { daysBetween, rangeLabel, plusMinus } from '@/components/period/labels';
import type { PeriodCycle, PeriodDayLog, PeriodOverview, PeriodPrediction } from '@/lib/period-types';

function prediction(overrides: Partial<PeriodPrediction> = {}): PeriodPrediction {
  return {
    asOf: '2025-10-01',
    dataSufficient: true,
    method: 'recency_weighted_luteal',
    reason: null,
    lastPeriodStart: '2025-09-28',
    currentCycleDay: 4,
    predictedCycleLengthDays: 29,
    nextPeriodStart: '2025-10-27',
    nextPeriodEnd: '2025-10-31',
    predictedFromLastCycle: '2025-10-27',
    overdueDays: null,
    ovulationDate: '2025-10-13',
    ovulationClamped: false,
    fertileWindow: { start: '2025-10-08', end: '2025-10-13' },
    calendarMethodWindow: { start: '2025-10-06', end: '2025-10-19' },
    uncertainty: { earliest: '2025-10-24', latest: '2025-10-30', days: 3, source: 'observed' },
    basis: {
      cycleCount: 6,
      intervalCount: 5,
      intervalLengths: [28, 29, 30, 29, 28],
      usedIntervalLengths: [29, 30, 29, 28],
      averageCycleLengthDays: 28.8,
      medianCycleLengthDays: 29,
      recencyWeightedMeanDays: 29,
      shortestCycleDays: 28,
      longestCycleDays: 30,
      standardDeviationDays: 0.8,
      lutealPhaseDays: 14,
      predictionCycleCount: null,
      confidence: 'high',
      cycleStarts: ['2025-05-01'],
      firstPeriodStart: '2025-05-01',
      lastPeriodStart: '2025-09-28',
      averagePeriodLengthDays: 5,
    },
    contraception: {
      inUse: false,
      activeMethod: null,
      activeMethodId: null,
      hormonal: false,
      affectsPrediction: false,
    },
    meaning: 'A calendar estimate only.',
    notes: [],
    ...overrides,
  };
}

function cycle(overrides: Partial<PeriodCycle>): PeriodCycle {
  return {
    id: 'c1',
    userId: 'u1',
    startDate: '2025-09-28',
    endDate: '2025-10-02',
    flowIntensity: 'medium',
    notes: null,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

function dayLog(overrides: Partial<PeriodDayLog>): PeriodDayLog {
  return {
    id: 'd1',
    userId: 'u1',
    date: '2025-10-03',
    flow: null,
    symptoms: [],
    mood: [],
    temperatureC: null,
    lhTest: null,
    mucus: null,
    intimacy: false,
    /* The column the old boolean could not carry; null is "protection not
     * stated", which is what a row written before it existed reads as. */
    intimacyProtection: null,
    ovulationPain: false,
    weightKg: null,
    notes: null,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

function overview(partial: Partial<PeriodOverview> = {}): PeriodOverview {
  return {
    settings: {
      enabled: true,
      predictionCycleCount: null,
      lutealPhaseDays: 14,
      contraceptionInUse: false,
      bodySigns: false,
      hiddenTodayCategories: [],
    },
    cycles: [cycle({})],
    dayLogs: [],
    contraception: [],
    schedule: [],
    prediction: prediction(),
    ...partial,
  };
}

describe('dayMarks', () => {
  it('marks every day of a recorded period, inclusive of both ends', () => {
    const data = overview();
    expect(dayMarks('2025-09-28', data).period).toBe(true);
    expect(dayMarks('2025-09-30', data).period).toBe(true);
    expect(dayMarks('2025-10-02', data).period).toBe(true);
    expect(dayMarks('2025-10-03', data).period).toBe(false);
    expect(dayMarks('2025-09-27', data).period).toBe(false);
  });

  it('marks only the start when a cycle has no end date', () => {
    const data = overview({ cycles: [cycle({ endDate: null })] });
    expect(dayMarks('2025-09-28', data).period).toBe(true);
    expect(dayMarks('2025-09-29', data).period).toBe(false);
  });

  it('marks a day from its own flow even with no cycle row', () => {
    const data = overview({ cycles: [], dayLogs: [dayLog({ date: '2025-10-05', flow: 'heavy' })] });
    expect(dayMarks('2025-10-05', data).period).toBe(true);
  });

  it('treats a logged "none" as not a period day, and spotting as one', () => {
    const none = overview({ cycles: [], dayLogs: [dayLog({ date: '2025-10-05', flow: 'none' })] });
    expect(dayMarks('2025-10-05', none).period).toBe(false);

    const spotting = overview({ cycles: [], dayLogs: [dayLog({ date: '2025-10-05', flow: 'spotting' })] });
    expect(dayMarks('2025-10-05', spotting).period).toBe(true);
  });

  it('marks the predicted period as a range, inclusive', () => {
    const data = overview();
    expect(dayMarks('2025-10-27', data).predicted).toBe(true);
    expect(dayMarks('2025-10-31', data).predicted).toBe(true);
    expect(dayMarks('2025-10-26', data).predicted).toBe(false);
    expect(dayMarks('2025-11-01', data).predicted).toBe(false);
  });

  it('marks the fertile window from the prediction, and ovulation inside it', () => {
    const data = overview();
    expect(dayMarks('2025-10-08', data).fertile).toBe(true);
    expect(dayMarks('2025-10-07', data).fertile).toBe(false);
    expect(dayMarks('2025-10-13', data).fertile).toBe(true);

    const ovulation = dayMarks('2025-10-13', data);
    expect(ovulation.ovulation).toBe(true);
    expect(dayMarks('2025-10-12', data).ovulation).toBe(false);
  });

  it('carries several marks at once rather than collapsing them', () => {
    // Ovulation day 13 is also inside a period-day range, and the predicted
    // window overlaps the fertile one.
    const data = overview({
      cycles: [cycle({ startDate: '2025-10-13', endDate: '2025-10-17' })],
      dayLogs: [dayLog({ date: '2025-10-13', flow: 'light' })],
    });
    const marks = dayMarks('2025-10-13', data);
    expect(marks).toEqual({ period: true, predicted: false, fertile: true, ovulation: true });
    expect(markWords(marks)).toEqual(['period day', 'estimated ovulation', 'fertile window']);
  });

  it('returns nothing at all without an overview', () => {
    const marks = dayMarks('2025-10-13', undefined);
    expect(hasMarks(marks)).toBe(false);
    expect(markWords(marks)).toEqual([]);
  });

  it('does not mark anything when the prediction is not sufficient', () => {
    const data = overview({
      cycles: [],
      prediction: prediction({
        dataSufficient: false,
        reason: 'Only one recorded cycle.',
        nextPeriodStart: null,
        nextPeriodEnd: null,
        ovulationDate: null,
        fertileWindow: null,
        uncertainty: null,
      }),
    });
    const marks = dayMarks('2025-10-13', data);
    expect(hasMarks(marks)).toBe(false);
  });

  it('builds a map for a window in one pass, including out-of-window days', () => {
    const data = overview();
    const map = marksForDays(['2025-10-07', '2025-10-08', '2025-10-13'], data);
    expect(map.get('2025-10-07')?.fertile).toBe(false);
    expect(map.get('2025-10-08')?.fertile).toBe(true);
    expect(map.get('2025-10-13')?.ovulation).toBe(true);
  });
});

describe('rangeLabel', () => {
  it('keeps the year off a range inside one month', () => {
    expect(rangeLabel('2025-10-14', '2025-10-17')).toBe('14–17 Oct');
  });

  it('names both months when the range crosses one', () => {
    expect(rangeLabel('2025-10-28', '2025-11-02')).toBe('28 Oct – 2 Nov');
  });

  it('names both years when the range crosses one', () => {
    expect(rangeLabel('2025-12-30', '2026-01-02')).toBe('30 Dec 2025 – 2 Jan 2026');
  });

  it('collapses a single day to one date', () => {
    expect(rangeLabel('2025-10-14', '2025-10-14')).toBe('14 Oct 2025');
  });
});

describe('plusMinus and daysBetween', () => {
  it('agrees with itself about a one-day band', () => {
    expect(plusMinus(1)).toBe('± 1 day');
    expect(plusMinus(3)).toBe('± 3 days');
  });

  it('counts whole floating days, across a month and a year boundary', () => {
    expect(daysBetween('2025-10-01', '2025-10-01')).toBe(0);
    expect(daysBetween('2025-10-01', '2025-10-14')).toBe(13);
    expect(daysBetween('2025-12-31', '2026-01-01')).toBe(1);
    expect(daysBetween('2025-10-14', '2025-10-01')).toBe(-13);
  });
});
