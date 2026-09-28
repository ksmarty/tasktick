/**
 * The chart arithmetic, and the phase/backtest rules built on it.
 *
 * The charts themselves are SVG in a component and cannot be rendered in this
 * node environment — which is exactly why the arithmetic was split out. Every
 * case below is one that would otherwise be found by eye on a screenshot, or not
 * at all:
 *
 *  · **one point, or a metronome-perfect history** — the domain collapses to a
 *    single value, and a naive `(value - min) / (max - min)` divides by zero and
 *    paints `NaN` into every coordinate. `paddedDomain` widens it, and the tests
 *    pin the exact widened bounds rather than "not NaN", so a later change to the
 *    padding has to be deliberate.
 *  · **an empty history** — no minimum exists at all. The documented fallback is
 *    pinned here so a screen can rely on it, and the components render a sentence
 *    instead of that axis.
 *  · **the phase bar** — the four segments must cover the cycle exactly once.
 *    A gap or an overlap is invisible in a stacked bar and visible only as a day
 *    rendered in the wrong colour, so the invariant is asserted over several
 *    shapes, including the ones where the fertile window starts on day 1.
 *  · **the backtest** — the first measured cycle has no predecessor, and the
 *    error of a cycle must be measured against the cycles *before* it, with no
 *    knowledge of the future. That is the difference between an honest accuracy
 *    chart and one that flatters the model.
 */
import { describe, expect, it } from 'vitest';
import {
  backtestBars,
  barIndexAt,
  cycleFinding,
  cyclePhases,
  dayNumber,
  forecastErrors,
  forecastFinding,
  mean,
  meanAbsoluteError,
  nearestIndex,
  paddedDomain,
  phaseBars,
  phaseFinding,
  phaseForDay,
  projectIndex,
  projectXValue,
  projectY,
  seriesPath,
  seriesPoints,
  stackOffsets,
  temperatureFinding,
  DEFAULT_BLEEDING_DAYS,
  type Box,
} from '@/components/period/chart-math';

const BOX: Box = { width: 100, height: 50, inset: 10 };

/* -------------------------------------------------------------------------- */
/* scales                                                                     */
/* -------------------------------------------------------------------------- */

describe('paddedDomain', () => {
  it('never returns a zero-width domain, whatever it is given', () => {
    // An empty history has no minimum; the fallback is documented, not Infinity.
    expect(paddedDomain([])).toEqual({ min: 0, max: 1 });
    // One point, and a history where every cycle is identical: the best case for
    // the user and the case that divides by zero.
    expect(paddedDomain([28])).toEqual({ min: 27, max: 29 });
    expect(paddedDomain([28, 28, 28])).toEqual({ min: 27, max: 29 });
    // A real spread keeps a day of headroom either side, so the extreme points
    // are not drawn on the axis line.
    expect(paddedDomain([25, 27, 29])).toEqual({ min: 24, max: 30 });
  });

  it('honours an explicit pad, for the temperature series', () => {
    expect(paddedDomain([36.55], 0.15)).toEqual({ min: 36.4, max: 36.7 });
  });
});

describe('projectY / projectXValue', () => {
  const domain = { min: 24, max: 30 };

  it('puts the domain maximum at the top and the minimum at the bottom', () => {
    expect(projectY(30, domain, BOX)).toBe(10);
    expect(projectY(24, domain, BOX)).toBe(40);
    // The middle of the domain is the middle of the usable box.
    expect(projectY(27, domain, BOX)).toBe(25);
  });

  it('centres a value when the domain has no extent rather than dividing by zero', () => {
    expect(projectY(28, { min: 28, max: 28 }, BOX)).toBe(25);
    expect(projectXValue(28, { min: 28, max: 28 }, BOX)).toBe(50);
  });

  it('maps a horizontal value left to right', () => {
    expect(projectXValue(24, domain, BOX)).toBe(10);
    expect(projectXValue(30, domain, BOX)).toBe(90);
    expect(projectXValue(27, domain, BOX)).toBe(50);
  });

  it('keeps every coordinate inside the box, and rounds it for a viewBox', () => {
    for (const value of [24, 25.5, 27, 29.9, 30]) {
      const y = projectY(value, domain, BOX);
      expect(y).toBeGreaterThanOrEqual(10);
      expect(y).toBeLessThanOrEqual(40);
      expect(Number.isInteger(y * 100)).toBe(true);
    }
  });
});

describe('projectIndex', () => {
  it('centres a single point instead of pinning it to the left edge', () => {
    expect(projectIndex(0, 1, BOX)).toBe(50);
  });

  it('spreads the points across the usable width, ends on the insets', () => {
    expect(projectIndex(0, 3, BOX)).toBe(10);
    expect(projectIndex(1, 3, BOX)).toBe(50);
    expect(projectIndex(2, 3, BOX)).toBe(90);
  });

  it('is monotonic, so a line never doubles back', () => {
    const xs = Array.from({ length: 8 }, (_, index) => projectIndex(index, 8, BOX));
    expect(xs).toEqual([...xs].sort((a, b) => a - b));
  });
});

/* -------------------------------------------------------------------------- */
/* series                                                                     */
/* -------------------------------------------------------------------------- */

describe('seriesPoints / seriesPath', () => {
  it('is empty in, empty out — the case a chart is most likely to throw on', () => {
    expect(seriesPoints([], BOX)).toEqual([]);
    expect(seriesPath([])).toBe('');
  });

  it('places points oldest-left and returns a path through them', () => {
    const points = seriesPoints([28, 26], BOX);
    expect(points).toHaveLength(2);
    expect(points[0]!.x).toBe(10);
    expect(points[1]!.x).toBe(90);
    // 28 is the higher value, so it sits nearer the top of the box.
    expect(points[0]!.y).toBeLessThan(points[1]!.y);
    expect(seriesPath(points)).toBe(`M ${points[0]!.x} ${points[0]!.y} L ${points[1]!.x} ${points[1]!.y}`);
  });

  it('draws a one-point series as a move command, not a line', () => {
    const path = seriesPath(seriesPoints([28], BOX));
    expect(path).toBe('M 50 25');
    expect(path).not.toContain('L');
  });
});

describe('backtestBars', () => {
  it('puts a late cycle above the baseline and an early one below it', () => {
    const bars = backtestBars([2, -3], BOX);
    // y grows downwards, so "above the baseline" is the smaller y.
    expect(bars[0]!.y).toBeLessThan(bars[1]!.y);
    expect(bars[0]!.height).toBeGreaterThan(0);
    expect(bars[1]!.height).toBeGreaterThan(0);
  });

  it('gives an exactly-average cycle a zero-height bar rather than a missing one', () => {
    const bars = backtestBars([0], BOX);
    expect(bars).toHaveLength(1);
    expect(bars[0]!.height).toBe(0);
  });

  it('is empty in, empty out', () => {
    expect(backtestBars([], BOX)).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* hit testing                                                                */
/* -------------------------------------------------------------------------- */

describe('nearestIndex', () => {
  const positions = [10, 50, 90];

  it('picks the position a touch landed nearest, not the first or the last', () => {
    expect(nearestIndex(10, positions)).toBe(0);
    expect(nearestIndex(51, positions)).toBe(1);
    expect(nearestIndex(89, positions)).toBe(2);
    // Before the first and past the last: the edge points, not nothing.
    expect(nearestIndex(-40, positions)).toBe(0);
    expect(nearestIndex(1000, positions)).toBe(2);
  });

  it('answers a tie with the lower index, so one tap always gives one answer', () => {
    expect(nearestIndex(30, positions)).toBe(0);
    expect(nearestIndex(70, positions)).toBe(1);
  });

  it('selects the only point however far away the touch was', () => {
    // One measured cycle is a dot in the middle of the chart; a tap anywhere on
    // that chart must still read it.
    expect(nearestIndex(0, [160])).toBe(0);
    expect(nearestIndex(320, [160])).toBe(0);
  });

  it('selects the first of a set that is all one value, and nothing of an empty set', () => {
    expect(nearestIndex(50, [28, 28, 28])).toBe(0);
    expect(nearestIndex(50, [])).toBeNull();
  });

  it('never returns NaN for a pointer read before layout', () => {
    expect(nearestIndex(Number.NaN, positions)).toBe(0);
  });
});

describe('barIndexAt', () => {
  // Deliberately uneven: 5 days, 4, 6, 13 — the shape `cyclePhases` produces.
  const bars = [
    { x: 0, width: 50 },
    { x: 50, width: 40 },
    { x: 90, width: 60 },
    { x: 150, width: 130 },
  ];

  it('uses the span, not the nearest centre, so a day lands in its own segment', () => {
    // x=95 is 5 from the second bar's centre (70) and 25 from the third's (120);
    // nearest-centre would name the wrong phase.
    expect(barIndexAt(95, bars)).toBe(2);
    expect(barIndexAt(5, bars)).toBe(0);
    expect(barIndexAt(100, bars)).toBe(2);
    expect(barIndexAt(200, bars)).toBe(3);
  });

  it('includes the very last edge, so day 28 of 28 is reachable', () => {
    expect(barIndexAt(280, bars)).toBe(3);
    // ...and nothing beyond it.
    expect(barIndexAt(280.5, bars)).toBeNull();
  });

  it('selects nothing for an empty row or a touch in the gutter', () => {
    expect(barIndexAt(10, [])).toBeNull();
    expect(barIndexAt(40, [bars[1]!])).toBeNull();
    expect(barIndexAt(60, [{ x: 70, width: 0 }])).toBeNull();
  });
});

describe('stackOffsets', () => {
  it('centres a stack of repeats instead of walking it downwards', () => {
    expect(stackOffsets(1)).toEqual([0]);
    expect(stackOffsets(2)).toEqual([-2, 2]);
    expect(stackOffsets(3)).toEqual([-4, 0, 4]);
  });

  it('is symmetric, so the stack cannot drift out of the strip it sits in', () => {
    for (const count of [1, 2, 3, 4, 8]) {
      const offsets = stackOffsets(count);
      const sum = offsets.reduce((total, offset) => total + offset, 0);
      expect(Math.abs(sum)).toBeLessThan(1e-9);
    }
  });

  it('clamps to the room the strip has, so the fifth repeat is still on the dot row', () => {
    // 16-unit strip, 3-unit dots: 5 units either side of the centre.
    expect(stackOffsets(3, 4, 5)).toEqual([-4, 0, 4]);
    expect(stackOffsets(5, 4, 5)).toEqual([-5, -4, 0, 4, 5]);
    for (const offset of stackOffsets(9, 4, 5)) expect(Math.abs(offset)).toBeLessThanOrEqual(5);
  });

  it('has nothing to stack for no repeats', () => {
    expect(stackOffsets(0)).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* the finding sentences                                                      */
/* -------------------------------------------------------------------------- */

describe('cycleFinding', () => {
  const lengths = [
    { from: '2025-01-01', to: '2025-01-26', days: 26 },
    { from: '2025-01-27', to: '2025-02-23', days: 28 },
    { from: '2025-02-24', to: '2025-03-21', days: 26 },
  ];

  it('states the count, the average and the range in one sentence', () => {
    expect(cycleFinding(lengths, 26.7)).toBe('Your last 3 measured cycles averaged 26.7 days, ranging 26–28.');
  });

  it('does not claim a range when every cycle is the same length', () => {
    const flat = [
      { from: '2025-01-01', to: '2025-01-28', days: 28 },
      { from: '2025-01-29', to: '2025-02-25', days: 28 },
    ];
    expect(cycleFinding(flat, 28)).toBe('Your last 2 measured cycles averaged 28 days, every one 28 days.');
  });

  it('says so, rather than "averaged NaN days", with nothing measured', () => {
    expect(cycleFinding([], null)).toBe('No cycle has been measured yet.');
  });

  it('uses the single cycle it has when the average is missing', () => {
    expect(cycleFinding([{ from: '2025-01-01', to: '2025-01-29', days: 28 }], null)).toBe(
      'Your last 1 measured cycle averaged 28 days, every one 28 days.',
    );
  });
});

describe('forecastErrors / meanAbsoluteError / forecastFinding', () => {
  it('measures each cycle against the cycles before it, never the ones after', () => {
    const errors = forecastErrors([28, 30, 28]);
    expect(errors[0]).toEqual({ index: 0, actual: 28, predicted: null, error: null });
    // 30 against the mean of [28] = a 2-day miss.
    expect(errors[1]).toEqual({ index: 1, actual: 30, predicted: 28, error: 2 });
    // 28 against the mean of [28, 30] = 29, so -1.
    expect(errors[2]).toEqual({ index: 2, actual: 28, predicted: 29, error: -1 });
    expect(meanAbsoluteError(errors)).toBe(1.5);
  });

  it('has nothing to replay with no cycles, or with only the first one', () => {
    expect(forecastErrors([])).toEqual([]);
    expect(meanAbsoluteError([])).toBeNull();
    expect(meanAbsoluteError(forecastErrors([28]))).toBeNull();
    expect(forecastFinding(forecastErrors([28]))).toBe(
      'No cycle has a previous cycle to be measured against yet.',
    );
  });

  it('reports the average miss and the worst one, and says "backtest"', () => {
    expect(forecastFinding(forecastErrors([28, 30, 28, 33]))).toBe(
      'Backtest over 3 cycles: the average before each one was 2.4 days off, worst 4.3.',
    );
  });

  it('mean is undefined for an empty set rather than a divide by zero', () => {
    expect(mean([])).toBeNull();
  });
});

describe('temperatureFinding', () => {
  it('describes the readings, the range and the average', () => {
    expect(
      temperatureFinding([
        { date: '2025-10-01', temperatureC: 36.41 },
        { date: '2025-10-02', temperatureC: 36.62 },
      ]),
    ).toBe('2 readings, 36.4–36.6 °C, averaging 36.5 °C.');
  });

  it('handles one reading and a flat series without a fake range', () => {
    expect(temperatureFinding([{ date: '2025-10-01', temperatureC: 36.55 }])).toBe('1 reading, 36.6 °C, averaging 36.6 °C.');
    expect(
      temperatureFinding([
        { date: '2025-10-01', temperatureC: 36.5 },
        { date: '2025-10-02', temperatureC: 36.5 },
      ]),
    ).toBe('2 readings, 36.5 °C, averaging 36.5 °C.');
  });

  it('says nothing is recorded rather than drawing an axis around NaN', () => {
    expect(temperatureFinding([])).toBe('No temperature has been recorded yet.');
  });
});

/* -------------------------------------------------------------------------- */
/* the phase bar                                                              */
/* -------------------------------------------------------------------------- */

/** Every day of the cycle covered exactly once, in order. */
function expectFullCoverage(segments: ReturnType<typeof cyclePhases>, total: number) {
  const days = segments.flatMap((segment) =>
    Array.from({ length: segment.days }, (_, index) => segment.startDay + index),
  );
  expect(days).toHaveLength(total);
  expect(days).toEqual(Array.from({ length: total }, (_, index) => index + 1));

  segments.forEach((segment, index) => {
    if (index === 0) return;
    expect(segment.startDay).toBe(segments[index - 1]!.endDay + 1);
  });
}

describe('cyclePhases', () => {
  it('covers the whole cycle with no gap and no overlap', () => {
    const segments = cyclePhases({
      cycleDay: 12,
      cycleLength: 28,
      periodLength: 5,
      fertileStartDay: 10,
      fertileEndDay: 15,
    });
    expectFullCoverage(segments, 28);
    expect(segments.map((segment) => segment.phase)).toEqual(['menstrual', 'follicular', 'fertile', 'luteal']);
    expect(segments.map((segment) => [segment.startDay, segment.endDay])).toEqual([
      [1, 5],
      [6, 9],
      [10, 15],
      [16, 28],
    ]);
  });

  it('leaves out the follicular segment when the window starts right after bleeding', () => {
    const segments = cyclePhases({
      cycleDay: 6,
      cycleLength: 28,
      periodLength: 5,
      fertileStartDay: 6,
      fertileEndDay: 11,
    });
    expect(segments.map((segment) => segment.phase)).toEqual(['menstrual', 'fertile', 'luteal']);
    expectFullCoverage(segments, 28);
  });

  it('clamps a window that reaches past the predicted cycle length', () => {
    const segments = cyclePhases({
      cycleDay: 3,
      cycleLength: 21,
      periodLength: 5,
      fertileStartDay: 18,
      fertileEndDay: 26,
    });
    expectFullCoverage(segments, 21);
    expect(segments.at(-1)).toMatchObject({ phase: 'fertile', endDay: 21 });
  });

  it('never returns a segment shorter than a day, or one that starts before day 1', () => {
    const segments = cyclePhases({
      cycleDay: 1,
      cycleLength: 28,
      periodLength: 0,
      fertileStartDay: 1,
      fertileEndDay: 6,
    });
    expectFullCoverage(segments, 28);
    expect(segments[0]).toMatchObject({ phase: 'menstrual', startDay: 1, endDay: 1 });
  });

  it('falls back to a documented bleeding length when none was recorded', () => {
    const segments = cyclePhases({
      cycleDay: 2,
      cycleLength: 30,
      periodLength: null,
      fertileStartDay: null,
      fertileEndDay: null,
    });
    expect(segments[0]).toMatchObject({ phase: 'menstrual', endDay: DEFAULT_BLEEDING_DAYS });
    expectFullCoverage(segments, 30);
  });

  it('makes one honest segment when there is no fertile window to point at', () => {
    // Not "follicular + luteal": with no window there is nothing to split on, and
    // naming the second half "luteal" would be a claim nothing supports.
    const segments = cyclePhases({
      cycleDay: 9,
      cycleLength: 26,
      periodLength: 4,
      fertileStartDay: null,
      fertileEndDay: null,
    });
    expect(segments.map((segment) => segment.phase)).toEqual(['menstrual', 'follicular']);
    expectFullCoverage(segments, 26);
  });

  it('draws nothing at all rather than a nonsense bar', () => {
    const nothing = { cycleDay: null, cycleLength: null, periodLength: null, fertileStartDay: null, fertileEndDay: null };
    expect(cyclePhases(nothing)).toEqual([]);
    expect(cyclePhases({ ...nothing, cycleLength: 0 })).toEqual([]);
    expect(cyclePhases({ ...nothing, cycleLength: -28 })).toEqual([]);
    // A window that ends before it starts is not a window.
    expect(
      cyclePhases({ cycleDay: 1, cycleLength: 28, periodLength: 5, fertileStartDay: 12, fertileEndDay: 8 }).map(
        (segment) => segment.phase,
      ),
    ).toEqual(['menstrual', 'follicular']);
  });

  it('ignores a bleeding length longer than the cycle itself', () => {
    const segments = cyclePhases({
      cycleDay: 1,
      cycleLength: 20,
      periodLength: 40,
      fertileStartDay: null,
      fertileEndDay: null,
    });
    expectFullCoverage(segments, 20);
    expect(segments).toHaveLength(1);
  });
});

describe('phaseForDay / phaseFinding', () => {
  const segments = cyclePhases({
    cycleDay: 12,
    cycleLength: 28,
    periodLength: 5,
    fertileStartDay: 10,
    fertileEndDay: 15,
  });

  it('finds the segment a day falls in, and nothing outside the cycle', () => {
    expect(phaseForDay(segments, 1)?.phase).toBe('menstrual');
    expect(phaseForDay(segments, 12)?.phase).toBe('fertile');
    expect(phaseForDay(segments, 28)?.phase).toBe('luteal');
    expect(phaseForDay(segments, 29)).toBeNull();
    expect(phaseForDay(segments, null)).toBeNull();
  });

  it('names the current phase and its days, which is the paragraph it replaced', () => {
    expect(phaseFinding(segments, 12, 28)).toBe('Day 12 of 28 — fertile window (days 10–15).');
  });

  it('says there is no cycle rather than "day null of null"', () => {
    expect(phaseFinding([], null, null)).toBe('No cycle is in progress, so there is no phase to show.');
    expect(phaseFinding(segments, 4, 0)).toBe('No cycle is in progress, so there is no phase to show.');
  });
});

describe('phaseBars', () => {
  it('lays the segments end to end, filling the box exactly', () => {
    const segments = cyclePhases({
      cycleDay: 12,
      cycleLength: 28,
      periodLength: 5,
      fertileStartDay: 10,
      fertileEndDay: 15,
    });
    const bars = phaseBars(segments, 28, { width: 280, height: 26, inset: 0 });
    expect(bars[0]!.x).toBe(0);
    const last = bars.at(-1)!;
    // 28 days over 280 units is 10 units a day; the last bar must reach the edge.
    expect(last.x + last.width).toBe(280);
    bars.forEach((bar, index) => {
      if (index === 0) return;
      expect(bar.x).toBeCloseTo(bars[index - 1]!.x + bars[index - 1]!.width, 5);
    });
  });

  it('is empty for an empty phase list', () => {
    expect(phaseBars([], 0, { width: 280, height: 26 })).toEqual([]);
  });
});

describe('dayNumber', () => {
  it('counts the first day of bleeding as day 1', () => {
    expect(dayNumber('2025-10-01', '2025-10-01')).toBe(1);
    expect(dayNumber('2025-10-01', '2025-10-02')).toBe(2);
    // Across a month boundary, which is where a hand-rolled conversion breaks.
    expect(dayNumber('2025-09-28', '2025-10-01')).toBe(4);
  });

  it('returns null rather than a day before the cycle started', () => {
    expect(dayNumber('2025-10-01', '2025-09-30')).toBeNull();
    expect(dayNumber('nonsense', '2025-10-01')).toBeNull();
  });
});
