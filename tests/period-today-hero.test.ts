/**
 * The Today hero's words, and the honesty rule behind them.
 *
 * The prediction here is built by the **real** `buildPeriodPrediction` from
 * `@/lib/period-math`, not by a hand-written fixture. That matters: a fixture
 * would let `heroFor` agree with a mistake in my own understanding of the fields,
 * whereas building the prediction through the model that ships pins the resolved
 * sentences against the same numbers the API returns — ovulation, fertile window,
 * next period, uncertainty band — for a cycle history chosen so every branch of
 * the hero is reachable.
 *
 * The negative assertion at the bottom is the point of the whole module: the
 * reference's hero says "Low chance of getting pregnant", this app has no
 * conception-probability model, and no rewrite of the sentence may smuggle one in.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_PERIOD_SETTINGS } from '@/server/repos/period';
import { buildPeriodPrediction } from '@/lib/period-math';
import type { PeriodCycle, PeriodSettings } from '@/lib/period-types';
import { heroFor, periodActionFor } from '@/components/period/hero';

const AS_OF = '2026-07-20';

function settings(overrides: Partial<PeriodSettings> = {}): PeriodSettings {
  return { ...DEFAULT_PERIOD_SETTINGS, ...overrides };
}

/** A complete stored cycle row, so the fixtures hold every field the contract has. */
function cycle(overrides: Partial<PeriodCycle> & Pick<PeriodCycle, 'startDate'>): PeriodCycle {
  return {
    id: 'c1',
    userId: 'u1',
    endDate: null,
    flowIntensity: 'medium',
    notes: null,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

/** Cycles with only a start date, which is all the prediction needs. */
function cycles(...starts: string[]): Pick<PeriodCycle, 'startDate' | 'endDate'>[] {
  return starts.map((startDate) => ({ startDate, endDate: null }));
}

/**
 * Two recorded periods 28 days apart.
 *
 * Then: predicted cycle length 28 → next period 3 Aug 2026 → ovulation
 * (28 − luteal 14) on 20 July, the as-of day itself, with the fertile window
 * 15–20 July. Every date below is that arithmetic, and the assertions state the
 * resulting *words* rather than repeating the formula.
 */
const PREDICTION = buildPeriodPrediction({
  asOf: AS_OF,
  settings: settings(),
  cycles: cycles('2026-06-08', '2026-07-06'),
  contraception: [],
});

describe('the prediction the hero is fed', () => {
  it('is the one the API would return for these cycles', () => {
    expect(PREDICTION.dataSufficient).toBe(true);
    expect(PREDICTION.nextPeriodStart).toBe('2026-08-03');
    expect(PREDICTION.nextPeriodEnd).toBe('2026-08-07');
    expect(PREDICTION.ovulationDate).toBe('2026-07-20');
    expect(PREDICTION.fertileWindow).toEqual({ start: '2026-07-15', end: '2026-07-20' });
    expect(PREDICTION.uncertainty).toEqual({
      earliest: '2026-07-31',
      latest: '2026-08-06',
      days: 3,
      source: 'default',
    });
  });
});

describe('the ovulation branch', () => {
  it('counts down when ovulation is ahead', () => {
    expect(heroFor(PREDICTION, '2026-07-14')).toEqual({
      leadIn: 'Ovulation in',
      value: '6 days',
      sentence: 'Your fertile window opens tomorrow.',
    });
  });

  it('names the window it is inside, and the day it ends', () => {
    expect(heroFor(PREDICTION, '2026-07-17')).toEqual({
      leadIn: 'Ovulation in',
      value: '3 days',
      sentence: 'Inside the fertile window, which ends 20 Jul.',
    });
  });

  it('drops the "in" when ovulation is the selected day', () => {
    // The reference's own switcheroo, one level down: "Ovulation in Today" would
    // be the sentence this avoids.
    expect(heroFor(PREDICTION, '2026-07-20')).toEqual({
      leadIn: 'Ovulation',
      value: 'Today',
      sentence: 'Inside the fertile window, which ends 20 Jul.',
    });
  });
});

describe('the period branch', () => {
  it('counts down to the start and carries the range and the band', () => {
    // A bare "9 days" would read as more certain than the data: the ± is what the
    // range is measured from, and it comes from `uncertainty.days`.
    expect(heroFor(PREDICTION, '2026-07-25')).toEqual({
      leadIn: 'Period in',
      value: '9 days',
      sentence: 'Expected 3–7 Aug ± 3 days.',
    });
  });

  it('switches to the period once ovulation has passed', () => {
    const hero = heroFor(PREDICTION, '2026-07-21');
    expect(hero?.leadIn).toBe('Period in');
    expect(hero?.value).toBe('13 days');
    // The fertile window for this cycle is behind the selected day.
    expect(hero?.sentence).toBe('Expected 3–7 Aug ± 3 days.');
  });
});

describe('the cycle-day branch', () => {
  it('counts from the expected period when both estimates are behind the day', () => {
    // A week *after* the predicted period. The API anchors its estimate on today
    // and projects no second cycle, so a later date would be invented; the day of
    // the expected cycle is not.
    expect(heroFor(PREDICTION, '2026-08-10')).toEqual({
      leadIn: 'Cycle day',
      value: '8',
      sentence: 'Counting from the period expected around 3–7 Aug.',
    });
  });

  it('is what a one-period account gets, with the API’s own reason', () => {
    const thin = buildPeriodPrediction({
      asOf: AS_OF,
      settings: settings(),
      cycles: cycles('2026-07-06'),
      contraception: [],
    });
    expect(thin.dataSufficient).toBe(false);
    const hero = heroFor(thin, '2026-07-12');
    expect(hero?.leadIn).toBe('Cycle day');
    expect(hero?.value).toBe('7');
    // The sentence is the contract's `reason`, not our own paraphrase.
    expect(hero?.sentence).toBe(thin.reason);
  });

  it('says so plainly when nothing is recorded at all', () => {
    const empty = buildPeriodPrediction({ asOf: AS_OF, settings: settings(), cycles: [], contraception: [] });
    const hero = heroFor(empty, AS_OF);
    expect(hero).toEqual({ leadIn: 'No history yet', value: '—', sentence: empty.reason });
  });
});

describe('what the hero refuses to say', () => {
  const days = ['2026-07-10', '2026-07-15', '2026-07-20', '2026-07-25', '2026-08-03', '2026-08-10'];

  it('never states a probability, in any branch', () => {
    for (const day of days) {
      const hero = heroFor(PREDICTION, day);
      expect(hero?.sentence ?? '', day).not.toMatch(/%|chance|probab|likely|risk/i);
    }
  });

  it('names the fertile window rather than a chance of conceiving', () => {
    // The reference's sentence. There is no model for it in the contract, so the
    // card says what the API actually computed.
    for (const day of days) expect(heroFor(PREDICTION, day)?.sentence).not.toMatch(/pregnant/i);
    expect(heroFor(PREDICTION, '2026-07-17')?.sentence).toContain('fertile window');
  });

  it('says a fertility estimate is not meaningful under a hormonal method', () => {
    const onPill = buildPeriodPrediction({
      asOf: AS_OF,
      settings: settings({ contraceptionInUse: true }),
      cycles: cycles('2026-06-08', '2026-07-06'),
      contraception: [{ id: 'm1', method: 'pill', startDate: '2026-01-01', endDate: null }],
    });
    expect(onPill.contraception.affectsPrediction).toBe(true);
    // The ovulation branch is the one whose sentence would otherwise be read as a
    // fertility statement, so it is the one that has to correct itself.
    expect(heroFor(onPill, '2026-07-17')?.sentence).toContain('not a fertility statement');
    // The period countdown is a date, not a fertility claim, so it is unchanged.
    expect(heroFor(onPill, '2026-07-25')?.sentence).toBe('Expected 3–7 Aug ± 3 days.');
  });

  it('renders nothing at all while the prediction is still loading', () => {
    expect(heroFor(undefined, AS_OF)).toBeNull();
  });
});

describe('the card’s one period action', () => {
  it('starts a period where none is recorded', () => {
    expect(periodActionFor(null, '2026-07-20')).toEqual({ key: 'start', label: 'Log period', disabled: false });
  });

  it('closes an open period on the selected day', () => {
    const open: PeriodCycle = cycle({ startDate: '2026-07-18' });
    expect(periodActionFor(open, '2026-07-20')).toEqual({ key: 'end', label: 'Period ended', disabled: false });
  });

  it('cannot start a period twice on one day — the contract has a unique start', () => {
    const open: PeriodCycle = cycle({ startDate: '2026-07-20' });
    expect(periodActionFor(open, '2026-07-20')).toEqual({ key: 'logged', label: 'Period logged', disabled: true });
  });

  it('offers nothing to start inside a closed period either', () => {
    const closed: PeriodCycle = cycle({ startDate: '2026-07-14', endDate: '2026-07-18' });
    expect(periodActionFor(closed, '2026-07-16')).toEqual({ key: 'logged', label: 'Period logged', disabled: true });
  });
});