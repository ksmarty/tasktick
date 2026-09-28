'use client';

/**
 * The prediction, as a range, with its basis.
 *
 * ## The one rule this component exists to enforce
 *
 * **A prediction is never a single confident date.** The contract computes
 * `nextPeriodStart` *and* an `uncertainty` half-width from the user's own spread
 * (or a documented default when there is not enough history), and this component
 * renders both together or not at all: "around 14–17 Oct ± 3 days, from your last
 * 6 cycles, average 29 days". A bare `14 Oct` in 24pt type would be the app
 * asserting something the data does not support, and it is the failure mode the
 * whole prediction API was shaped to avoid.
 *
 * ## The ± sits beside the range
 *
 * It used to sit under it, in a sentence: the range on one line, then
 * `Around ± 3 days from your own cycles. Expected in 4 days.` on the next. The
 * user asked for the ± to the right of the date range instead, so the two are one
 * line — range at the card's own size, ± small and muted beside it — and what
 * follows the date is the timing alone. The `±` still comes from
 * `uncertainty.days`, and whether it is the user's own spread or a default is still
 * stated in words (`(a default)`), because `observed` and `default` are different
 * claims.
 *
 * ## Why the ovulation estimate carries the same band
 *
 * `ovulationDate` arrives as one date, and it is a *worse* estimate than the
 * period date: it is that date minus the luteal phase, so it inherits every bit of
 * the spread and adds the luteal assumption. Showing it as a precise day would
 * undo the honesty of the line above it, so it is rendered with the same
 * uncertainty and labelled an estimate.
 *
 * Two variants, one set of words: `compact` for the Today screen and the top of
 * the cycle month, `full` for when the card is the point of the screen. Both read
 * the same fields, so the two can never tell the user different stories.
 */
import { CalendarIcon } from '@svg-animated-icons/react/calendar';
import { InfoCircledIcon } from '@svg-animated-icons/react/info-circled';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import type { PeriodPrediction } from '@/lib/period-types';
import { METHOD_LABEL, inDaysLabel, plusMinus, rangeLabel } from './labels';

export interface PredictionSummaryProps {
  prediction: PeriodPrediction | undefined;
  /** The user's today, for "in 4 days" / "3 days late". */
  today: string;
  /**
   * How much of the prediction to show.
   *
   *  · `headline` — the range, its band, how far off it is, and what it means.
   *    For the cycle month, where the month grid is the point and the detailed
   *    basis has a screen of its own. Reading the month screen made this
   *    necessary: the full card pushed the month itself below the fold.
   *  · `compact` — adds the basis line and the ovulation/fertile window in words.
   *    For the Today screen.
   *  · `full` — adds the calendar-method window, the notes and the measured
   *    intervals.
   */
  variant?: 'headline' | 'compact' | 'full';
  className?: string;
}

export function PredictionSummary({ prediction, today, variant = 'compact', className }: PredictionSummaryProps) {
  if (!prediction) {
    return (
      <div className={cn('flex flex-col gap-2 rounded-xl border border-border bg-card p-card', className)}>
        <Skeleton className="h-5 w-40" />
        {variant === 'headline' ? null : <Skeleton className="h-4 w-full" />}
      </div>
    );
  }

  const { uncertainty, basis } = prediction;
  const full = variant === 'full';
  /*
   * The headline drops the basis line and the window in words — both are one
   * screen away on Insights. What it must never drop is the range or its band:
   * a bare date is exactly the claim this whole component exists to avoid.
   */
  const headline = variant === 'headline';

  return (
    <section
      className={cn(
        'flex flex-col gap-2 rounded-xl border border-border bg-card p-card text-card-foreground shadow-xs',
        className,
      )}
      aria-label="Next period prediction"
    >
      <div className="flex items-center gap-2">
        <CalendarIcon className="size-4 text-base text-muted-foreground" />
        <h2 className="min-w-0 flex-1 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
          Next period
        </h2>
      </div>

      {prediction.dataSufficient && prediction.nextPeriodStart ? (
        <>
          {/* The range and the band on one line, stated together — the range at
              the card's own size, the ± small beside it. It used to be the range
              on one line and `Around ± 3 days from your own cycles.` on the next,
              which is the pair the user asked to have moved together; the prose
              half of that sentence is gone with it. */}
          <p className="flex flex-wrap items-baseline gap-x-2" aria-live="polite">
            <span className="text-lg font-semibold">
              {rangeLabel(prediction.nextPeriodStart, prediction.nextPeriodEnd ?? prediction.nextPeriodStart)}
            </span>
            {uncertainty ? (
              <span className="text-sm font-medium text-muted-foreground tabular-nums">
                {plusMinus(uncertainty.days)}
                {uncertainty.source === 'default' ? ' (a default)' : ''}
              </span>
            ) : null}
          </p>

          {/* What is left of the sentence under the date: when it is expected, or
              how late the estimate is. Nothing here repeats the ±. */}
          <p className="text-sm text-muted-foreground">
            {prediction.overdueDays && prediction.overdueDays > 0
              ? `The estimate passed ${prediction.overdueDays} ${prediction.overdueDays === 1 ? 'day' : 'days'} ago, so this is the next expected date.`
              : inDaysLabel(prediction.nextPeriodStart, today) === 'today'
                ? 'Today.'
                : `In ${inDaysLabel(prediction.nextPeriodStart, today)}.`}
          </p>

          {headline ? null : (
            <p className="text-xs text-muted-foreground">
              {basis.cycleCount} {basis.cycleCount === 1 ? 'cycle' : 'cycles'}
              {basis.averageCycleLengthDays !== null ? ` · avg ${Math.round(basis.averageCycleLengthDays)}` : ''}
              {basis.standardDeviationDays !== null ? ` ± ${Math.round(basis.standardDeviationDays)} days` : ''}
            </p>
          )}

          {headline || prediction.currentCycleDay === null ? null : (
            <p className="text-xs text-muted-foreground">
              Day {prediction.currentCycleDay}
              {prediction.lastPeriodStart ? ` · started ${rangeLabel(prediction.lastPeriodStart, prediction.lastPeriodStart)}` : ''}
            </p>
          )}

          {headline || !prediction.ovulationDate ? null : (
            <p className="text-xs text-muted-foreground">
              Ovulation ~{rangeLabel(prediction.ovulationDate, prediction.ovulationDate)}
            </p>
          )}

          {headline || !prediction.fertileWindow ? null : (
            <p className="text-xs text-muted-foreground">
              Fertile {rangeLabel(prediction.fertileWindow.start, prediction.fertileWindow.end)}
            </p>
          )}

          {full && prediction.calendarMethodWindow ? (
            <p className="text-xs text-muted-foreground">
              Calendar method (shortest and longest cycles) gives{' '}
              {rangeLabel(prediction.calendarMethodWindow.start, prediction.calendarMethodWindow.end)}.
            </p>
          ) : null}
        </>
      ) : (
        <>
          <p className="text-sm font-medium">Not enough history yet</p>
          <p className="text-xs leading-relaxed text-muted-foreground">
            {prediction.reason ??
              'Two recorded period starts are the minimum for a length, and a prediction of one date is not worth showing before that.'}
          </p>
          {prediction.lastPeriodStart ? (
            <p className="text-xs text-muted-foreground">
              Last recorded period began{' '}
              {rangeLabel(prediction.lastPeriodStart, prediction.lastPeriodStart)}
              {prediction.currentCycleDay !== null ? ` — day ${prediction.currentCycleDay} of that cycle.` : '.'}
            </p>
          ) : null}
        </>
      )}

      {/*
        What the numbers mean. Always rendered: the API sends it unconditionally
        precisely because a fertile-window estimate under a hormonal method would
        otherwise read as a statement about fertility.
      */}
      <p className="flex gap-2 text-xs leading-relaxed text-muted-foreground">
        <InfoCircledIcon className="mt-0.5 size-4 shrink-0 text-base" />
        <span>{prediction.meaning}</span>
      </p>

      {prediction.contraception.affectsPrediction && prediction.contraception.hormonal ? (
        <p className="text-xs leading-relaxed text-muted-foreground">
          {prediction.contraception.activeMethod
            ? `${METHOD_LABEL[prediction.contraception.activeMethod]} suppresses ovulation, so the ovulation and fertile-window estimates above are not a statement about your fertility.`
            : 'A hormonal method suppresses ovulation, so the ovulation and fertile-window estimates above are not a statement about your fertility.'}
        </p>
      ) : null}

      {full
        ? prediction.notes.map((note) => (
            <p key={note} className="text-xs leading-relaxed text-muted-foreground">
              {note}
            </p>
          ))
        : null}
      {full && prediction.basis.intervalLengths.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          Measured intervals, oldest first: {prediction.basis.intervalLengths.join(', ')} days.
          {basis.shortestCycleDays !== null && basis.longestCycleDays !== null
            ? ` Shortest ${Math.round(basis.shortestCycleDays)}, longest ${Math.round(basis.longestCycleDays)}.`
            : ''}
        </p>
      ) : null}
    </section>
  );
}

