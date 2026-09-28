/**
 * The cycle summary's thresholds, its trend sentence, and the dot strip's day
 * enumeration.
 *
 * The point of these tests is the *edges*: a cycle exactly on a threshold, a
 * single cycle, no cycles at all, a cycle with no recorded end, and a spread that
 * lands on the boundary. A threshold that is only tested in the middle is a
 * threshold nobody has checked, and every one of the cases below is a state a
 * real account can be in on the day the screen is opened.
 */
import { describe, expect, it } from 'vitest';
import {
  CYCLE_LENGTH_USUAL_MAX_DAYS,
  CYCLE_LENGTH_USUAL_MIN_DAYS,
  CYCLE_VARIATION_USUAL_MAX_DAYS,
  PERIOD_LENGTH_USUAL_MAX_DAYS,
  PERIOD_LENGTH_USUAL_MIN_DAYS,
  STRIP_DOT_PX,
  STRIP_GAP_PX,
  STRIP_MAX_DAYS,
  STRIP_ROW_PX,
  cycleLengthVerdict,
  cycleStripDays,
  cycleTrendSentence,
  cycleVariationVerdict,
  describeStrip,
  latestPeriodLength,
  periodLengthVerdict,
  stripAccessibleName,
  type CycleInterval,
} from '../src/lib/period-insights';

function interval(from: string, to: string, days: number): CycleInterval {
  return { from, to, days };
}

describe('the cycle-length threshold is 21–35 days, inclusive at both ends', () => {
  it('labels exactly the boundary as usual and one day past it as outside', () => {
    expect(cycleLengthVerdict(CYCLE_LENGTH_USUAL_MIN_DAYS)?.status).toBe('usual');
    expect(cycleLengthVerdict(CYCLE_LENGTH_USUAL_MAX_DAYS)?.status).toBe('usual');
    expect(cycleLengthVerdict(CYCLE_LENGTH_USUAL_MIN_DAYS - 1)?.status).toBe('outside');
    expect(cycleLengthVerdict(CYCLE_LENGTH_USUAL_MAX_DAYS + 1)?.status).toBe('outside');
  });

  it('never calls a cycle "abnormal", and states the threshold in the (i) text', () => {
    const verdict = cycleLengthVerdict(40)!;
    expect(verdict.badge).toBe('Outside the usual range');
    expect(verdict.badge.toLowerCase()).not.toContain('abnormal');
    // The claim is readable where the badge is: the range and its source.
    expect(verdict.explanation).toContain('21–35 days');
    expect(verdict.explanation).toContain('NHS');
    expect(verdict.explanation).toContain('40 days');
  });

  it('gives no badge at all when nothing has been measured', () => {
    expect(cycleLengthVerdict(null)).toBeNull();
    expect(cycleLengthVerdict(Number.NaN)).toBeNull();
  });
});

describe('the bleeding-length threshold is 2–7 days, inclusive at both ends', () => {
  it('labels the boundaries correctly', () => {
    expect(periodLengthVerdict(PERIOD_LENGTH_USUAL_MIN_DAYS)?.status).toBe('usual');
    expect(periodLengthVerdict(PERIOD_LENGTH_USUAL_MAX_DAYS)?.status).toBe('usual');
    expect(periodLengthVerdict(PERIOD_LENGTH_USUAL_MIN_DAYS - 1)?.status).toBe('outside');
    expect(periodLengthVerdict(PERIOD_LENGTH_USUAL_MAX_DAYS + 1)?.status).toBe('outside');
    expect(periodLengthVerdict(null)).toBeNull();
  });

  it('names the source in the (i) text', () => {
    expect(periodLengthVerdict(5)!.explanation).toContain('2–7 days');
    expect(periodLengthVerdict(5)!.explanation).toContain('NHS');
  });
});

describe('the variation row describes the spread, not a diagnosis', () => {
  it('treats a spread of exactly 7 days as steady and 8 as wider', () => {
    expect(cycleVariationVerdict(26, 26 + CYCLE_VARIATION_USUAL_MAX_DAYS)?.status).toBe('usual');
    expect(cycleVariationVerdict(26, 27 + CYCLE_VARIATION_USUAL_MAX_DAYS)?.status).toBe('wide');
  });

  it('says "Wider variation", not "irregular" or "abnormal"', () => {
    const verdict = cycleVariationVerdict(26, 37)!;
    expect(verdict.badge).toBe('Wider variation');
    expect(verdict.explanation).toContain('26–37 days');
    expect(verdict.explanation).toContain('11 days');
    expect(`${verdict.badge} ${verdict.explanation}`.toLowerCase()).not.toContain('abnormal');
  });

  it('has no verdict with one cycle or none — a single cycle has no spread', () => {
    expect(cycleVariationVerdict(null, null)).toBeNull();
    expect(cycleVariationVerdict(28, null)).toBeNull();
    expect(cycleVariationVerdict(null, 30)).toBeNull();
    // Zero spread is a real measurement and is steady.
    expect(cycleVariationVerdict(28, 28)?.status).toBe('usual');
  });
});

describe('the trend sentence is derived from the numbers', () => {
  it('says nothing about a trend when there is no cycle at all', () => {
    const sentence = cycleTrendSentence([]);
    expect(sentence).toContain('No complete cycle');
    expect(sentence).toContain('second period start');
  });

  it('refuses to describe a trend from one cycle, and states its length', () => {
    const sentence = cycleTrendSentence([interval('2025-06-01', '2025-06-29', 28)]);
    expect(sentence).toContain('Only one complete cycle');
    expect(sentence).toContain('28 days');
    expect(sentence).toContain('no trend');
  });

  it('reports the actual range when every cycle is inside the threshold', () => {
    const sentence = cycleTrendSentence([
      interval('2025-01-01', '2025-01-29', 28),
      interval('2025-01-29', '2025-02-26', 28),
      interval('2025-02-26', '2025-03-26', 28),
    ]);
    expect(sentence).toBe('Your last 3 complete cycles were all 28 days.');
  });

  it('states the spread and its size when the cycles differ but stay steady', () => {
    const sentence = cycleTrendSentence([
      interval('2025-01-01', '2025-01-29', 28),
      interval('2025-01-29', '2025-02-26', 28),
      interval('2025-02-26', '2025-03-27', 29),
      interval('2025-03-27', '2025-04-23', 27),
    ]);
    // Derived: 4 cycles, 27–29, a spread of 2.
    expect(sentence).toBe('Your last 4 complete cycles stayed between 27 and 29 days — a spread of 2 days.');
  });

  it('names the one long cycle, its start date and how much longer it was', () => {
    const sentence = cycleTrendSentence([
      interval('2025-01-01', '2025-01-29', 28),
      interval('2025-01-29', '2025-02-26', 28),
      interval('2025-02-26', '2025-03-26', 28),
      interval('2025-03-26', '2025-05-02', 37),
    ]);
    // Median 28, the 37 is 9 days above it.
    expect(sentence).toContain('One of your last 4 complete cycles');
    expect(sentence).toContain('26 Mar');
    expect(sentence).toContain('9 days longer');
    expect(sentence).toContain('37 days');
  });

  it('names the one short cycle too', () => {
    const sentence = cycleTrendSentence([
      interval('2025-01-01', '2025-01-29', 28),
      interval('2025-01-29', '2025-02-26', 28),
      interval('2025-02-26', '2025-03-18', 20),
    ]);
    expect(sentence).toContain('shorter');
    expect(sentence).toContain('26 Feb');
    expect(sentence).toContain('8 days');
    expect(sentence).toContain('20 days');
  });

  it('counts both directions when several cycles sit outside the threshold', () => {
    const sentence = cycleTrendSentence([
      interval('2025-01-01', '2025-01-29', 28),
      interval('2025-01-29', '2025-02-18', 20),
      interval('2025-02-18', '2025-03-18', 28),
      interval('2025-03-18', '2025-04-24', 37),
    ]);
    expect(sentence).toContain('2 of your last 4 complete cycles');
    expect(sentence).toContain('1 longer');
    expect(sentence).toContain('1 shorter');
    expect(sentence).toContain('20 to 37 days');
  });

  it('describes only the most recent window when the history is longer', () => {
    // Seven intervals; the oldest is a wild 60 that must not enter the sentence.
    const intervals = [
      interval('2024-01-01', '2024-03-01', 60),
      interval('2024-03-01', '2024-03-29', 28),
      interval('2024-03-29', '2024-04-26', 28),
      interval('2024-04-26', '2024-05-24', 28),
      interval('2024-05-24', '2024-06-21', 28),
      interval('2024-06-21', '2024-07-19', 28),
      interval('2024-07-19', '2024-08-16', 28),
    ];
    const sentence = cycleTrendSentence(intervals);
    expect(sentence).toContain('Your last 6 complete cycles');
    expect(sentence).not.toContain('60');
  });
});

describe('the dot strip enumerates one day per day of the cycle', () => {
  it('marks the recorded bleeding range and leaves the rest plain', () => {
    const days = cycleStripDays({
      startDate: '2025-07-19',
      endDate: '2025-07-23',
      lengthDays: 28,
    });
    expect(days).toHaveLength(28);
    expect(days[0]).toMatchObject({ day: 1, date: '2025-07-19', period: true, fertile: false });
    expect(days[4]).toMatchObject({ day: 5, date: '2025-07-23', period: true });
    expect(days[5]).toMatchObject({ day: 6, date: '2025-07-24', period: false });
    expect(days[27]).toMatchObject({ day: 28, date: '2025-08-15', period: false });
  });

  it('marks the fertile window only where the prediction put it', () => {
    const days = cycleStripDays({
      startDate: '2025-07-19',
      endDate: '2025-07-23',
      lengthDays: 28,
      fertileWindow: { start: '2025-07-30', end: '2025-08-04' },
    });
    expect(days.filter((day) => day.fertile).map((day) => day.day)).toEqual([12, 13, 14, 15, 16, 17]);
  });

  it('marks only the start when the bleeding end was never recorded', () => {
    // Inventing a five-day default would turn a missing log into observed data.
    const days = cycleStripDays({ startDate: '2025-07-19', endDate: null, lengthDays: 6 });
    expect(days.filter((day) => day.period).map((day) => day.day)).toEqual([1]);
  });

  it('draws the days so far for a partial cycle, and never fewer than one', () => {
    expect(cycleStripDays({ startDate: '2025-07-19', endDate: '2025-07-23', lengthDays: 6 })).toHaveLength(6);
    expect(cycleStripDays({ startDate: '2025-07-19', endDate: null, lengthDays: 0 })).toHaveLength(1);
  });

  it('does not carry a fertile window onto a cycle it was not sent for', () => {
    const days = cycleStripDays({ startDate: '2025-06-14', endDate: '2025-06-18', lengthDays: 35 });
    expect(days.some((day) => day.fertile)).toBe(false);
  });
});

describe('the strip has a text alternative, not just dots', () => {
  it('compresses consecutive days into ranges and counts the rest', () => {
    const days = cycleStripDays({
      startDate: '2025-07-19',
      endDate: '2025-07-23',
      lengthDays: 28,
      fertileWindow: { start: '2025-07-30', end: '2025-08-04' },
    });
    const text = describeStrip(days);
    expect(text).toContain('Period days 1–5.');
    expect(text).toContain('Fertile window days 12–17.');
    expect(text).toContain('17 days unmarked.');
  });

  it('says so when there is no period recorded, rather than staying silent', () => {
    const days = cycleStripDays({ startDate: '2025-07-19', endDate: null, lengthDays: 3 });
    // `endDate: null` still marks the recorded start, so remove it to reach the
    // empty case the way a gap in logging would.
    expect(describeStrip(days.map((day) => ({ ...day, period: false })))).toContain('No period days recorded.');
  });

  it('names the cycle, its length and the day detail for the accessible name', () => {
    const days = cycleStripDays({ startDate: '2025-07-19', endDate: '2025-07-23', lengthDays: 28 });
    const name = stripAccessibleName('2025-07-19', days);
    expect(name).toContain('Cycle starting 19 Jul');
    expect(name).toContain('28 days');
    expect(name).toContain('Period days 1–5.');
  });

  it('handles a single unmarked day without a stray plural', () => {
    const days = cycleStripDays({ startDate: '2025-07-19', endDate: null, lengthDays: 1 }).map((day) => ({
      ...day,
      period: false,
    }));
    expect(describeStrip(days)).toBe('No period days recorded. 1 day unmarked.');
  });
});

describe('the previous period length comes from the most recent recorded bleed', () => {
  it('is inclusive of both ends and picks the newest cycle with an end', () => {
    expect(
      latestPeriodLength([
        { startDate: '2025-05-01', endDate: '2025-05-05' },
        { startDate: '2025-06-01', endDate: '2025-06-03' },
      ]),
    ).toBe(3);
  });

  it('skips a cycle with no end rather than defaulting it', () => {
    expect(
      latestPeriodLength([
        { startDate: '2025-05-01', endDate: '2025-05-05' },
        { startDate: '2025-06-01', endDate: null },
      ]),
    ).toBe(5);
  });

  it('returns null when no bleed has an end, and when the range is impossible', () => {
    expect(latestPeriodLength([{ startDate: '2025-06-01', endDate: null }])).toBeNull();
    expect(latestPeriodLength([])).toBeNull();
    expect(latestPeriodLength([{ startDate: '2025-06-05', endDate: '2025-06-01' }])).toBeNull();
  });
});

describe('the drawn geometry fits the row it is drawn in', () => {
  it('derives the drawn-dot cap from the measured row width', () => {
    // The row is 324px at 390px; the cap is the largest count that fits it.
    const drawn = STRIP_MAX_DAYS * STRIP_DOT_PX + (STRIP_MAX_DAYS - 1) * STRIP_GAP_PX;
    expect(drawn).toBeLessThanOrEqual(STRIP_ROW_PX);
    const oneMore = (STRIP_MAX_DAYS + 1) * STRIP_DOT_PX + STRIP_MAX_DAYS * STRIP_GAP_PX;
    expect(oneMore).toBeGreaterThan(STRIP_ROW_PX);
  });
});
