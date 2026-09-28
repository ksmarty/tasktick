/**
 * The Today screen's insight cards: the facts the API already returns.
 *
 * ## What this module refuses to do
 *
 * Every string here is a presentation of a field in `PeriodPrediction` or
 * `PeriodStats` — the fertile window, the cycle day, the logged-day count. There
 * is no scoring, no risk assessment and no advice: the reference's cards say
 * things like "Low chance of getting pregnant" and this app has no model behind
 * that sentence, so the card that would carry it carries the fertile *window*
 * instead, with the dates it actually came from.
 *
 * A card that cannot be built honestly from the response is not rendered at all,
 * rather than filled with a zero: `null` fields, a missing stats read and a
 * brand-new account all produce fewer cards, never a fabricated one.
 *
 * The first card on the row is not here. It is the action — "Log your
 * symptoms" — and it is part of the row component, because it is a control
 * rather than a fact about the data.
 */
import type { PeriodPrediction, PeriodStats } from '@/lib/period-types';
import type { DateOnly } from '@/lib/types';
import { METHOD_LABEL, daysBetween, rangeLabel, shortDate } from './labels';

export interface InsightCard {
  /** Stable key, and the probe's hook for which cards rendered. */
  key: 'fertile' | 'cycleDay' | 'loggedDays';
  /** The small heading inside the card. */
  label: string;
  /** The fact, at the card's largest size. */
  value: string;
  /** One line under the value, saying where it came from. */
  hint: string;
}

/**
 * The card row's contents, in reading order.
 *
 * Each entry is independent: a card whose source field is missing is dropped and
 * the rest keep their order, so the row never renders as a gap or a placeholder.
 */
export function insightCardsFor(input: {
  prediction: PeriodPrediction | undefined;
  stats: PeriodStats | undefined;
  /** The user's today, which the relative wording is measured against. */
  today: DateOnly;
}): InsightCard[] {
  const { prediction, stats, today } = input;
  const cards: InsightCard[] = [];

  /*
   * The fertile window, as a countdown (the brief's "N days until your fertile
   * window"). Inside the window the countdown has no number, so the card switches
   * to the day it ends — the same range the month grid paints as a halo.
   */
  const fertile = prediction?.fertileWindow;
  if (prediction?.dataSufficient && fertile) {
    const until = daysBetween(today, fertile.start);
    const inside = today >= fertile.start && today <= fertile.end;
    const hormonal = prediction.contraception.affectsPrediction;
    cards.push({
      key: 'fertile',
      label: 'Fertile window',
      value: inside ? 'Today' : until > 0 ? `in ${until} ${until === 1 ? 'day' : 'days'}` : 'Passed',
      hint: hormonal
        ? `Calendar estimate — ${
            prediction.contraception.activeMethod
              ? METHOD_LABEL[prediction.contraception.activeMethod]
              : 'a hormonal method'
          } in use`
        : inside
          ? `Ends ${shortDate(fertile.end)}`
          : rangeLabel(fertile.start, fertile.end),
    });
  }

  // Day N of the cycle, straight from the prediction (`asOf` is the server's today).
  if (prediction && prediction.currentCycleDay !== null) {
    cards.push({
      key: 'cycleDay',
      label: 'Cycle day',
      value: String(prediction.currentCycleDay),
      hint: prediction.lastPeriodStart ? `Since ${shortDate(prediction.lastPeriodStart)}` : 'Today',
    });
  }

  /*
   * How much history there is. `loggedDays` counts the days that carry a log in
   * the stats window; the hint deliberately does not name a window length, so a
   * change to the server's default cannot turn this into a wrong sentence.
   */
  if (stats && stats.loggedDays > 0) {
    cards.push({
      key: 'loggedDays',
      label: 'Days logged',
      value: String(stats.loggedDays),
      hint: stats.loggedDays === 1 ? 'One day recorded' : 'Days you have recorded',
    });
  }

  return cards;
}
