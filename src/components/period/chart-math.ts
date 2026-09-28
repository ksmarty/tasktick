/**
 * The arithmetic behind the period charts — pure, and testable without a DOM.
 *
 * ## Why this is a separate module from the components
 *
 * Every chart here is a handful of points, so it is drawn as inline SVG rather
 * than by adding a charting library. That trade is only a good one if the part
 * that can be *wrong* is separate from the part that draws: a screen coordinate
 * computed one pixel off, or a domain that collapses when every cycle is 28 days,
 * is a real bug, and it is the sort of bug nobody notices in a screenshot. So the
 * scale arithmetic, the per-cycle series, the phase segmentation and the
 * retrospective forecast error all live here as plain functions over numbers, and
 * `tests/period-charts.test.ts` pins them — including the degenerate inputs
 * (an empty history, one point, every point equal) that produce a chart nobody
 * looks at twice but which must not divide by zero.
 *
 * ## What is *not* here
 *
 * No cycle maths. Every date and every length below arrives already computed from
 * the API (`PeriodStats`, `PeriodPrediction`); the only thing this module does is
 * decide where a number sits in a box. The single exception is documented at
 * {@link cyclePhases}: converting the prediction's own fertile window into "day 6
 * of the cycle" uses the same `daysBetween` helper the UI already uses to say "in
 * 4 days", because a bar needs day offsets and the API speaks in dates.
 */

/* -------------------------------------------------------------------------- */
/* scales                                                                     */
/* -------------------------------------------------------------------------- */

/** A numeric axis: the smallest and largest value it has to show. */
export interface Domain {
  min: number;
  max: number;
}

/** The rectangle a chart draws into, in user units (the SVG's viewBox). */
export interface Box {
  width: number;
  height: number;
  /**
   * Padding inside the box, on all four sides. Charts need it for the axis
   * labels; the phase bar and the range strip pass a smaller one because their
   * labels sit below the SVG instead of inside it.
   */
  inset?: number;
}

/**
 * A domain around a set of values, always with non-zero extent.
 *
 * The two degenerate cases are the reason this exists rather than a `Math.min`/
 * `Math.max` at the call site:
 *
 *  · **an empty set** has no minimum at all. It gets the documented fallback
 *    `0..1`; callers are expected to render their "nothing recorded yet" state
 *    instead of that axis, and the test pins it so the function never returns
 *    `Infinity` into a coordinate.
 *  · **every value equal** (a metronome-perfect 28-day history, which is the
 *    *best* case for the user and the *worst* case for a chart) would divide by
 *    zero in every projection. The domain is widened by `pad` either side of the
 *    shared value, so the line sits in the middle of the box rather than on a
 *    NaN.
 */
export function paddedDomain(values: number[], pad = 1): Domain {
  // The bounds are rounded to 4dp first, because a pad of 0.15 leaves float dust
  // behind (36.55 - 0.15 is 36.400000000000006) which would otherwise be printed
  // verbatim on an axis label and written into the SVG's coordinates.
  if (values.length === 0) return { min: 0, max: 1 };
  const min = Math.min(...values);
  const max = Math.max(...values);
  return { min: clean(min - pad), max: clean(max + pad) };
}

/** Where a value sits on a vertical axis: `max` at the top, `min` at the bottom. */
export function projectY(value: number, domain: Domain, box: Box): number {
  const inset = box.inset ?? 0;
  const span = domain.max - domain.min;
  const usable = box.height - inset * 2;
  // A one-value (or empty) domain has already been widened by `paddedDomain`, but
  // a caller may hand us its own; centre the value rather than returning NaN.
  if (span <= 0) return inset + usable / 2;
  const ratio = (value - domain.min) / span;
  return round(inset + (1 - ratio) * usable);
}

/**
 * Where a value sits on a horizontal axis: `min` at the left, `max` at the right.
 *
 * Same contract as {@link projectY}; the range strip and the phase bar both need
 * the horizontal form, and one shared projection is what keeps a value's
 * position in the two of them consistent.
 */
export function projectXValue(value: number, domain: Domain, box: Box): number {
  const inset = box.inset ?? 0;
  const span = domain.max - domain.min;
  const usable = box.width - inset * 2;
  if (span <= 0) return inset + usable / 2;
  return round(inset + ((value - domain.min) / span) * usable);
}

/**
 * The x for the `index`-th of `count` evenly spaced points.
 *
 * One point is centred rather than pinned to the left edge: a single measured
 * cycle is a dot in the middle of the chart, not a dot on the axis.
 */
export function projectIndex(index: number, count: number, box: Box): number {
  const inset = box.inset ?? 0;
  const usable = box.width - inset * 2;
  if (count <= 1) return round(inset + usable / 2);
  const step = usable / (count - 1);
  return round(inset + index * step);
}

/* -------------------------------------------------------------------------- */
/* series                                                                     */
/* -------------------------------------------------------------------------- */

export interface ChartPoint {
  x: number;
  y: number;
  /** The plotted value, so a caller can label the point without re-deriving it. */
  value: number;
  index: number;
}

/** One numeric series, positioned. Empty in, empty out. */
export function seriesPoints(values: number[], box: Box, domain: Domain = paddedDomain(values)): ChartPoint[] {
  return values.map((value, index) => ({
    x: projectIndex(index, values.length, box),
    y: projectY(value, domain, box),
    value,
    index,
  }));
}

/** An SVG path through the points: `M x y L x y …`. Empty for no points. */
export function seriesPath(points: ChartPoint[]): string {
  if (points.length === 0) return '';
  const [first, ...rest] = points;
  return `M ${first!.x} ${first!.y}${rest.map((point) => ` L ${point.x} ${point.y}`).join('')}`;
}

export interface Bar {
  x: number;
  y: number;
  width: number;
  height: number;
  value: number;
  index: number;
}

/**
 * Bars from a zero baseline, for the forecast-error chart.
 *
 * The baseline is `y = 0` scaled through the domain rather than the bottom of the
 * box, because the interesting thing about a forecast error is its *sign*: an
 * early cycle and a late one must fall on opposite sides of the same line.
 */
export function backtestBars(values: number[], box: Box, domain: Domain = paddedDomain(values, 1)): Bar[] {
  const inset = box.inset ?? 0;
  const usable = box.width - inset * 2;
  const baseline = projectY(0, domain, box);
  const slot = values.length === 0 ? 0 : usable / values.length;
  const width = round(Math.max(2, slot * 0.6));
  return values.map((value, index) => {
    const y = projectY(value, domain, box);
    return {
      x: round(inset + slot * index + (slot - width) / 2),
      y: round(Math.min(y, baseline)),
      width,
      height: round(Math.abs(baseline - y)),
      value,
      index,
    };
  });
}

/* -------------------------------------------------------------------------- */
/* cycle series                                                               */
/* -------------------------------------------------------------------------- */

/** One measured cycle interval, as the API returns it. */
export interface CycleLength {
  from: string;
  to: string;
  days: number;
}

/** The plotted lengths, oldest first — a missing/short history simply has fewer. */
export function cycleLengthValues(lengths: CycleLength[]): number[] {
  return lengths.map((interval) => interval.days);
}

/** `undefined`-safe mean, for a text alternative that must never print NaN. */
export function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** One decimal, without a trailing `.0` — how the rest of the feature prints days. */
export function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * The sentence that states the chart's finding.
 *
 * This is the chart's accessible name *and* the line of text under it, which is
 * deliberate: a chart a screen reader cannot read is worse than the paragraph it
 * replaced, and the honest version of the paragraph is one sentence. Everything
 * it says is a number the API returned, and it degrades to the truth at every
 * size — no cycles, one cycle, or a history in which every cycle is the same
 * length (where "ranging 28–29" would be wrong, so the range is omitted).
 */
export function cycleFinding(lengths: CycleLength[], average: number | null): string {
  if (lengths.length === 0) return 'No cycle has been measured yet.';
  const values = cycleLengthValues(lengths);
  const count = values.length;
  const noun = count === 1 ? 'cycle' : 'cycles';
  const observedAverage = average ?? mean(values);
  const averagePart = observedAverage === null ? '' : ` averaged ${round1(observedAverage)} days`;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const spread = min === max ? `, every one ${min} days` : `, ranging ${min}–${max}`;
  return `Your last ${count} measured ${noun}${averagePart}${spread}.`;
}

/* -------------------------------------------------------------------------- */
/* where today sits                                                           */
/* -------------------------------------------------------------------------- */

export const CYCLE_PHASES = ['menstrual', 'follicular', 'fertile', 'luteal'] as const;
export type CyclePhase = (typeof CYCLE_PHASES)[number];

export const CYCLE_PHASE_LABEL: Record<CyclePhase, string> = {
  menstrual: 'Bleeding',
  follicular: 'After bleeding',
  fertile: 'Fertile window',
  luteal: 'After the window',
};

export interface PhaseSegment {
  phase: CyclePhase;
  label: string;
  /** 1-based, inclusive. */
  startDay: number;
  endDay: number;
  days: number;
}

export interface PhaseInput {
  /** `PeriodPrediction.currentCycleDay` — 1-based, or null when unknown. */
  cycleDay: number | null;
  /** `PeriodPrediction.predictedCycleLengthDays`, or null with no history. */
  cycleLength: number | null;
  /** `PeriodPrediction.basis.averagePeriodLengthDays`; a sane default when absent. */
  periodLength: number | null;
  /** 1-based day the fertile window starts, or null when there is no window. */
  fertileStartDay: number | null;
  fertileEndDay: number | null;
}

/** The assumed bleeding length when the user has not recorded an end date. */
export const DEFAULT_BLEEDING_DAYS = 5;

/**
 * The cycle split into contiguous phases, by day number.
 *
 * Four segments that between them cover days `1..cycleLength` exactly once, with
 * no gaps and no overlaps — the test asserts that invariant, because a bar with a
 * hole in it is how "day 14 of 28" ends up rendered in the wrong colour.
 *
 * The values are the API's: `currentCycleDay`, `predictedCycleLengthDays`, the
 * fertile window and the average bleeding length. The *only* conversion is that
 * the fertile window arrives as two dates and a bar needs day numbers, so the
 * caller computes `daysBetween(lastPeriodStart, fertileWindow.start) + 1` with the
 * same helper the screen uses for "in 4 days". Nothing here derives a date.
 *
 * Degenerate inputs return an empty list rather than a nonsense bar: no cycle
 * length (nothing recorded), a cycle length of zero or less, or a fertile window
 * that ends before it starts. "Nothing to draw" is a state the component renders
 * as text.
 */
export function cyclePhases(input: PhaseInput): PhaseSegment[] {
  const total = Math.floor(input.cycleLength ?? 0);
  if (total < 1) return [];

  const clamp = (day: number) => Math.min(total, Math.max(1, Math.floor(day)));
  const bleedingEnd = clamp(input.periodLength ?? DEFAULT_BLEEDING_DAYS);

  const hasWindow =
    input.fertileStartDay !== null &&
    input.fertileEndDay !== null &&
    input.fertileEndDay >= input.fertileStartDay &&
    clamp(input.fertileStartDay) <= total;

  const fertileStart = hasWindow ? Math.max(bleedingEnd + 1, clamp(input.fertileStartDay!)) : null;
  const fertileEnd = hasWindow ? clamp(input.fertileEndDay!) : null;
  /*
   * A window that lands entirely inside the bleeding days is not representable on
   * a bar of four phases, and overlapping the menstrual segment would put the
   * same day in two segments — which is how a bar ends up one day longer than the
   * cycle. The window is dropped instead, and the rest of the cycle becomes one
   * honest segment.
   */
  const windowFits = fertileStart !== null && fertileEnd !== null && fertileEnd >= fertileStart && fertileStart <= total;

  const segments: PhaseSegment[] = [];
  const push = (phase: CyclePhase, startDay: number, endDay: number) => {
    if (endDay < startDay) return;
    segments.push({
      phase,
      label: CYCLE_PHASE_LABEL[phase],
      startDay,
      endDay,
      days: endDay - startDay + 1,
    });
  };

  push('menstrual', 1, bleedingEnd);
  if (windowFits && fertileStart !== null && fertileEnd !== null) {
    push('follicular', bleedingEnd + 1, fertileStart - 1);
    push('fertile', fertileStart, fertileEnd);
    push('luteal', fertileEnd + 1, total);
  } else {
    // No fertile window to point at (too little history, or a hormonal method
    // that made the window meaningless): the rest of the cycle is one segment,
    // and calling it "follicular" would be a claim the data does not support.
    push('follicular', bleedingEnd + 1, total);
  }

  return segments;
}

/** The segment `day` falls in, or null when the day is outside the cycle. */
export function phaseForDay(segments: PhaseSegment[], day: number | null): PhaseSegment | null {
  if (day === null) return null;
  return segments.find((segment) => day >= segment.startDay && day <= segment.endDay) ?? null;
}

/* -------------------------------------------------------------------------- */
/* retrospective accuracy                                                     */
/* -------------------------------------------------------------------------- */

export interface ForecastError {
  index: number;
  /** The cycle that actually happened. */
  actual: number;
  /** The mean of the cycles before it, or null for the first cycle. */
  predicted: number | null;
  /** `actual - predicted`, or null for the first cycle (nothing preceded it). */
  error: number | null;
}

/**
 * How far each cycle landed from what the cycles before it would have predicted.
 *
 * A **backtest**, and labelled as one wherever it is shown: the server stores no
 * past predictions, so "how accurate was the prediction" can only be answered by
 * replaying a rule over the recorded history. The rule used here is deliberately
 * the simplest defensible one — the mean of the cycles *before* each one, with no
 * knowledge of the future and no recency weighting — because the point of the
 * chart is to show the user the *size* of the miss they can expect. A model that
 * looked smarter than the API's own would be a second, disagreeing prediction.
 *
 * The first measured interval has nothing before it and gets `predicted: null`;
 * the chart skips it rather than plotting a made-up zero.
 */
export function forecastErrors(values: number[]): ForecastError[] {
  return values.map((actual, index) => {
    if (index === 0) return { index, actual, predicted: null, error: null };
    const predicted = mean(values.slice(0, index));
    if (predicted === null) return { index, actual, predicted: null, error: null };
    // The error is measured against the *unrounded* mean: rounding first would
    // add up to half a day of error the model never made.
    return { index, actual, predicted: round1(predicted), error: round1(actual - predicted) };
  });
}

/** The mean absolute backtest error, or null when there is nothing to replay. */
export function meanAbsoluteError(errors: ForecastError[]): number | null {
  const measured = errors.map((entry) => entry.error).filter((error): error is number => error !== null);
  if (measured.length === 0) return null;
  return round1(mean(measured.map(Math.abs))!);
}

/**
 * The sentence for the accuracy chart.
 *
 * Says "backtest" out loud and never claims the model is good: it reports the
 * average miss and the worst one, and when there is nothing to replay it says so
 * rather than showing a confident zero.
 */
export function forecastFinding(errors: ForecastError[]): string {
  const measured = errors.filter((entry) => entry.error !== null);
  const average = meanAbsoluteError(errors);
  if (average === null) return 'No cycle has a previous cycle to be measured against yet.';
  const worst = round1(Math.max(...measured.map((entry) => Math.abs(entry.error!))));
  const count = measured.length;
  return `Backtest over ${count} ${count === 1 ? 'cycle' : 'cycles'}: the average before each one was ${average} days off, worst ${worst}.`;
}

/* -------------------------------------------------------------------------- */
/* geometry for the bar-shaped charts                                         */
/* -------------------------------------------------------------------------- */

export interface SegmentBar {
  phase: CyclePhase;
  label: string;
  x: number;
  width: number;
  /** `1..total`, for the legend. */
  startDay: number;
  endDay: number;
  days: number;
}

/**
 * The phase segments laid out along a horizontal bar, day 1 at the left.
 *
 * The domain is `1..total + 1` so that the last day's bar ends exactly at the
 * right edge of the box rather than one day short of it — the off-by-one that
 * makes a 28-day bar look like a 27-day one.
 */
export function phaseBars(segments: PhaseSegment[], total: number, box: Box): SegmentBar[] {
  if (total < 1) return [];
  const domain: Domain = { min: 1, max: total + 1 };
  return segments.map((segment) => {
    const left = projectXValue(segment.startDay, domain, box);
    const right = projectXValue(segment.endDay + 1, domain, box);
    return {
      phase: segment.phase,
      label: segment.label,
      x: left,
      width: round(Math.max(1, right - left)),
      startDay: segment.startDay,
      endDay: segment.endDay,
      days: segment.days,
    };
  });
}

/**
 * The sentence for the phase bar.
 *
 * Names the phase today is in *and* the days it spans, because a coloured
 * segment is not readable without a word for it — and because "day 12 of 28, in
 * the fertile window" is the paragraph this bar replaced.
 */
export function phaseFinding(segments: PhaseSegment[], cycleDay: number | null, total: number | null): string {
  if (total === null || total < 1 || cycleDay === null) {
    return 'No cycle is in progress, so there is no phase to show.';
  }
  const segment = phaseForDay(segments, cycleDay);
  const position = `Day ${cycleDay} of ${total}`;
  if (!segment) return `${position}.`;
  const span = segment.days === 1 ? `day ${segment.startDay}` : `days ${segment.startDay}–${segment.endDay}`;
  return `${position} — ${segment.label.toLowerCase()} (${span}).`;
}

/**
 * A date's offset from the cycle start, as a 1-based day number.
 *
 * The one place a chart converts a date to a day number, kept pure so the
 * conversion can be tested: `dayNumber('2025-10-01', '2025-10-01')` is 1 (the
 * first day of bleeding is day 1, not day 0). Anything outside the cycle returns
 * null rather than a negative day, which the bar would otherwise draw off-canvas.
 */
export function dayNumber(cycleStart: string, date: string): number | null {
  const start = Date.parse(`${cycleStart}T00:00:00Z`);
  const value = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(value)) return null;
  const offset = Math.round((value - start) / 86_400_000) + 1;
  return offset >= 1 ? offset : null;
}

/* -------------------------------------------------------------------------- */
/* body-sign series                                                           */
/* -------------------------------------------------------------------------- */

export interface TemperatureReading {
  date: string;
  temperatureC: number;
}

/** The sentence for the temperature chart, in the user's own numbers. */
export function temperatureFinding(series: TemperatureReading[]): string {
  if (series.length === 0) return 'No temperature has been recorded yet.';
  const values = series.map((reading) => reading.temperatureC);
  const lowest = Math.min(...values);
  const highest = Math.max(...values);
  const average = mean(values)!;
  const readings = `${series.length} ${series.length === 1 ? 'reading' : 'readings'}`;
  const range = lowest === highest ? `${round1(lowest)} °C` : `${round1(lowest)}–${round1(highest)} °C`;
  return `${readings}, ${range}, averaging ${round1(average)} °C.`;
}

/** Rounds to 2dp so a viewBox path never carries `0.30000000000000004`. */
function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/** To 4dp — enough for a temperature, and enough to lose the float dust. */
function clean(value: number): number {
  return Math.round(value * 10000) / 10000;
}
