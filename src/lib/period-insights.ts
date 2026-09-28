/**
 * The cycle summary's thresholds, the trend sentence, and the dot strip's day
 * enumeration.
 *
 * Framework-free and side-effect free, beside `period-math.ts` and for the same
 * reason: the parts that can be quietly wrong here are a *number* (a threshold, a
 * count, a range) and a *claim* (a badge, a sentence), and both have to be
 * testable without a DOM or a database. The screens in
 * `src/components/period/CycleSummary.tsx` and `CycleDotStrip.tsx` only render
 * what this module returns.
 *
 * ## The thresholds, and where they come from
 *
 * A status badge is a claim, so each one is a published range rather than a
 * number somebody liked:
 *
 *  - **Cycle length: 21–35 days.** NHS, "Periods and fertility in the menstrual
 *    cycle" — a cycle (first day of a period to the day before the next) of 21 to
 *    35 days is the usual range. The prediction module already cites the same
 *    figure and clamps its own estimate with it (`MIN_PREDICTED_CYCLE_DAYS` /
 *    `MAX_PREDICTED_CYCLE_DAYS` in `period-math.ts`), so the badge and the
 *    prediction cannot disagree about what "usual" means.
 *  - **Bleeding length: 2–7 days.** NHS, "Periods" — bleeding usually lasts
 *    around five days, with 2 to 7 days described as the normal span.
 *  - **Variation: the shortest-to-longest spread, 7 days or less.** The spread is
 *    the standard way a *regular* cycle is described, and the number here is
 *    deliberately the one the app already uses for its own irregularity flag
 *    (`IRREGULAR_STD_DEV_DAYS = 7`, which downgrades the prediction's confidence).
 *    It is a presentation threshold, not a clinical one: it decides whether the
 *    row says "wider variation", and nothing downstream treats it as a finding.
 *    A single authoritative cutoff is not something this codebase could point at,
 *    so the badge is worded as a description of the spread rather than as a
 *    diagnosis.
 *
 * ## Why the word is not "abnormal"
 *
 * The reference app labels a cycle outside 21–35 days "ABNORMAL". That is a
 * frightening word for a number that is merely outside a range, and it is a
 * clinical judgement this app is not in a position to make. So the badge says
 * **"Outside the usual range"**, the variation badge says **"Wider variation"**,
 * and the (i) text under each row states the range and its source. The claim is
 * kept, the diagnosis is dropped.
 */
import { addDaysToDateOnly } from './dates';
import type { DateOnly } from './types';

/* -------------------------------------------------------------------------- */
/* thresholds                                                                 */
/* -------------------------------------------------------------------------- */

/** The usual cycle length, inclusive. NHS, "Periods and fertility in the menstrual cycle". */
export const CYCLE_LENGTH_USUAL_MIN_DAYS = 21;
export const CYCLE_LENGTH_USUAL_MAX_DAYS = 35;

/** The usual bleeding length, inclusive. NHS, "Periods". */
export const PERIOD_LENGTH_USUAL_MIN_DAYS = 2;
export const PERIOD_LENGTH_USUAL_MAX_DAYS = 7;

/** The largest shortest-to-longest spread still called steady. See the file note. */
export const CYCLE_VARIATION_USUAL_MAX_DAYS = 7;

/** How many of the most recent complete cycles the trend sentence describes. */
export const TREND_WINDOW_CYCLES = 6;

/**
 * The width the strip's row has to work with at 390px, in px, as measured.
 *
 * 390 − 2×16px gutter (`px-gutter`) − 2×1px card border − 2×16px row padding
 * (`px-row`) = 324. The probe measures it again on every run; this constant is
 * what the drawn-dot cap is derived from rather than a number chosen by eye.
 */
export const STRIP_ROW_PX = 324;

/** The drawn dot's size in px. */
export const STRIP_DOT_PX = 6;
/** The gap between dots in px. */
export const STRIP_GAP_PX = 2;

/**
 * The most dots one strip draws.
 *
 * Not a data limit — the enumeration below has no cap — but a *rendering* one:
 * the largest count whose dots and gaps fit {@link STRIP_ROW_PX}. With 6px dots
 * and 2px gaps that is 40 (`40×6 + 39×2 = 318 ≤ 324`; 41 would need 326). A cycle
 * longer than that (rare, but `MAX_PLAUSIBLE_CYCLE_DAYS` allows it) renders the
 * first 40 days plus a text "+N" token rather than wrapping or shrinking every dot
 * to an unreadable size; the accessible name still states the full length.
 */
export const STRIP_MAX_DAYS = Math.floor((STRIP_ROW_PX + STRIP_GAP_PX) / (STRIP_DOT_PX + STRIP_GAP_PX));

/* -------------------------------------------------------------------------- */
/* status verdicts                                                            */
/* -------------------------------------------------------------------------- */

/**
 * What a row's badge may say.
 *
 * Three states, not two: `usual` and `outside` are about a range, and `wide` is
 * about a *spread* — the variation row is not "outside" anything, it describes how
 * far apart the cycles are.
 */
export type SummaryStatus = 'usual' | 'outside' | 'wide';

export interface SummaryVerdict {
  status: SummaryStatus;
  /** The badge, short enough for one line beside the value at 390px. */
  badge: string;
  /**
   * The (i) text: what the row is, the threshold it is judged against, and where
   * that threshold comes from. This is where the badge's claim can be read.
   */
  explanation: string;
}

function daysPhrase(days: number): string {
  return `${days} ${days === 1 ? 'day' : 'days'}`;
}

/**
 * A cycle length against the usual 21–35 day range.
 *
 * `null` (no complete cycle measured) yields `null` rather than a badge: an
 * unmeasured value is not "outside" anything.
 */
export function cycleLengthVerdict(days: number | null): SummaryVerdict | null {
  if (days === null || !Number.isFinite(days)) return null;
  const inside = days >= CYCLE_LENGTH_USUAL_MIN_DAYS && days <= CYCLE_LENGTH_USUAL_MAX_DAYS;
  return {
    status: inside ? 'usual' : 'outside',
    badge: inside ? 'In the usual range' : 'Outside the usual range',
    explanation:
      `A cycle is measured from the first day of one period to the day before the next. ` +
      `${CYCLE_LENGTH_USUAL_MIN_DAYS}–${CYCLE_LENGTH_USUAL_MAX_DAYS} days is the range usually described as typical (NHS). ` +
      `This one was ${daysPhrase(days)}, which is ${inside ? 'inside' : 'outside'} it. ` +
      (inside ? '' : 'A cycle outside the range is still a cycle — length varies between people and between cycles.'),
  };
}

/** A bleeding length against the usual 2–7 day range. `null` yields no badge. */
export function periodLengthVerdict(days: number | null): SummaryVerdict | null {
  if (days === null || !Number.isFinite(days)) return null;
  const inside = days >= PERIOD_LENGTH_USUAL_MIN_DAYS && days <= PERIOD_LENGTH_USUAL_MAX_DAYS;
  return {
    status: inside ? 'usual' : 'outside',
    badge: inside ? 'In the usual range' : 'Outside the usual range',
    explanation:
      `Bleeding usually lasts ${PERIOD_LENGTH_USUAL_MIN_DAYS}–${PERIOD_LENGTH_USUAL_MAX_DAYS} days (NHS). ` +
      `The most recent recorded period was ${daysPhrase(days)}, which is ${inside ? 'inside' : 'outside'} it. ` +
      (inside ? '' : 'A longer or shorter bleed is not on its own a finding.'),
  };
}

/**
 * The spread between the shortest and longest measured cycle.
 *
 * `null` when either end is unknown, or when there is only one measured cycle —
 * one cycle has no spread, and "0 days variation" would read as a measurement.
 */
export function cycleVariationVerdict(shortest: number | null, longest: number | null): SummaryVerdict | null {
  if (shortest === null || longest === null || !Number.isFinite(shortest) || !Number.isFinite(longest)) return null;
  const spread = longest - shortest;
  const steady = spread <= CYCLE_VARIATION_USUAL_MAX_DAYS;
  return {
    status: steady ? 'usual' : 'wide',
    badge: steady ? 'In the usual range' : 'Wider variation',
    explanation:
      `The distance between your shortest and longest measured cycle. ` +
      `A spread of up to ${CYCLE_VARIATION_USUAL_MAX_DAYS} days is treated as steady here; yours is ${daysPhrase(spread)} ` +
      `(${shortest}–${longest} days). ` +
      (steady ? '' : 'A wider spread is what makes a prediction a range rather than a date.'),
  };
}

/**
 * The most recent recorded bleed, in days, or null when no end was logged.
 *
 * A cycle whose `endDate` is null is skipped rather than defaulted: the contract
 * says a user may record only the start and never the end, and filling in a
 * five-day default here would turn a missing log into an observed period length.
 * Inclusive of both ends, so a start and end on the same day is one day.
 */
export function latestPeriodLength(
  cycles: { startDate: DateOnly; endDate: DateOnly | null }[],
): number | null {
  const complete = cycles
    .filter((cycle): cycle is { startDate: DateOnly; endDate: DateOnly } => cycle.endDate !== null)
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
  const latest = complete[complete.length - 1];
  if (!latest) return null;

  const days =
    Math.round((Date.parse(`${latest.endDate}T00:00:00Z`) - Date.parse(`${latest.startDate}T00:00:00Z`)) / 86_400_000) + 1;
  return days >= 1 ? days : null;
}

/* -------------------------------------------------------------------------- */
/* the trend sentence                                                         */
/* -------------------------------------------------------------------------- */

/** The shape the trend sentence reads — structurally `chart-math`'s `CycleLength`. */
export interface CycleInterval {
  from: DateOnly;
  to: DateOnly;
  days: number;
}

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `'2025-10-14'` -> `14 Oct`. Local, so this module needs no React. */
function shortDate(date: DateOnly): string {
  const [, month, day] = date.split('-');
  return `${Number(day)} ${MONTH_SHORT[Number(month) - 1]}`;
}

/** One decimal only when it is not a whole number, so `28` never prints as `28.0`. */
function formatDays(value: number): string {
  return Number.isInteger(value) ? `${value}` : value.toFixed(1);
}

function medianOf(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

/**
 * One sentence describing the shape of the recent cycles.
 *
 * It is derived, not templated: the counts, the dates, the magnitudes and the
 * range are all read off the intervals, and a "long" cycle is one that sits more
 * than {@link CYCLE_VARIATION_USUAL_MAX_DAYS} days from the median of the window —
 * the same threshold the variation badge uses, so the sentence and the badge
 * cannot describe the same history differently. Every branch below is reachable
 * and unit-tested, including zero cycles, one cycle and a perfectly even history.
 *
 * The window is the most recent {@link TREND_WINDOW_CYCLES} intervals, newest
 * last (the order the stats payload sends them in).
 */
export function cycleTrendSentence(intervals: CycleInterval[]): string {
  const window = intervals.slice(-TREND_WINDOW_CYCLES);
  const count = window.length;

  if (count === 0) {
    return 'No complete cycle has been measured yet, so there is no trend to describe. A cycle length appears once a second period start is recorded.';
  }
  if (count === 1) {
    return `Only one complete cycle is on record (${daysPhrase(window[0]!.days)}), so there is no trend to describe yet.`;
  }

  const values = window.map((interval) => interval.days);
  const median = medianOf(values);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const spread = max - min;
  const noun = count === 1 ? 'cycle' : 'cycles';

  const deviations = window
    .map((interval, index) => ({ interval, deviation: values[index]! - median }))
    .filter((entry) => Math.abs(entry.deviation) > CYCLE_VARIATION_USUAL_MAX_DAYS);

  if (deviations.length === 0) {
    if (spread === 0) return `Your last ${count} complete ${noun} were all ${formatDays(min)} days.`;
    return `Your last ${count} complete ${noun} stayed between ${formatDays(min)} and ${formatDays(max)} days — a spread of ${daysPhrase(spread)}.`;
  }

  if (deviations.length === 1) {
    const { interval, deviation } = deviations[0]!;
    const direction = deviation > 0 ? 'longer' : 'shorter';
    return (
      `One of your last ${count} complete ${noun} — the one starting ${shortDate(interval.from)} — was ` +
      `${daysPhrase(Math.abs(deviation))} ${direction} than the middle of the other ${count - 1}, at ${daysPhrase(interval.days)}.`
    );
  }

  const longer = deviations.filter((entry) => entry.deviation > 0).length;
  const shorter = deviations.length - longer;
  const parts: string[] = [];
  if (longer > 0) parts.push(`${longer} longer`);
  if (shorter > 0) parts.push(`${shorter} shorter`);
  return (
    `${deviations.length} of your last ${count} complete ${noun} sat more than ${daysPhrase(CYCLE_VARIATION_USUAL_MAX_DAYS)} ` +
    `from the middle of the rest (${parts.join(', ')}), and they ranged from ${formatDays(min)} to ${formatDays(max)} days.`
  );
}

/* -------------------------------------------------------------------------- */
/* the dot strip                                                              */
/* -------------------------------------------------------------------------- */

export interface CycleStripDay {
  /** 1-based day of the cycle. */
  day: number;
  date: DateOnly;
  /** A recorded bleeding day. */
  period: boolean;
  /** Inside the fertile window the prediction sent, when it applies to this cycle. */
  fertile: boolean;
}

export interface CycleStripInput {
  startDate: DateOnly;
  /** Inclusive last bleeding day, or null when only the start is known. */
  endDate: DateOnly | null;
  /** How many days of the cycle to draw: the measured length, or the days so far. */
  lengthDays: number;
  /**
   * The prediction's fertile window, but only for the cycle it belongs to.
   *
   * `PeriodPrediction` carries one window, for the current cycle. A completed
   * cycle has no stored window of its own, and this module will not derive one:
   * the client must never re-run cycle maths (see `period-math.ts`), so a
   * historical strip shows observed period days and nothing it cannot observe.
   */
  fertileWindow?: { start: DateOnly; end: DateOnly } | null;
}

/**
 * One entry per day of a cycle, oldest first.
 *
 * `lengthDays` is clamped to at least one day so a cycle that started today draws
 * a single dot rather than nothing. A cycle with no `endDate` marks only its first
 * day as bleeding — the start is recorded, the end is not, and inventing a
 * five-day default here would turn a missing log into observed data.
 */
export function cycleStripDays(input: CycleStripInput): CycleStripDay[] {
  const total = Math.max(1, Math.floor(input.lengthDays));
  const fertile = input.fertileWindow ?? null;
  const days: CycleStripDay[] = [];

  for (let offset = 0; offset < total; offset++) {
    const date = addDaysToDateOnly(input.startDate, offset, 'utc');
    const period =
      input.endDate === null
        ? offset === 0
        : date >= input.startDate && date <= input.endDate;
    days.push({
      day: offset + 1,
      date,
      period,
      fertile: fertile !== null && date >= fertile.start && date <= fertile.end,
    });
  }

  return days;
}

/** `[1, 2, 3, 5]` -> `'1–3, 5'`. */
function formatDayRanges(days: number[]): string {
  if (days.length === 0) return '';
  const runs: string[] = [];
  let start = days[0]!;
  let previous = start;
  for (const day of days.slice(1)) {
    if (day === previous + 1) {
      previous = day;
      continue;
    }
    runs.push(start === previous ? `${start}` : `${start}–${previous}`);
    start = day;
    previous = day;
  }
  runs.push(start === previous ? `${start}` : `${start}–${previous}`);
  return runs.join(', ');
}

/**
 * The strip in words — its text alternative.
 *
 * A row of dots says nothing to a screen reader, so this is what the strip's
 * `role="img"` announces: which days are period days, which are in the fertile
 * window, and how many are neither. Consecutive days are compressed to ranges
 * because "days 1, 2, 3, 4, 5" is noise where "days 1–5" is a fact.
 */
export function describeStrip(days: CycleStripDay[]): string {
  if (days.length === 0) return 'No days to show.';

  const period = formatDayRanges(days.filter((day) => day.period).map((day) => day.day));
  const fertile = formatDayRanges(days.filter((day) => day.fertile).map((day) => day.day));
  const plain = days.filter((day) => !day.period && !day.fertile).length;

  const parts: string[] = [];
  parts.push(period ? `Period days ${period}.` : 'No period days recorded.');
  if (fertile) parts.push(`Fertile window days ${fertile}.`);
  parts.push(`${plain} ${plain === 1 ? 'day' : 'days'} unmarked.`);
  return parts.join(' ');
}

/** The strip's full accessible name: the cycle, its length, and the day detail. */
export function stripAccessibleName(startDate: DateOnly, days: CycleStripDay[]): string {
  const length = days.length;
  return `Cycle starting ${shortDate(startDate)}, ${daysPhrase(length)}. ${describeStrip(days)}`;
}
