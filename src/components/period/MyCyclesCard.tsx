'use client';

/**
 * "My cycles": the recorded lengths, newest first.
 *
 * The heading is the reference's second section, and the content is the one thing
 * a cycle list can honestly be — the intervals between recorded period starts,
 * which is exactly what `PeriodStats.cycleLengths` is. It is the same array the
 * Insights charts plot; this is the list form of it, for the screen that is about
 * today rather than about the trend.
 *
 * ## Why the wording is so plain
 *
 * A cycle length is *measured* between two starts, so it cannot exist for the
 * cycle that is still running, and the most recent entry is therefore always one
 * cycle behind today. The card says "N measured cycles" rather than "your last N
 * cycles", and it shows the two dates a length came from, so the number is never
 * a bare assertion: it is the distance between the two dates printed beside it.
 *
 * Nothing here is a judgement — "regular" is not a word this card uses, because
 * the contract does not define it. The standard deviation is printed as the ± it
 * is (`28 ± 2.4`), which is what the API actually measured.
 */
import type { PeriodStats } from '@/lib/period-types';
import { shortDate } from './labels';

/** How many measured cycles the list shows before it stops being a list. */
const RECENT_CYCLES = 3;

/** The heading's id, so the section can be named by it. One card per screen. */
const HEADING_ID = 'my-cycles-heading';

export interface MyCyclesCardProps {
  stats: PeriodStats | undefined;
}

export function MyCyclesCard({ stats }: MyCyclesCardProps) {
  const lengths = stats?.cycleLengths ?? [];
  // Newest first: the list answers "what has my cycle been doing lately".
  const recent = lengths.slice(-RECENT_CYCLES).reverse();

  return (
    <section aria-labelledby={HEADING_ID} className="flex flex-col gap-2 px-gutter">
      <h2 id={HEADING_ID} className="text-sm font-semibold">
        My cycles
      </h2>

      <div
        data-cycles-card="recent"
        className="flex flex-col gap-2 rounded-xl border border-border bg-card p-card text-card-foreground shadow-xs"
      >
        {recent.length === 0 ? (
          <>
            <p className="text-sm">No completed cycles yet</p>
            <p className="text-xs text-muted-foreground">
              A cycle length is measured between two recorded period starts, so the first one appears after the
              second period.
            </p>
          </>
        ) : (
          <>
            <ul className="flex flex-col gap-2">
              {recent.map((cycle) => (
                <li key={cycle.from} className="flex items-baseline justify-between gap-2">
                  <span className="min-w-0 truncate text-sm text-muted-foreground">
                    {shortDate(cycle.from)} → {shortDate(cycle.to)}
                  </span>
                  <span className="shrink-0 text-sm font-semibold tabular-nums">{cycle.days} days</span>
                </li>
              ))}
            </ul>

            {stats?.averageCycleLengthDays !== null && stats?.averageCycleLengthDays !== undefined ? (
              <p className="text-xs text-muted-foreground">
                Average {stats.averageCycleLengthDays} days
                {stats.standardDeviationDays !== null && stats.standardDeviationDays !== undefined
                  ? ` ± ${stats.standardDeviationDays}`
                  : ''}{' '}
                over {lengths.length} measured {lengths.length === 1 ? 'cycle' : 'cycles'}.
              </p>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}
