/**
 * Menstrual-cycle maths: cycle-length estimation, ovulation, the fertile window
 * and the calendar (Ogino–Knaus) method.
 *
 * This module is **framework-free and side-effect free**. It takes already-read
 * cycles and settings and returns a prediction; the database lives in
 * `src/server/repos/period.ts`. That split is what lets every rule below be
 * unit-tested against a known case without a DOM or a database.
 *
 * ## Where each rule comes from
 *
 * The user asked how ovulation is actually calculated and where the rules come
 * from, so each one is sourced rather than asserted.
 *
 * ### 1. Ovulation is *next period − luteal phase*, not "14 days in"
 *
 * The luteal phase — ovulation to the next period — is the comparatively stable
 * part of the cycle: it is conventionally 12–14 days with a population mean of
 * about 14. The follicular phase is the variable one, which is exactly why the
 * "day 14" shorthand is wrong for anyone whose cycles are not 28 days. So:
 *
 *     ovulation ≈ predictedNextPeriodStart − lutealPhaseDays
 *
 * The estimate therefore depends on the *predicted next cycle length*, not the
 * length of the cycle that just ended.
 *
 * Sources: Wikipedia, "Luteal phase" (the conventional ~14-day luteal phase and
 * the caveat that length varies between people and between cycles); NHS,
 * "Periods and fertility in the menstrual cycle" (a cycle is first day of a
 * period to the day before the next; 21–35 days is normal).
 *
 * ### 2. The fertile window is 5 days before ovulation plus ovulation day
 *
 * Six days in total, and *asymmetric*: it extends backwards from ovulation
 * because sperm survive in the reproductive tract for several days, while the
 * oocyte is viable for only about 12–24 hours after release. A symmetric window
 * around ovulation would be wrong in both directions.
 *
 * Sources: Wilcox, Weinberg & Baird, "Timing of sexual intercourse in relation
 * to ovulation", N Engl J Med 1995;333(23):1517–21 (PMID 7477165);
 * Dunson et al., Hum Reprod 1999;14(7):1835–9 (PMID 10402400) — after
 * correcting for ovulation-detection error both studies estimate "the same
 * 6-day fertile interval", with the highest probability of conception on the day
 * before ovulation and near zero after it. Oocyte viability 12–24 h: Wikipedia,
 * "Ovulation". Sperm survival of "at least three days … as long as a week":
 * Wikipedia, "Basal body temperature", citing Coward & Wells, *Textbook of
 * Clinical Embryology* (2013).
 *
 * ### 3. The calendar / Ogino–Knaus method
 *
 * From the *shortest* and *longest* recorded cycles: the fertile span runs from
 * `shortest − 18` to `longest − 11` (cycle days, 1-based). It exists precisely
 * because cycle length varies; it is crude and, used alone as contraception, has
 * a typical-use failure rate of about 24% per year.
 *
 * Source: Wikipedia, "Calendar-based contraceptive methods" (Knaus–Ogino). The
 * worked example there — cycles of 30–36 days — gives fertile days 12–25:
 * `30 − 18 = 12`, `36 − 11 = 25`.
 *
 * ### 4. Signals that are recorded but not yet used
 *
 * Basal body temperature (a sustained rise *after* ovulation confirms it
 * retrospectively — it cannot predict), LH test strips (a surge precedes
 * ovulation by roughly a day), cervical mucus and ovulation pain are all stored
 * on {@link PeriodDayLog}. None of them feed the estimate today. They are stored
 * so that a future model *could* use them; recording them is the precondition
 * for ever doing better.
 *
 * ### 5. On "deep learning" — the honest answer
 *
 * A person produces roughly 12–24 cycles a year. A model with more parameters
 * than that fits noise: the data cannot distinguish a learned pattern from a
 * coincidence, and a neural network trained on one person's hundred cycles will
 * confidently reproduce their last three. This module therefore does something
 * defensible and explainable instead: a **recency-weighted mean of cycle length
 * with an explicit uncertainty range**, so the UI can say "28 ± 3 days" rather
 * than a false-precision date. The temperature, LH, mucus and pain columns exist
 * so that the data for a better model accumulates in the meantime, and this
 * comment is the record that the question was answered rather than ignored.
 */
import { addDaysToDateOnly, fromDateOnly } from './dates';
import {
  HORMONAL_CONTRACEPTION_METHODS,
  type ContraceptionDayStatus,
  type ContraceptionMethod,
  type ContraceptionMethodRecord,
  type ContraceptionSchedule,
  type ContraceptionScheduleDay,
  type PeriodCycle,
  type PeriodPrediction,
  type PeriodPredictionBasis,
  type PeriodSettings,
  type PredictionConfidence,
} from './period-types';
import type { DateOnly } from './types';

/* -------------------------------------------------------------------------- */
/* tunables, each with the reason it exists                                   */
/* -------------------------------------------------------------------------- */

/**
 * Half-life, in cycles, of the recency weighting: the newest interval has full
 * weight, an interval three cycles old has half. Three cycles is roughly a
 * season, which is the timescale over which a person's cycle actually shifts
 * (post-partum, after stopping a hormonal method, perimenopause). A shorter
 * half-life chases noise; a longer one lets an old body predict a new one.
 */
export const RECENCY_HALF_LIFE_CYCLES = 3;

/**
 * Intervals longer than this are treated as a gap in logging or amenorrhoea
 * rather than as one cycle, and are excluded from the estimate. A 90-day
 * "cycle" would otherwise dominate every average it appears in. They are
 * reported in `notes`, never silently discarded.
 */
export const MAX_PLAUSIBLE_CYCLE_DAYS = 90;

/** A predicted cycle length is clamped into this range (21–35 is normal). */
export const MIN_PREDICTED_CYCLE_DAYS = 15;
export const MAX_PREDICTED_CYCLE_DAYS = 60;

/** Used when no recorded period has an end date. */
export const DEFAULT_PERIOD_LENGTH_DAYS = 5;

/**
 * Uncertainty is never smaller than this, and never larger. The lower bound
 * stops a run of identical cycle lengths from producing a falsely precise
 * "± 0 days"; the upper bound stops a pathological spread from rendering the
 * band uselessly wide.
 */
export const MIN_UNCERTAINTY_DAYS = 1;
export const MAX_UNCERTAINTY_DAYS = 14;

/**
 * With one or two measured intervals there is no meaningful spread to measure,
 * so the band falls back to this. Three days is the order of ordinary
 * cycle-to-cycle variation, and it is marked `source: 'default'` so the UI can
 * be honest about where it came from.
 */
export const DEFAULT_UNCERTAINTY_DAYS = 3;

/** Beyond this spread the cycle is too irregular to call "medium" confidence. */
export const IRREGULAR_STD_DEV_DAYS = 7;

/** The fertile window: this many days before ovulation, plus ovulation day. */
export const FERTILE_DAYS_BEFORE_OVULATION = 5;

/** Roll-forward guard when the last logged period is long past its prediction. */
const MAX_ROLL_FORWARD_CYCLES = 60;

/* -------------------------------------------------------------------------- */
/* small date + statistics helpers                                            */
/* -------------------------------------------------------------------------- */

/** Whole days from `from` to `to` (positive when `to` is later). */
export function diffDays(from: DateOnly, to: DateOnly, zone = 'utc'): number {
  return Math.round(fromDateOnly(to, zone).diff(fromDateOnly(from, zone), 'days').days);
}

/** `YYYY-MM-DD` at UTC, the floating-day convention used everywhere. */
export function addDays(date: DateOnly, days: number, zone = 'utc'): DateOnly {
  return addDaysToDateOnly(date, days, zone);
}

export function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

/** Population standard deviation; null for fewer than two values. */
export function standardDeviation(values: number[]): number | null {
  if (values.length < 2) return null;
  const average = mean(values)!;
  const variance = values.reduce((sum, value) => sum + (value - average) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

/**
 * Exponentially weighted mean, `values` oldest-first, so the *last* value gets
 * the most weight. Used for cycle length: recent cycles describe the body the
 * user has now.
 */
export function recencyWeightedMean(values: number[], halfLife = RECENCY_HALF_LIFE_CYCLES): number | null {
  if (values.length === 0) return null;
  if (values.length === 1) return values[0]!;
  let weighted = 0;
  let totalWeight = 0;
  for (let i = 0; i < values.length; i++) {
    const age = values.length - 1 - i; // 0 for the newest
    const weight = 0.5 ** (age / halfLife);
    weighted += values[i]! * weight;
    totalWeight += weight;
  }
  return weighted / totalWeight;
}

/** Sorts and de-duplicates period starts, oldest first. */
export function sortPeriodStarts(starts: DateOnly[]): DateOnly[] {
  return [...new Set(starts)].sort();
}

/** Lengths, in days, between consecutive period starts. */
export function cycleIntervals(starts: DateOnly[]): number[] {
  const sorted = sortPeriodStarts(starts);
  const lengths: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    lengths.push(diffDays(sorted[i - 1]!, sorted[i]!));
  }
  return lengths;
}

/* -------------------------------------------------------------------------- */
/* ovulation, fertile window, calendar method                                 */
/* -------------------------------------------------------------------------- */

/**
 * Ovulation, estimated as the predicted next period minus the luteal phase.
 * Returns the raw candidate; {@link buildPeriodPrediction} clamps it into the
 * cycle before publishing it.
 */
export function estimateOvulation(nextPeriodStart: DateOnly, lutealPhaseDays: number, zone = 'utc'): DateOnly {
  return addDays(nextPeriodStart, -lutealPhaseDays, zone);
}

/**
 * The fertile window: `5` days before ovulation through ovulation day, six days
 * inclusive. Deliberately not centred on ovulation — see the file header.
 */
export function fertileWindow(ovulation: DateOnly, zone = 'utc'): { start: DateOnly; end: DateOnly } {
  return { start: addDays(ovulation, -FERTILE_DAYS_BEFORE_OVULATION, zone), end: ovulation };
}

/**
 * Ogino–Knaus: the fertile span from the shortest and longest observed cycles.
 * `cycleDay` is 1-based, so the returned range is `[cycleStart + (from−1),
 * cycleStart + (to−1)]`.
 */
export function calendarMethodDayRange(
  shortestCycleDays: number,
  longestCycleDays: number,
): { fromCycleDay: number; toCycleDay: number } {
  const fromCycleDay = Math.max(1, shortestCycleDays - 18);
  const toCycleDay = Math.max(fromCycleDay, longestCycleDays - 11);
  return { fromCycleDay, toCycleDay };
}

/** Converts the day-range above into dates anchored on a cycle's first day. */
export function calendarMethodWindow(
  cycleStart: DateOnly,
  shortestCycleDays: number,
  longestCycleDays: number,
  zone = 'utc',
): { start: DateOnly; end: DateOnly } {
  const { fromCycleDay, toCycleDay } = calendarMethodDayRange(shortestCycleDays, longestCycleDays);
  return {
    start: addDays(cycleStart, fromCycleDay - 1, zone),
    end: addDays(cycleStart, toCycleDay - 1, zone),
  };
}

/* -------------------------------------------------------------------------- */
/* contraception schedule                                                     */
/* -------------------------------------------------------------------------- */

/** Whether a method suppresses ovulation (and so invalidates a fertility claim). */
export function isHormonalMethod(method: ContraceptionMethod): boolean {
  return (HORMONAL_CONTRACEPTION_METHODS as readonly string[]).includes(method);
}

/**
 * A daily product: expected every day rather than in an on/off rhythm. A pill
 * with a placebo week is described by a schedule instead, so this is only the
 * fallback for a pill logged without one.
 */
export function isDailyMethod(method: ContraceptionMethod): boolean {
  return method === 'pill';
}

/**
 * Whether the method has a day-by-day plan the UI should draw. Continuous
 * methods (an IUD, a condom) have nothing to draw.
 */
export function hasDayPlan(record: Pick<ContraceptionMethodRecord, 'method' | 'schedule'>): boolean {
  return record.schedule !== null || isDailyMethod(record.method);
}

/** Total length of one on/off cycle: 28 for the classic 21/7 pack. */
export function scheduleCycleLength(schedule: ContraceptionSchedule): number {
  return schedule.onDays + schedule.offDays;
}

/** The scheduled state of one day, given the method's start as the anchor. */
export function scheduledDayState(
  schedule: ContraceptionSchedule,
  dayIndex: number,
): { expected: 'on' | 'off'; cycleDay: number } {
  const length = scheduleCycleLength(schedule);
  if (length <= 0) return { expected: 'off', cycleDay: 1 };
  const within = ((dayIndex % length) + length) % length; // safe for dayIndex < 0
  return { expected: within < schedule.onDays ? 'on' : 'off', cycleDay: within + 1 };
}

/**
 * Expands a method's on/off plan over a window, merging in what the user
 * actually logged. Pure: `loggedByDate` is read by the caller.
 *
 * The plan is *derived* from `startDate`, never stored per day, so editing the
 * schedule or the start date immediately changes the whole future plan.
 */
export function buildContraceptionSchedule(options: {
  method: Pick<ContraceptionMethodRecord, 'id' | 'method' | 'startDate' | 'endDate' | 'schedule'>;
  from: DateOnly;
  to: DateOnly;
  loggedByDate?: Map<DateOnly, ContraceptionDayStatus>;
  zone?: string;
}): ContraceptionScheduleDay[] {
  const { method, from: windowFrom, to: windowTo, loggedByDate, zone = 'utc' } = options;
  if (!hasDayPlan(method)) return [];

  const from = windowFrom < method.startDate ? method.startDate : windowFrom;
  const to = method.endDate && method.endDate < windowTo ? method.endDate : windowTo;
  if (from > to) return [];

  const out: ContraceptionScheduleDay[] = [];
  for (let date = from; date <= to; date = addDays(date, 1, zone)) {
    const dayIndex = diffDays(method.startDate, date, zone);
    if (dayIndex < 0) continue;
    const state = method.schedule
      ? scheduledDayState(method.schedule, dayIndex)
      : { expected: 'on' as const, cycleDay: dayIndex + 1 };
    out.push({
      methodId: method.id,
      date,
      cycleDay: state.cycleDay,
      expected: state.expected,
      logged: loggedByDate?.get(date) ?? null,
    });
  }
  return out;
}

/** The method in effect on a date; on overlap the most recently started wins. */
export function activeMethodOn(
  methods: Pick<ContraceptionMethodRecord, 'id' | 'method' | 'startDate' | 'endDate'>[],
  date: DateOnly,
): Pick<ContraceptionMethodRecord, 'id' | 'method' | 'startDate' | 'endDate'> | null {
  let best: (typeof methods)[number] | null = null;
  for (const method of methods) {
    if (method.startDate > date) continue;
    if (method.endDate !== null && method.endDate < date) continue;
    if (!best || method.startDate >= best.startDate) best = method;
  }
  return best;
}

/* -------------------------------------------------------------------------- */
/* the prediction                                                             */
/* -------------------------------------------------------------------------- */

export interface PeriodPredictionInput {
  /** The day the prediction is made for; defaults to nothing — caller passes it. */
  asOf: DateOnly;
  settings: PeriodSettings;
  cycles: Pick<PeriodCycle, 'startDate' | 'endDate'>[];
  contraception: Pick<ContraceptionMethodRecord, 'id' | 'method' | 'startDate' | 'endDate'>[];
  zone?: string;
}

/** Mean bleeding length over cycles that recorded an end date, clamped. */
export function averagePeriodLength(cycles: Pick<PeriodCycle, 'startDate' | 'endDate'>[], zone = 'utc'): number | null {
  const lengths = cycles
    .filter((cycle): cycle is { startDate: DateOnly; endDate: DateOnly } => cycle.endDate !== null)
    .map((cycle) => diffDays(cycle.startDate, cycle.endDate, zone) + 1)
    .filter((length) => length >= 1 && length <= 30);
  return mean(lengths);
}

function confidenceFor(usedIntervals: number[], sd: number | null): PredictionConfidence {
  if (usedIntervals.length === 0) return 'none';
  if (usedIntervals.length === 1) return 'low';
  if (sd !== null && sd > IRREGULAR_STD_DEV_DAYS) return 'low';
  return usedIntervals.length >= 6 ? 'high' : 'medium';
}

/**
 * Builds the whole prediction, including the basis it was derived from.
 *
 * The ordering matters and is deliberate: measure intervals → slice to recent
 * cycles → weight → clamp → place the next period → derive ovulation from the
 * *predicted* next period → clamp ovulation into the cycle → derive the fertile
 * window from ovulation.
 */
export function buildPeriodPrediction(input: PeriodPredictionInput): PeriodPrediction {
  const { asOf, settings, cycles, contraception, zone = 'utc' } = input;
  const starts = sortPeriodStarts(cycles.map((cycle) => cycle.startDate));
  const allIntervals = cycleIntervals(starts);
  const outliers = allIntervals.filter((length) => length > MAX_PLAUSIBLE_CYCLE_DAYS || length < 1);

  // The recency slice is expressed in *cycles*, then re-measured as intervals:
  // "the last 6 cycles" contains 5 intervals, which is what a user means.
  const windowStarts =
    settings.predictionCycleCount && settings.predictionCycleCount > 0
      ? starts.slice(-settings.predictionCycleCount)
      : starts;
  const usedIntervals = cycleIntervals(windowStarts).filter(
    (length) => length <= MAX_PLAUSIBLE_CYCLE_DAYS && length >= 1,
  );

  const shortest = usedIntervals.length ? Math.min(...usedIntervals) : null;
  const longest = usedIntervals.length ? Math.max(...usedIntervals) : null;
  const sd = standardDeviation(usedIntervals);
  const recencyMean = recencyWeightedMean(usedIntervals);
  const plainMean = mean(usedIntervals);
  const plainMedian = median(usedIntervals);
  const periodLength = averagePeriodLength(cycles, zone);

  const basis: PeriodPredictionBasis = {
    cycleCount: starts.length,
    intervalCount: allIntervals.length,
    intervalLengths: allIntervals,
    usedIntervalLengths: usedIntervals,
    averageCycleLengthDays: plainMean === null ? null : Math.round(plainMean * 10) / 10,
    medianCycleLengthDays: plainMedian,
    recencyWeightedMeanDays: recencyMean === null ? null : Math.round(recencyMean * 10) / 10,
    shortestCycleDays: shortest,
    longestCycleDays: longest,
    standardDeviationDays: sd === null ? null : Math.round(sd * 10) / 10,
    lutealPhaseDays: settings.lutealPhaseDays,
    predictionCycleCount: settings.predictionCycleCount,
    confidence: confidenceFor(usedIntervals, sd),
    cycleStarts: windowStarts,
    firstPeriodStart: starts[0] ?? null,
    lastPeriodStart: starts[starts.length - 1] ?? null,
    averagePeriodLengthDays: periodLength === null ? null : Math.round(periodLength * 10) / 10,
  };

  const notes: string[] = [];
  if (outliers.length > 0) {
    notes.push(
      `${outliers.length} recorded gap${outliers.length === 1 ? '' : 's'} longer than ${MAX_PLAUSIBLE_CYCLE_DAYS} days ` +
        'was left out of the estimate — that usually means a missed log rather than a cycle.',
    );
  }
  if (sd !== null && sd > IRREGULAR_STD_DEV_DAYS) {
    notes.push('Cycle lengths vary widely, so the estimate is deliberately given a wide range.');
  }

  /* ---- contraception context: it changes the *meaning*, not the maths ---- */
  const active = activeMethodOn(contraception, asOf);
  const hormonal = active ? isHormonalMethod(active.method) : false;
  const inUse = settings.contraceptionInUse || active !== null;
  const contraceptionContext = {
    inUse,
    activeMethod: active?.method ?? null,
    activeMethodId: active?.id ?? null,
    hormonal,
    affectsPrediction: hormonal,
  };

  const meaningFor = (sufficient: boolean): string => {
    if (!sufficient) {
      return 'Not enough recorded history to estimate a date yet. Logging two or more period starts is what makes a prediction possible.';
    }
    if (hormonal) {
      return 'A calendar estimate: hormonal contraception suppresses ovulation, so this is not a statement about your fertility.';
    }
    if (inUse) {
      return `Ovulation is estimated ${settings.lutealPhaseDays} days before the next predicted period.`;
    }
    return `Assumes a ${settings.lutealPhaseDays}-day luteal phase. The range is the spread of your own recorded cycles.`;
  };

  /* ---- not enough data: say so, do not invent a date ---- */
  if (usedIntervals.length === 0) {
    const reason =
      starts.length < 2
        ? 'At least two period start dates are needed to measure a cycle length.'
        : `Every recorded gap was longer than ${MAX_PLAUSIBLE_CYCLE_DAYS} days, which looks like missing data rather than a cycle.`;
    return {
      asOf,
      dataSufficient: false,
      method: 'insufficient_data',
      reason,
      lastPeriodStart: basis.lastPeriodStart,
      currentCycleDay: basis.lastPeriodStart ? diffDays(basis.lastPeriodStart, asOf, zone) + 1 : null,
      predictedCycleLengthDays: null,
      nextPeriodStart: null,
      nextPeriodEnd: null,
      predictedFromLastCycle: null,
      overdueDays: null,
      ovulationDate: null,
      ovulationClamped: false,
      fertileWindow: null,
      calendarMethodWindow: null,
      uncertainty: null,
      basis,
      contraception: contraceptionContext,
      meaning: meaningFor(false),
      notes,
    };
  }

  /* ---- the point estimate ---- */
  const rawLength = recencyMean ?? plainMean ?? 28;
  const predictedLength = Math.min(
    MAX_PREDICTED_CYCLE_DAYS,
    Math.max(MIN_PREDICTED_CYCLE_DAYS, Math.round(rawLength)),
  );

  const lastStart = basis.lastPeriodStart!;
  const predictedFromLastCycle = addDays(lastStart, predictedLength, zone);

  // If the estimate is already in the past, the user has not logged a period
  // they expected. Roll forward to the next *upcoming* one rather than showing a
  // stale date, but keep the original so the UI can say how late it is.
  const overdueDays = diffDays(predictedFromLastCycle, asOf, zone);
  let nextPeriodStart = predictedFromLastCycle;
  let guard = 0;
  while (nextPeriodStart < asOf && guard < MAX_ROLL_FORWARD_CYCLES) {
    nextPeriodStart = addDays(nextPeriodStart, predictedLength, zone);
    guard += 1;
  }
  if (guard >= MAX_ROLL_FORWARD_CYCLES) {
    notes.push('The last logged period is a long time ago, so the next date is a projection rather than a measurement.');
  }

  const nextPeriodEnd = addDays(nextPeriodStart, Math.round(periodLength ?? DEFAULT_PERIOD_LENGTH_DAYS) - 1, zone);
  const currentCycleStart = addDays(nextPeriodStart, -predictedLength, zone);

  /* ---- ovulation: next period − luteal, clamped into the cycle ---- */
  const luteal = Math.min(17, Math.max(9, Math.round(settings.lutealPhaseDays)));
  let ovulationDate = estimateOvulation(nextPeriodStart, luteal, zone);

  // The lower bound is the later of "cycle day 2" and "the day after bleeding
  // ended". A short predicted cycle with a long luteal phase would otherwise put
  // ovulation *before the period started*, which is nonsense; clamping and
  // flagging it is honest, inventing a date is not.
  const currentCycle = cycles.find((cycle) => cycle.startDate === currentCycleStart);
  const bleedingEnd = currentCycle?.endDate ?? null;
  const lowerBound = bleedingEnd && bleedingEnd >= currentCycleStart
    ? addDays(bleedingEnd, 1, zone)
    : addDays(currentCycleStart, 1, zone);
  const upperBound = addDays(nextPeriodStart, -1, zone);

  let ovulationClamped = false;
  if (ovulationDate < lowerBound) {
    ovulationDate = lowerBound;
    ovulationClamped = true;
    notes.push('The luteal phase you set would place ovulation before this cycle began, so the estimate was clamped to the cycle.');
  } else if (ovulationDate > upperBound) {
    ovulationDate = upperBound;
    ovulationClamped = true;
    notes.push('The luteal phase you set would place ovulation on or after the next predicted period, so the estimate was clamped.');
  }

  const window = fertileWindow(ovulationDate, zone);
  const fertileStart = window.start < currentCycleStart ? currentCycleStart : window.start;
  const fertile = { start: fertileStart, end: window.end };

  /* ---- calendar method, when there is a spread to use ---- */
  const calendarWindow =
    shortest !== null && longest !== null && usedIntervals.length >= 2
      ? calendarMethodWindow(currentCycleStart, shortest, longest, zone)
      : null;

  /* ---- uncertainty ---- */
  let uncertaintyDays: number;
  let uncertaintySource: 'observed' | 'default';
  if (usedIntervals.length >= 3 && sd !== null) {
    uncertaintyDays = Math.max(MIN_UNCERTAINTY_DAYS, Math.ceil(sd));
    uncertaintySource = 'observed';
  } else {
    uncertaintyDays = DEFAULT_UNCERTAINTY_DAYS;
    uncertaintySource = 'default';
  }
  uncertaintyDays = Math.min(MAX_UNCERTAINTY_DAYS, uncertaintyDays);

  const currentCycleDay = diffDays(basis.lastPeriodStart!, asOf, zone) + 1;

  return {
    asOf,
    dataSufficient: true,
    method: 'recency_weighted_luteal',
    reason: null,
    lastPeriodStart: basis.lastPeriodStart,
    currentCycleDay,
    predictedCycleLengthDays: predictedLength,
    nextPeriodStart,
    nextPeriodEnd,
    predictedFromLastCycle,
    overdueDays: overdueDays > 0 ? overdueDays : null,
    ovulationDate,
    ovulationClamped,
    fertileWindow: fertile,
    calendarMethodWindow: calendarWindow,
    uncertainty: {
      earliest: addDays(nextPeriodStart, -uncertaintyDays, zone),
      latest: addDays(nextPeriodStart, uncertaintyDays, zone),
      days: uncertaintyDays,
      source: uncertaintySource,
    },
    basis,
    contraception: contraceptionContext,
    meaning: meaningFor(true),
    notes,
  };
}
