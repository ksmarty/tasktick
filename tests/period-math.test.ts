/**
 * The period maths, against known cases.
 *
 * These are the cases the brief asks to be pinned: a 28-day cycle, a 35-day
 * cycle, an irregular set, a single cycle (which must not claim precision), and
 * a cycle where the luteal phase would put ovulation before the period ended
 * (which must be clamped, not nonsense). Each expected date was worked out by
 * hand from the rule in `period-math.ts`, not copied from the implementation.
 */
import { describe, expect, it } from 'vitest';
import {
  activeMethodOn,
  buildContraceptionSchedule,
  buildPeriodPrediction,
  calendarMethodDayRange,
  calendarMethodWindow,
  cycleIntervals,
  fertileWindow,
  isHormonalMethod,
  recencyWeightedMean,
  scheduledDayState,
} from '@/lib/period-math';
import type { ContraceptionMethodRecord, PeriodSettings } from '@/lib/period-types';
import { PERIOD_MOODS, PERIOD_SYMPTOMS } from '@/lib/period-types';

const settings = (overrides: Partial<PeriodSettings> = {}): PeriodSettings => ({
  enabled: true,
  predictionCycleCount: null,
  lutealPhaseDays: 14,
  contraceptionInUse: false,
  /* Both off/empty by default — see `PeriodSettings`. */
  bodySigns: false,
  hiddenTodayCategories: [],
  symptomOptions: [...PERIOD_SYMPTOMS],
  moodOptions: [...PERIOD_MOODS],
  ...overrides,
});

const cycle = (startDate: string, endDate: string | null = null) => ({ startDate, endDate });

/** Period starts `count` cycles of exactly `length` days, from `start`. */
function regularCycles(start: string, length: number, count: number) {
  const out: { startDate: string; endDate: string | null }[] = [];
  const base = new Date(`${start}T00:00:00Z`);
  for (let i = 0; i < count; i++) {
    out.push({ startDate: new Date(base.getTime() + i * length * 86_400_000).toISOString().slice(0, 10), endDate: null });
  }
  return out;
}

describe('cycle intervals', () => {
  it('measures days between consecutive starts, not cycle count', () => {
    expect(cycleIntervals(['2026-01-01', '2026-01-29', '2026-02-26'])).toEqual([28, 28]);
  });

  it('sorts and de-duplicates starts', () => {
    expect(cycleIntervals(['2026-02-26', '2026-01-01', '2026-01-29', '2026-01-29'])).toEqual([28, 28]);
  });
});

describe('28-day cycle', () => {
  const cycles = regularCycles('2026-01-01', 28, 3); // 01-01, 01-29, 02-26
  const prediction = buildPeriodPrediction({ asOf: '2026-03-01', settings: settings(), cycles, contraception: [] });

  it('predicts the next period one cycle length after the last start', () => {
    expect(prediction.dataSufficient).toBe(true);
    expect(prediction.basis.lastPeriodStart).toBe('2026-02-26');
    expect(prediction.predictedCycleLengthDays).toBe(28);
    expect(prediction.nextPeriodStart).toBe('2026-03-26');
  });

  it('estimates ovulation from the *next* period minus the luteal phase', () => {
    // 2026-03-26 − 14 = 2026-03-12. The old "day 14 of this cycle" shorthand
    // would also give 03-12 here, which is why the 30-day case below matters.
    expect(prediction.ovulationDate).toBe('2026-03-12');
    expect(prediction.ovulationClamped).toBe(false);
  });

  it('gives a six-day fertile window ending on ovulation day', () => {
    expect(prediction.fertileWindow).toEqual({ start: '2026-03-07', end: '2026-03-12' });
  });

  it('reports an uncertainty range rather than a bare date', () => {
    // Only two intervals, so the spread cannot be measured: the band falls back
    // to the documented default and says so.
    expect(prediction.uncertainty).toEqual({
      earliest: '2026-03-23',
      latest: '2026-03-29',
      days: 3,
      source: 'default',
    });
    expect(prediction.basis.confidence).toBe('medium');
  });
});

describe('35-day cycle', () => {
  const cycles = regularCycles('2026-01-01', 35, 3); // 01-01, 02-05, 03-12
  const prediction = buildPeriodPrediction({ asOf: '2026-03-20', settings: settings(), cycles, contraception: [] });

  it('uses the measured length, not 28', () => {
    expect(prediction.predictedCycleLengthDays).toBe(35);
    expect(prediction.nextPeriodStart).toBe('2026-04-16');
  });

  it('places ovulation relative to the predicted next period', () => {
    // 2026-04-16 − 14 = 2026-04-02, i.e. cycle day 22 of a 35-day cycle. A
    // "day 14" estimate would be eight days early here.
    expect(prediction.ovulationDate).toBe('2026-04-02');
    expect(prediction.fertileWindow).toEqual({ start: '2026-03-28', end: '2026-04-02' });
  });
});

describe('irregular set', () => {
  // Intervals 26, 30, 34, 28 from starts 01-01, 01-27, 02-26, 04-01, 04-29.
  const cycles = [
    cycle('2026-01-01'),
    cycle('2026-01-27'),
    cycle('2026-02-26'),
    cycle('2026-04-01'),
    cycle('2026-04-29'),
  ];
  const prediction = buildPeriodPrediction({ asOf: '2026-05-01', settings: settings(), cycles, contraception: [] });

  it('records the spread it observed', () => {
    expect(prediction.basis.usedIntervalLengths).toEqual([26, 30, 34, 28]);
    expect(prediction.basis.shortestCycleDays).toBe(26);
    expect(prediction.basis.longestCycleDays).toBe(34);
    expect(prediction.basis.standardDeviationDays).toBeCloseTo(2.96, 1);
  });

  it('weights recent cycles more than old ones', () => {
    const plainMean = 29.5;
    expect(prediction.basis.averageCycleLengthDays).toBe(plainMean);
    // The weighted estimate must stay inside the observed range and must not
    // collapse onto the plain mean — the whole point is that the recent
    // intervals (30, 34, 28) count for more than the oldest (26).
    expect(prediction.basis.recencyWeightedMeanDays!).toBeGreaterThan(26);
    expect(prediction.basis.recencyWeightedMeanDays!).toBeLessThan(34);
    expect(prediction.basis.recencyWeightedMeanDays).not.toBe(plainMean);
  });

  it('widens the range from the observed spread and marks it observed', () => {
    expect(prediction.uncertainty?.source).toBe('observed');
    expect(prediction.uncertainty?.days).toBe(3);
  });

  it('derives the Ogino–Knaus window from shortest and longest', () => {
    expect(calendarMethodDayRange(26, 34)).toEqual({ fromCycleDay: 8, toCycleDay: 23 });
    expect(prediction.calendarMethodWindow).not.toBeNull();
  });
});

describe('a single cycle is too little data', () => {
  const prediction = buildPeriodPrediction({
    asOf: '2026-01-20',
    settings: settings(),
    cycles: [cycle('2026-01-01', '2026-01-05')],
    contraception: [],
  });

  it('refuses to produce a date', () => {
    expect(prediction.dataSufficient).toBe(false);
    expect(prediction.method).toBe('insufficient_data');
    expect(prediction.nextPeriodStart).toBeNull();
    expect(prediction.ovulationDate).toBeNull();
    expect(prediction.fertileWindow).toBeNull();
    expect(prediction.uncertainty).toBeNull();
  });

  it('says why, and reports the little it does know', () => {
    expect(prediction.reason).toMatch(/Log two periods/i);
    expect(prediction.basis.confidence).toBe('none');
    expect(prediction.basis.lastPeriodStart).toBe('2026-01-01');
    expect(prediction.currentCycleDay).toBe(20);
  });
});

describe('ovulation is clamped when the luteal phase runs past the period', () => {
  // A 16-day interval with a 14-day luteal phase would place ovulation on
  // 2026-01-19, but this cycle's bleeding did not end until 2026-01-22.
  const cycles = [cycle('2026-01-01', '2026-01-05'), cycle('2026-01-17', '2026-01-22')];
  const prediction = buildPeriodPrediction({ asOf: '2026-01-18', settings: settings(), cycles, contraception: [] });

  it('clamps ovulation to the day after bleeding ended', () => {
    expect(prediction.predictedCycleLengthDays).toBe(16);
    expect(prediction.nextPeriodStart).toBe('2026-02-02');
    expect(prediction.ovulationClamped).toBe(true);
    expect(prediction.ovulationDate).toBe('2026-01-23');
  });

  it('never places ovulation before the cycle or after the next period', () => {
    expect(prediction.ovulationDate! >= '2026-01-17').toBe(true);
    expect(prediction.ovulationDate! < prediction.nextPeriodStart!).toBe(true);
    expect(prediction.fertileWindow!.start >= '2026-01-17').toBe(true);
  });

  it('explains the clamp instead of hiding it', () => {
    expect(prediction.notes.join(' ')).toMatch(/clamped/i);
  });
});

describe('fertile window shape', () => {
  it('is five days before ovulation plus ovulation day', () => {
    expect(fertileWindow('2026-03-12')).toEqual({ start: '2026-03-07', end: '2026-03-12' });
  });
});

describe('recency weighting', () => {
  it('pulls towards the newest value', () => {
    const weighted = recencyWeightedMean([20, 20, 40])!;
    const plain = 80 / 3;
    expect(weighted).toBeGreaterThan(plain);
    expect(weighted).toBeLessThan(40);
  });

  it('pulls towards a newly shortened cycle, not the old long ones', () => {
    // A trend: two 35-day cycles, then a 21-day one. The plain mean is 30.3;
    // the weighted estimate must sit clearly closer to the new value.
    const weighted = recencyWeightedMean([35, 35, 21])!;
    const plain = 91 / 3;
    expect(weighted).toBeLessThan(plain);
    expect(plain - weighted).toBeGreaterThan(1);
  });

  it('is the value itself when there is one interval', () => {
    expect(recencyWeightedMean([31])).toBe(31);
  });
});

describe('recency slice', () => {
  const cycles = regularCycles('2026-01-01', 28, 5);

  it('uses only the most recent cycles when asked', () => {
    const prediction = buildPeriodPrediction({
      asOf: '2026-05-01',
      settings: settings({ predictionCycleCount: 2 }),
      cycles,
      contraception: [],
    });
    // "the last 2 cycles" contains exactly one interval.
    expect(prediction.basis.usedIntervalLengths).toEqual([28]);
    expect(prediction.basis.confidence).toBe('low');
    expect(prediction.uncertainty?.source).toBe('default');
  });

  it('uses everything when the setting is null', () => {
    const prediction = buildPeriodPrediction({ asOf: '2026-05-01', settings: settings(), cycles, contraception: [] });
    expect(prediction.basis.usedIntervalLengths).toHaveLength(4);
    expect(prediction.basis.confidence).toBe('medium');
  });
});

describe('implausible gaps', () => {
  it('excludes a 151-day gap and says so, rather than averaging it in', () => {
    const cycles = [cycle('2026-01-01'), cycle('2026-06-01')];
    const prediction = buildPeriodPrediction({ asOf: '2026-06-02', settings: settings(), cycles, contraception: [] });
    expect(prediction.dataSufficient).toBe(false);
    expect(prediction.basis.usedIntervalLengths).toEqual([]);
    expect(prediction.notes.join(' ')).toMatch(/long gap/i);
  });
});

describe('contraception changes the meaning, not the maths', () => {
  const cycles = regularCycles('2026-01-01', 28, 3);

  it('flags a hormonal method and explains that fertility does not apply', () => {
    const contraception: Pick<ContraceptionMethodRecord, 'id' | 'method' | 'startDate' | 'endDate'>[] = [
      { id: 'm1', method: 'pill', startDate: '2026-01-01', endDate: null },
    ];
    const prediction = buildPeriodPrediction({ asOf: '2026-03-01', settings: settings(), cycles, contraception });
    expect(prediction.contraception.hormonal).toBe(true);
    expect(prediction.contraception.affectsPrediction).toBe(true);
    expect(prediction.meaning).toMatch(/calendar estimate/i);
    // The arithmetic is unchanged: the same dates as the no-method 28-day case.
    expect(prediction.nextPeriodStart).toBe('2026-03-26');
  });

  it('warns about the calendar method for a non-hormonal method', () => {
    const contraception = [{ id: 'm1', method: 'fertility_awareness' as const, startDate: '2026-01-01', endDate: null }];
    const prediction = buildPeriodPrediction({ asOf: '2026-03-01', settings: settings(), cycles, contraception });
    expect(prediction.contraception.hormonal).toBe(false);
    /*
     * The user asked for the warnings gone; what stays is the arithmetic, stated
     * without the failure-rate clause. The classification is still exercised here.
     */
    expect(prediction.meaning).toMatch(/Ovulation is/i);
    expect(prediction.meaning).not.toMatch(/24%/);
  });

  it('honours the setting even with no method row', () => {
    const prediction = buildPeriodPrediction({
      asOf: '2026-03-01',
      settings: settings({ contraceptionInUse: true }),
      cycles,
      contraception: [],
    });
    expect(prediction.contraception.inUse).toBe(true);
    expect(prediction.meaning).toMatch(/Ovulation is/i);
  });

  it('classifies methods into the two families', () => {
    expect(isHormonalMethod('ring')).toBe(true);
    expect(isHormonalMethod('patch')).toBe(true);
    expect(isHormonalMethod('copper_iud')).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* contraception schedule                                                     */
/* -------------------------------------------------------------------------- */

describe('on/off schedule', () => {
  it('is 21 on then 7 off for a 21/7 ring', () => {
    expect(scheduledDayState({ onDays: 21, offDays: 7 }, 0)).toEqual({ expected: 'on', cycleDay: 1 });
    expect(scheduledDayState({ onDays: 21, offDays: 7 }, 20)).toEqual({ expected: 'on', cycleDay: 21 });
    expect(scheduledDayState({ onDays: 21, offDays: 7 }, 21)).toEqual({ expected: 'off', cycleDay: 22 });
    expect(scheduledDayState({ onDays: 21, offDays: 7 }, 27)).toEqual({ expected: 'off', cycleDay: 28 });
    // Day 29 is the start of the next cycle.
    expect(scheduledDayState({ onDays: 21, offDays: 7 }, 28)).toEqual({ expected: 'on', cycleDay: 1 });
  });

  it('expands a window and merges what was logged', () => {
    const method = {
      id: 'm1',
      method: 'ring' as const,
      startDate: '2026-01-01',
      endDate: null,
      schedule: { onDays: 21, offDays: 7 },
    };
    const days = buildContraceptionSchedule({
      method,
      from: '2026-01-01',
      to: '2026-01-28',
      loggedByDate: new Map([['2026-01-21', 'removed' as const]]),
    });
    expect(days).toHaveLength(28);
    expect(days[0]).toMatchObject({ date: '2026-01-01', expected: 'on', cycleDay: 1, logged: null });
    expect(days[20]).toMatchObject({ date: '2026-01-21', expected: 'on', cycleDay: 21, logged: 'removed' });
    expect(days[21]).toMatchObject({ date: '2026-01-22', expected: 'off', cycleDay: 22 });
  });

  it('does not invent a plan for a method with no rhythm', () => {
    const days = buildContraceptionSchedule({
      method: { id: 'm1', method: 'copper_iud', startDate: '2026-01-01', endDate: null, schedule: null },
      from: '2026-01-01',
      to: '2026-01-28',
    });
    expect(days).toEqual([]);
  });
});

describe('active method resolution', () => {
  const methods = [
    { id: 'old', method: 'pill' as const, startDate: '2025-01-01', endDate: '2025-12-31' },
    { id: 'new', method: 'ring' as const, startDate: '2026-01-01', endDate: null },
  ];

  it('picks the method covering the date', () => {
    expect(activeMethodOn(methods, '2025-06-01')?.id).toBe('old');
    expect(activeMethodOn(methods, '2026-02-01')?.id).toBe('new');
    expect(activeMethodOn(methods, '2024-06-01')).toBeNull();
  });

  it('prefers the most recently started on an overlap', () => {
    const overlapping = [
      { id: 'a', method: 'pill' as const, startDate: '2026-01-01', endDate: null },
      { id: 'b', method: 'ring' as const, startDate: '2026-02-01', endDate: '2026-02-28' },
    ];
    expect(activeMethodOn(overlapping, '2026-02-10')?.id).toBe('b');
  });
});

describe('calendar window maths', () => {
  it('runs from shortest − 18 to longest − 11, as the Knaus–Ogino rule states', () => {
    // The worked example from the reference: cycles of 30–36 days are fertile
    // on days 12–25.
    expect(calendarMethodDayRange(30, 36)).toEqual({ fromCycleDay: 12, toCycleDay: 25 });
    expect(calendarMethodWindow('2026-01-01', 30, 36)).toEqual({ start: '2026-01-12', end: '2026-01-25' });
  });

  it('never returns a fertile day before cycle day 1', () => {
    expect(calendarMethodDayRange(15, 18)).toEqual({ fromCycleDay: 1, toCycleDay: 7 });
  });
});
