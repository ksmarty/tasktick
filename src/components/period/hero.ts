/**
 * The hero card's words: what is next, how far off it is, and what that means.
 *
 * ## Why this is a separate, pure module
 *
 * The hero is the largest thing on the Today screen, so it is the one place where
 * a wrong number is read before anything else. Everything it says is therefore a
 * *presentation* of fields the API already returned — the ovulation estimate, the
 * fertile window, the next period start and end, the uncertainty band — and the
 * arithmetic is limited to counting days between two dates the server sent (the
 * same `daysBetween` the rest of the labels use). Nothing here re-derives a cycle
 * or projects a second one; see `@/lib/period-math` for the model, which stays on
 * the server.
 *
 * Being pure means the branches can be tested against a prediction built by the
 * real `buildPeriodPrediction`, rather than against a hand-written fixture that
 * could agree with a bug.
 *
 * ## The reference said "Low chance of getting pregnant". This app cannot say that.
 *
 * The contract has no conception-probability model: it has a fertile *window*
 * derived from an ovulation estimate, and an uncertainty band. A percentage would
 * be invented, so the honest sentence names the window instead — which is the
 * case the brief allowed for ("if the honest sentence is 'Fertile window' rather
 * than a chance of conception, say that"). Under a hormonal method the API marks
 * the estimate as not a fertility statement at all, and the sentence says so
 * rather than staying silent.
 *
 * ## The four shapes
 *
 *  · **Ovulation in** — the selected day is on or before the estimated ovulation
 *    day, so the estimate that matters is the fertile window that ends there.
 *  · **Period in** — ovulation has passed, so the next milestone is the predicted
 *    period. Its sentence carries the range *and* the ± band: a big number on its
 *    own would read as more certain than the data is.
 *  · **Cycle day** — no milestone is ahead of the selected day. That happens for a
 *    day in the week *after* the predicted period (the API anchors its estimate on
 *    today and does not project a second cycle), and for an account with one
 *    recorded period and no measured length. Counting the day of the expected
 *    cycle is factual in both cases; inventing a later date would not be.
 *  · **No history** — nothing recorded at all: no number can be honest, so the
 *    card shows the reason the API gives and the importer leads the screen.
 */
import type { PeriodCycle, PeriodPrediction } from '@/lib/period-types';
import type { DateOnly } from '@/lib/types';
import { daysBetween, inDaysLabel, plusMinus, rangeLabel, shortDate } from './labels';

export interface HeroView {
  /** The small line above the number: `Ovulation in`, `Period in`, `Cycle day`. */
  leadIn: string;
  /** The large line: `8 days`, `1 day`, `Today`, or a bare day number. */
  value: string;
  /** One sentence of context. Derived from the prediction, never invented. */
  sentence: string;
}

/** `Today` / `1 day` / `8 days` — the count, phrased as the big line. */
function countValue(days: number): string {
  if (days === 0) return 'Today';
  return days === 1 ? '1 day' : `${days} days`;
}

/**
 * `Ovulation` + `Today`, `Ovulation in` + `8 days`.
 *
 * The lead-in changes with the count rather than printing `in Today`, which is
 * what the reference's own switcheroo does one level up (ovulation or period,
 * whichever is next).
 */
function countLead(base: string, days: number): string {
  return days === 0 ? base : `${base} in`;
}

/**
 * What the fertile window means for the selected day.
 *
 * `fertileWindow` is the API's own six-day window (five days before ovulation
 * through ovulation day, clamped into the cycle), so every branch here is a
 * statement about a range the server computed and none of them is a probability.
 */
function fertileSentence(prediction: PeriodPrediction, selectedDate: DateOnly): string {
  const window = prediction.fertileWindow;
  if (!window) return prediction.meaning;

  if (selectedDate >= window.start && selectedDate <= window.end) {
    return `Inside the fertile window, which ends ${shortDate(window.end)}.`;
  }
  if (selectedDate < window.start) {
    return `Your fertile window opens ${inDaysLabel(window.start, selectedDate)}.`;
  }
  return `The fertile window for this cycle ended ${shortDate(window.end)}.`;
}

/**
 * The sentence for a day whose next milestone is a period.
 *
 * The range and the ± band, both straight off the prediction: `PredictionSummary`
 * says the same thing in more words one card down, and the two cannot disagree
 * because both read `nextPeriodStart` / `nextPeriodEnd` / `uncertainty`.
 */
function periodSentence(prediction: PeriodPrediction): string {
  const start = prediction.nextPeriodStart!;
  const end = prediction.nextPeriodEnd ?? start;
  const band = prediction.uncertainty ? ` ${plusMinus(prediction.uncertainty.days)}` : '';
  return `Expected ${rangeLabel(start, end)}${band}.`;
}

/**
 * The hero for a selected day, or null while the prediction is still loading.
 *
 * `selectedDate` is the day the screen is about — today by default — so tapping a
 * day in the week strip moves this with everything else below it.
 */
export function heroFor(prediction: PeriodPrediction | undefined, selectedDate: DateOnly): HeroView | null {
  if (!prediction) return null;

  const { contraception, nextPeriodStart, nextPeriodEnd, ovulationDate } = prediction;

  if (prediction.dataSufficient) {
    /*
     * Ovulation first: it is the earlier of the two estimates by construction
     * (`ovulationDate` is the predicted period start minus the luteal phase), so
     * "whichever comes next" is a direct comparison and needs no ordering rule.
     */
    if (ovulationDate && selectedDate <= ovulationDate) {
      const days = daysBetween(selectedDate, ovulationDate);
      const sentence =
        contraception.affectsPrediction && contraception.hormonal
          ? 'A calendar estimate only — a hormonal method suppresses ovulation, so this is not a fertility statement.'
          : fertileSentence(prediction, selectedDate);
      return { leadIn: countLead('Ovulation', days), value: countValue(days), sentence };
    }

    if (nextPeriodStart && selectedDate <= nextPeriodStart) {
      const days = daysBetween(selectedDate, nextPeriodStart);
      return { leadIn: countLead('Period', days), value: countValue(days), sentence: periodSentence(prediction) };
    }

    if (nextPeriodStart) {
      const start = nextPeriodStart;
      const day = daysBetween(start, selectedDate) + 1;
      return {
        leadIn: 'Cycle day',
        value: String(day),
        sentence: `Counting from the period expected around ${rangeLabel(start, nextPeriodEnd ?? start)}.`,
      };
    }
  }

  /*
   * No usable estimate. `lastPeriodStart` is still a date the server sent, and
   * "day N of that cycle" is the same arithmetic the API's own `currentCycleDay`
   * uses — shown with the API's reason underneath rather than a blank card.
   */
  if (prediction.lastPeriodStart && selectedDate >= prediction.lastPeriodStart) {
    const day = daysBetween(prediction.lastPeriodStart, selectedDate) + 1;
    return {
      leadIn: 'Cycle day',
      value: String(day),
      sentence: prediction.reason ?? prediction.meaning,
    };
  }

  return {
    leadIn: 'No history yet',
    value: '—',
    sentence: prediction.reason ?? prediction.meaning,
  };
}

/* -------------------------------------------------------------------------- */
/* the card's primary action                                                   */
/* -------------------------------------------------------------------------- */

/**
 * What the hero's pill button does for the selected day.
 *
 * The button is the screen's one period control — the card it replaces used to
 * offer the same action in a second place — so it carries every state the cycle
 * contract can be in on one day, and the states that would be a no-op or a
 * duplicate are said rather than offered:
 *
 *  · **start** — nothing recorded on this day; the button records a period that
 *    begins here. This is the reference's "Log Period".
 *  · **end** — the day is inside a period that is still open, so the one period
 *    action left is to close it here.
 *  · **logged** — a period already starts on this day (the contract has a unique
 *    index on the start date, so a second start is impossible) or covers it; the
 *    button says so and is disabled, rather than being hidden and leaving the
 *    card's main slot empty.
 */
export interface PeriodAction {
  key: 'start' | 'end' | 'logged';
  label: string;
  disabled: boolean;
}

export function periodActionFor(covering: PeriodCycle | null, selectedDate: DateOnly): PeriodAction {
  if (!covering) return { key: 'start', label: 'Log period', disabled: false };
  if (covering.startDate === selectedDate) return { key: 'logged', label: 'Period logged', disabled: true };
  if (covering.endDate === null) return { key: 'end', label: 'Period ended', disabled: false };
  return { key: 'logged', label: 'Period logged', disabled: true };
}
