/**
 * Which cycle marks a calendar day carries.
 *
 * Pure, and deliberately so: the cycle maths lives in `@/lib/period-math` on the
 * server (`src/server/repos/period.ts`), and this module does not compute
 * anything. Every date it reasons about — the predicted period, the fertile
 * window, the ovulation estimate — arrives already computed in
 * {@link PeriodPrediction}; the only operation here is "does this day fall inside
 * that range", which is a string comparison on `YYYY-MM-DD`.
 *
 * That boundary is why the client can be trusted to paint the month without ever
 * disagreeing with the server: it cannot derive a date the server did not send.
 *
 * ## The four marks
 *
 *  - **period** — a day the user recorded bleeding on. This is observed data, so
 *    it is the strongest mark.
 *  - **predicted** — a day inside the next expected period. It is a range from
 *    the prediction, never a single date.
 *  - **fertile** — a day inside the fertile window, itself derived from the
 *    ovulation estimate.
 *  - **ovulation** — the one estimated ovulation day.
 *
 * A day can carry several at once (an observed period day that is also inside the
 * predicted window, or ovulation inside the fertile window), so the result is a
 * set of booleans rather than one enum — collapsing them would lose information
 * the legend and the accessible name both need.
 */
import type { DateOnly } from '@/lib/types';
import type { PeriodOverview } from '@/lib/period-types';

export interface DayMarks {
  /** The user recorded bleeding on this day (a cycle range, or a day log's flow). */
  period: boolean;
  /** Inside the predicted next period. */
  predicted: boolean;
  /** Inside the six-day fertile window. */
  fertile: boolean;
  /** The estimated ovulation day. */
  ovulation: boolean;
}

const NO_MARKS: DayMarks = { period: false, predicted: false, fertile: false, ovulation: false };

/** True when `date` is inside `[start, end]`; a null end means a one-day range. */
function within(date: DateOnly, start: DateOnly | null | undefined, end: DateOnly | null | undefined): boolean {
  if (!start) return false;
  const last = end ?? start;
  // Floating `YYYY-MM-DD` strings sort lexicographically exactly as they sort in
  // time, which is why the contract uses them rather than instants.
  return date >= start && date <= last;
}

/**
 * Is this a flowing day?
 *
 * `none` is a *recorded* value — the user opened the day and said there was no
 * bleeding — so it is a day log without a period mark, and `spotting` is a period
 * mark (it is bleeding, and usually the start or end of one). Those two choices
 * are the only interpretation this module makes.
 */
function flowIsBleeding(flow: string | null | undefined): boolean {
  return flow !== null && flow !== undefined && flow !== 'none';
}

/** The marks for one day, given the overview the screen already loaded. */
export function dayMarks(date: DateOnly, overview: PeriodOverview | undefined): DayMarks {
  if (!overview) return NO_MARKS;

  const { cycles, dayLogs, prediction } = overview;

  let period = dayLogs.some((log) => log.date === date && flowIsBleeding(log.flow));
  if (!period) {
    period = cycles.some((cycle) => within(date, cycle.startDate, cycle.endDate));
  }

  return {
    period,
    predicted: within(date, prediction?.nextPeriodStart, prediction?.nextPeriodEnd),
    fertile: prediction?.fertileWindow
      ? within(date, prediction.fertileWindow.start, prediction.fertileWindow.end)
      : false,
    ovulation: prediction?.ovulationDate === date,
  };
}

/** The marks for a whole list of days, as a map — one pass per day. */
export function marksForDays(days: readonly DateOnly[], overview: PeriodOverview | undefined): Map<DateOnly, DayMarks> {
  const map = new Map<DateOnly, DayMarks>();
  for (const date of days) map.set(date, dayMarks(date, overview));
  return map;
}

/** True when there is nothing to paint. */
export function hasMarks(marks: DayMarks): boolean {
  return marks.period || marks.predicted || marks.fertile || marks.ovulation;
}

/**
 * The marks as words, for the day button's accessible name and the legend.
 *
 * Order is most-observed first: a screen reader hears "period day, predicted
 * period" rather than being told a guess before a fact.
 */
export function markWords(marks: DayMarks): string[] {
  const words: string[] = [];
  if (marks.period) words.push('period day');
  if (marks.predicted) words.push('predicted period');
  if (marks.ovulation) words.push('estimated ovulation');
  if (marks.fertile) words.push('fertile window');
  return words;
}

/** The legend, in the same order as {@link markWords}. */
export const MARK_LEGEND: { key: keyof DayMarks; label: string; hint: string }[] = [
  { key: 'period', label: 'Period', hint: 'a day you recorded bleeding' },
  { key: 'predicted', label: 'Predicted', hint: 'inside the next expected period' },
  { key: 'ovulation', label: 'Ovulation', hint: 'the estimated ovulation day' },
  { key: 'fertile', label: 'Fertile', hint: 'the six-day fertile window' },
];
