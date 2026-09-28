'use client';

/**
 * The cycle summary: three label / value / badge rows, each with an (i).
 *
 * ## Where this belongs
 *
 * The reference app shows this as a card of rows. It is a *summary of the
 * recorded history*, so it belongs on Insights — the screen that already owns the
 * prediction, the cycle charts and the basis — and not on the cycle month, whose
 * subject is the day grid. The month keeps the prediction headline; this is the
 * reading of the three numbers the month cannot state.
 *
 * ## The badge is computed, never decorative
 *
 * Every badge comes from `@/lib/period-insights`, where the thresholds are
 * published ranges with their sources in the file comment: 21–35 days for a cycle
 * (NHS), 2–7 days of bleeding (NHS), and a shortest-to-longest spread of 7 days
 * for the variation row. A row with no measurement gets **no badge** rather than a
 * neutral one — an unmeasured value is not "in the usual range", it is unmeasured.
 *
 * The word is deliberately not "abnormal". A cycle outside 21–35 days is outside a
 * range, not a diagnosis, so the badge says "Outside the usual range" and the
 * variation row says "Wider variation". Each (i) states the range and where it
 * comes from, so the claim the badge makes can be read where it is made.
 *
 * ## Why there is no assistant block
 *
 * The reference puts a speech bubble with a small avatar disc under the rows. This
 * app has no assistant and no model behind the screen, so drawing one would imply
 * a conversation that cannot happen and would give the appearance of advice. The
 * honest version of that block is the explanatory card this component already is:
 * the (i) text under each row and the group's footer, which name the thresholds
 * and say plainly that they describe where a number sits rather than what it
 * means. Nothing here is a chat, and nothing here is a diagnosis.
 *
 * ## The (i) is a disclosure, not a tooltip
 *
 * It is a real `<button>` with `aria-expanded` and `aria-controls` pointing at the
 * line it reveals, so it is reachable by keyboard (Tab, then Enter/Space) and its
 * state is announced. A hover tooltip would be invisible to a screen reader, to a
 * keyboard and to a screenshot, which is the same reason the charts in
 * `./charts` write their readings into text.
 */
import { useId, useState } from 'react';
import { InfoCircledIcon } from '@svg-animated-icons/react/info-circled';
import { SettingsGroup, SettingsRow } from '@/components/settings/SettingsGroup';
import { Badge } from '@/components/ui/badge';
import {
  cycleLengthVerdict,
  cycleVariationVerdict,
  periodLengthVerdict,
  type SummaryVerdict,
} from '@/lib/period-insights';
import { cn } from '@/lib/utils';

export interface CycleSummaryProps {
  /** Days from the previous period start to the most recent one, or null. */
  previousCycleLengthDays: number | null;
  /** The most recent recorded bleed, in days, or null when no end was logged. */
  previousPeriodLengthDays: number | null;
  /** The shortest and longest measured cycle, for the variation row. */
  shortestCycleDays: number | null;
  longestCycleDays: number | null;
}

/** A day count, or an honest dash. */
function daysValue(value: number | null): string {
  if (value === null) return '—';
  return `${value} ${value === 1 ? 'day' : 'days'}`;
}

function SummaryRow({ label, value, verdict }: { label: string; value: string; verdict: SummaryVerdict | null }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();

  return (
    <SettingsRow stacked>
      <div className="flex items-start gap-2">
        <span className="min-w-0 flex-1 text-sm text-muted-foreground">{label}</span>
        {verdict ? (
          <button
            type="button"
            onClick={() => setOpen((current) => !current)}
            aria-expanded={open}
            aria-controls={panelId}
            aria-label={`What “${label}” means, and the range it is judged against`}
            className="inline-flex size-6 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <InfoCircledIcon className="size-4" />
          </button>
        ) : null}
      </div>

      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="text-xl font-semibold tabular-nums">{value}</span>
        {verdict ? (
          /*
           * Monochrome, and not alarming: `outline` is the quieter mark, so the
           * *usual* rows take it and a row outside the range takes the filled
           * `secondary` one. The difference is fill, not red — the palette has no
           * hue to spend here and the user asked for the warning treatment gone.
           */
          <Badge variant={verdict.status === 'usual' ? 'outline' : 'secondary'}>
            <span className={cn(verdict.status === 'usual' && 'text-muted-foreground')}>{verdict.badge}</span>
          </Badge>
        ) : null}
      </div>

      {verdict && open ? (
        <p id={panelId} className="text-xs leading-relaxed text-muted-foreground">
          {verdict.explanation}
        </p>
      ) : null}
    </SettingsRow>
  );
}

export function CycleSummary({
  previousCycleLengthDays,
  previousPeriodLengthDays,
  shortestCycleDays,
  longestCycleDays,
}: CycleSummaryProps) {
  const variation =
    shortestCycleDays !== null && longestCycleDays !== null
      ? `${shortestCycleDays}–${longestCycleDays} days`
      : '—';

  return (
    <SettingsGroup
      title="Cycle summary"
      footer="The ranges are from NHS guidance on the menstrual cycle. They describe where a number sits against a published range — not what it means for you, and not a diagnosis."
    >
      <SummaryRow
        label="Previous cycle length"
        value={daysValue(previousCycleLengthDays)}
        verdict={cycleLengthVerdict(previousCycleLengthDays)}
      />
      <SummaryRow
        label="Previous period length"
        value={daysValue(previousPeriodLengthDays)}
        verdict={periodLengthVerdict(previousPeriodLengthDays)}
      />
      <SummaryRow
        label="Cycle length variation"
        value={variation}
        verdict={cycleVariationVerdict(shortestCycleDays, longestCycleDays)}
      />
    </SettingsGroup>
  );
}
