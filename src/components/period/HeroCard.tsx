'use client';

/**
 * The Today screen's hero: the number, the sentence, and the day's period action.
 *
 * ## One card, not two
 *
 * The screen used to open with a `PredictionSummary` card and a separate "Period"
 * card holding "My period started today". The reference puts one big card at the
 * top and one obvious button in it, and this is that card: the words come from
 * `./hero`, and the button *is* the period action the old card offered — so the
 * screen has exactly one place to record a period rather than two that could
 * disagree about which cycle is open. What was a correction in the old card
 * ("Remove this period", "add a past period") is kept beside the button, at a
 * lower weight, because losing it would strand a user who mis-tapped.
 *
 * `PredictionSummary` stays on the screen directly below: the hero carries the
 * headline and its ± band, and the summary carries the basis, the current cycle
 * day and the API's `meaning` sentence in full. The hero must never be the only
 * place a number appears, because a headline is exactly where a caveat gets lost.
 *
 * ## The number is the largest type on the screen
 *
 * `text-5xl` on the count and nothing else near it: the lead-in and the sentence
 * are both `text-sm`, so the eye lands on "8 days" first and the sentence reads as
 * context rather than as a second headline. The whole block is `aria-live`
 * because it changes when a day is tapped — the same reason the prediction card's
 * range is (see `PredictionSummary`).
 */
import { RotateCounterClockwiseIcon } from '@svg-animated-icons/react/rotate-counter-clockwise';
import { TrashIcon } from '@svg-animated-icons/react/trash';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import type { PeriodCycle, PeriodPrediction } from '@/lib/period-types';
import type { DateOnly } from '@/lib/types';
import { heroFor, periodActionFor } from './hero';
import { longDate } from './labels';

export interface HeroCardProps {
  prediction: PeriodPrediction | undefined;
  /** The day the screen is about. */
  selectedDate: DateOnly;
  /** The cycle covering the selected day, or null when none does. */
  coveringCycle: PeriodCycle | null;
  /** Start a period on this day. */
  onStart: (date: DateOnly) => void;
  /** Close the open period on this day. */
  onEnd: (cycle: PeriodCycle, date: DateOnly) => void;
  onRemove: (cycle: PeriodCycle) => void;
  /** Opens the "add a past period" sheet; the rewind control beside the button. */
  onAddPast: () => void;
}

export function HeroCard({
  prediction,
  selectedDate,
  coveringCycle,
  onStart,
  onEnd,
  onRemove,
  onAddPast,
}: HeroCardProps) {
  const hero = heroFor(prediction, selectedDate);
  const action = periodActionFor(coveringCycle, selectedDate);

  if (!hero) {
    return (
      <section
        aria-label="Cycle estimate"
        className="flex flex-col items-center gap-3 rounded-3xl border border-border bg-card p-card text-card-foreground shadow-xs"
      >
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-12 w-40" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-11 w-full rounded-full" />
      </section>
    );
  }

  return (
    <section
      aria-label="Cycle estimate"
      className="flex flex-col items-center gap-3 rounded-3xl border border-border bg-card p-card text-center text-card-foreground shadow-xs"
    >
      <div aria-live="polite" className="flex flex-col items-center gap-2">
        <p data-hero="lead" className="text-sm text-muted-foreground">
          {hero.leadIn}
        </p>
        {/* The centrepiece: the largest type on the screen, by a wide margin. */}
        <p data-hero="value" className="text-5xl leading-none font-semibold tracking-tight tabular-nums">
          {hero.value}
        </p>
        <p data-hero="sentence" className="text-sm text-balance text-muted-foreground">
          {hero.sentence}
        </p>
      </div>

      {/*
        The screen's primary action, and the only pill on it: full width, taller
        than the form's controls, and the one control that writes a period. It
        says what it will do for *this* day — the label changes with the cycle the
        day sits in — because a button that says "Log period" over a day that
        already has one is how a duplicate is created.
      */}
      <Button
        type="button"
        className="h-11 w-full rounded-full text-base"
        disabled={action.disabled}
        aria-label={
          action.key === 'start'
            ? `Log a period starting ${longDate(selectedDate)}`
            : action.key === 'end'
              ? `End the open period on ${longDate(selectedDate)}`
              : `A period is already recorded on ${longDate(selectedDate)}`
        }
        onClick={() => {
          if (action.key === 'start') onStart(selectedDate);
          else if (action.key === 'end' && coveringCycle) onEnd(coveringCycle, selectedDate);
        }}
      >
        {action.label}
      </Button>

      {/*
        The corrections, at a lower weight: a "Log period" tap is one tap too easy
        to make on the wrong day, and the sheet on the cycle month is a screen
        away. The rewind icon keeps its meaning from the card it came from — "go
        back and enter something from before" — and it stays visible whether or
        not a period covers this day, because that is when it is needed.
      */}
      <div className="flex w-full items-center justify-end gap-2">
        {coveringCycle ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-9 gap-1.5 px-2 text-muted-foreground"
            onClick={() => onRemove(coveringCycle)}
          >
            <TrashIcon className="size-4 text-base" />
            Remove this period
          </Button>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-9 w-9 shrink-0 px-0 text-muted-foreground"
          aria-label="Add a past period"
          onClick={onAddPast}
        >
          <RotateCounterClockwiseIcon className="size-4 text-base" />
        </Button>
      </div>
    </section>
  );
}
