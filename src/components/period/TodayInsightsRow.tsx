'use client';

/**
 * "My daily insights": a heading, and one row that scrolls sideways.
 *
 * ## The first card is the action, the rest are facts
 *
 * The row leads with "Log your symptoms" and a large `+`, because the reference
 * does and because it is the one thing on this screen the user may have come to
 * *do*. It is a plain button that brings the day-log form below into view and
 * focuses it — it does not open a second copy of that form in a sheet, which is
 * exactly the duplication the brief warned about: the Today screen already
 * renders the real form, and a sheet holding the same fields would be a second
 * place for one day's values to be edited.
 *
 * The cards after it come from `./today-insights`, which only states what the API
 * returned. Nothing in this row is advice.
 *
 * ## The row is full-bleed on purpose
 *
 * A snapping row inside the page gutter clips its own edge: the first card would
 * start at the gutter and the last would stop one gutter short of the screen, so
 * the row would never look like it continues. The heading and every other card on
 * the screen keep the gutter; this row and only this row runs edge to edge, with
 * `px-gutter` as its scroll padding so a snapped card still lands on the gutter
 * line. `snap-mandatory` + `snap-start` is what makes a flick land on a card
 * rather than between two.
 *
 * The scroller is `overflow-x-auto` and nothing else: no mask, no fade, because
 * the row is short (four cards) and a fade on a row that can be scrolled to its
 * end would dim a card the user can already see.
 */
import { useMemo } from 'react';
import { PlusIcon } from '@svg-animated-icons/react/plus';
import type { PeriodPrediction, PeriodStats } from '@/lib/period-types';
import type { DateOnly } from '@/lib/types';
import { insightCardsFor } from './today-insights';

/** The heading's id, so the group can be named by it. One row per screen. */
const HEADING_ID = 'today-insights-heading';

export interface TodayInsightsRowProps {
  prediction: PeriodPrediction | undefined;
  stats: PeriodStats | undefined;
  /** The user's today; the cards' relative wording is measured against it. */
  today: DateOnly;
  /** Brings the day-log form into view and focuses it. */
  onLogSymptoms: () => void;
}

export function TodayInsightsRow({ prediction, stats, today, onLogSymptoms }: TodayInsightsRowProps) {
  const cards = useMemo(() => insightCardsFor({ prediction, stats, today }), [prediction, stats, today]);

  return (
    <section aria-labelledby={HEADING_ID} className="flex flex-col gap-2">
      <h2 id={HEADING_ID} className="px-gutter text-sm font-semibold">
        My daily insights
      </h2>

      <div
        data-insights-row="today"
        className="flex snap-x snap-mandatory scroll-px-gutter gap-2 overflow-x-auto px-gutter pb-1"
      >
        <button
          type="button"
          data-insight-card="log"
          onClick={onLogSymptoms}
          className="flex w-44 shrink-0 snap-start cursor-pointer flex-col items-start gap-2 rounded-xl border border-border bg-card p-card text-left text-card-foreground shadow-xs"
        >
          {/* The large `+`: a bordered circle rather than a glyph alone, so the
              card reads as an action beside cards that are only text. */}
          <span
            aria-hidden
            className="flex size-10 items-center justify-center rounded-full border border-border bg-muted"
          >
            <PlusIcon className="size-5 text-base text-foreground" />
          </span>
          <span className="text-sm font-medium">Log your symptoms</span>
          <span className="text-xs text-muted-foreground">Flow, mood and the rest of today</span>
        </button>

        {cards.map((card) => (
          <article
            key={card.key}
            data-insight-card={card.key}
            className="flex w-44 shrink-0 snap-start flex-col gap-1 rounded-xl border border-border bg-card p-card text-card-foreground shadow-xs"
          >
            <h3 className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">{card.label}</h3>
            <p className="text-2xl leading-none font-semibold tabular-nums">{card.value}</p>
            <p className="text-xs text-muted-foreground">{card.hint}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
