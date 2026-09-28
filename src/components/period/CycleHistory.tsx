'use client';

/**
 * Cycle history: the recent cycles, each with its length, its date range and a
 * dot strip.
 *
 * ## What it reads, and why that is the honest source
 *
 * The cycle *ranges* come from `GET /api/period/cycles` (`PeriodCycle[]`) — the
 * row that carries `startDate` and the recorded `endDate` — and the *lengths*
 * come from the stats payload's `cycleLengths`, which is the measured interval
 * between consecutive starts. Both are server-computed; nothing here re-derives a
 * cycle length or a fertile window. The one date this component works out is the
 * last day of a range, and it does that by taking the last entry of the strip
 * `cycleStripDays` already enumerated, not by adding days itself.
 *
 * Day logs are deliberately not read. A cycle's `endDate` is the cycle-level
 * record of the bleed, and it is the same fallback the calendar month uses
 * (`markers.ts`); a day log adds per-day detail the strip does not draw, and a
 * second read for it would be a round trip for nothing.
 *
 * ## The fertile mark only appears where it exists
 *
 * `PeriodPrediction` carries one fertile window, for the current cycle. A
 * completed cycle has no stored window of its own, so its strip shows period days
 * and nothing else — the client must never re-run cycle maths (`period-math.ts`),
 * and inventing a window would be a claim the data does not support. The note at
 * the foot of the card says so, so an absent lighter dot is not read as "no
 * fertile window".
 *
 * ## "See all" is a toggle, not a dead link
 *
 * The reference shows "See all >". There is no second history screen to send it
 * to, and a link that does nothing is worse than no link, so it expands the list
 * in place: the three most recent cycles first, every recorded cycle on request.
 * It is a real `<button>` with `aria-expanded`, so the state is announced.
 */
import { useMemo, useState } from 'react';
import { ExclamationTriangleIcon } from '@svg-animated-icons/react/exclamation-triangle';
import { SettingsGroup, SettingsRow } from '@/components/settings/SettingsGroup';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import type { Resource } from '@/lib/store';
import { cycleStripDays, type CycleInterval } from '@/lib/period-insights';
import type { PeriodCycle, PeriodPrediction } from '@/lib/period-types';
import type { DateOnly } from '@/lib/types';
import { CycleDotStrip, CycleStripKey, CycleStripNote } from './CycleDotStrip';
import { daysBetween, rangeLabel, shortDate } from './labels';

/** How many cycles the card shows before "See all" is used. */
const VISIBLE_CYCLES = 3;

interface HistoryRow {
  startDate: DateOnly;
  endDate: DateOnly | null;
  /** The measured length, or the days elapsed for the cycle still running. */
  lengthDays: number;
  /** True for the cycle that has no measured interval after it yet. */
  current: boolean;
  /** The prediction's fertile window, passed to the current cycle only. */
  fertileWindow: { start: DateOnly; end: DateOnly } | null;
}

/**
 * The rows, newest first: the running cycle, then each measured interval.
 *
 * A cycle whose interval the stats payload left out (a gap longer than
 * `MAX_PLAUSIBLE_CYCLE_DAYS`) is not given a length here — the stats filter exists
 * precisely so a logging gap is not described as a cycle — so it is left out of
 * the list rather than shown with a fabricated one, and the basis card notes the
 * omission. The current cycle is the only row allowed to be partial.
 */
function buildRows(cycles: PeriodCycle[], intervals: CycleInterval[], prediction: PeriodPrediction | undefined, today: DateOnly): HistoryRow[] {
  const sorted = [...cycles].sort((a, b) => a.startDate.localeCompare(b.startDate));
  const byStart = new Map(sorted.map((cycle) => [cycle.startDate, cycle]));

  const complete: HistoryRow[] = [...intervals]
    .reverse()
    .map((interval) => ({
      startDate: interval.from,
      endDate: byStart.get(interval.from)?.endDate ?? null,
      lengthDays: interval.days,
      current: false,
      fertileWindow: null,
    }));

  const last = sorted[sorted.length - 1];
  if (!last) return complete;

  const elapsed = Math.max(1, daysBetween(last.startDate, today) + 1);
  const current: HistoryRow = {
    startDate: last.startDate,
    endDate: last.endDate,
    lengthDays: prediction?.currentCycleDay ?? elapsed,
    current: true,
    fertileWindow: prediction?.fertileWindow ?? null,
  };

  return [current, ...complete];
}

export interface CycleHistoryProps {
  /** `GET /api/period/cycles` — the full recorded history, oldest first. */
  cycles: Resource<PeriodCycle[]>;
  /** The measured intervals, oldest first — `PeriodStats.cycleLengths`. */
  intervals: CycleInterval[];
  prediction: PeriodPrediction | undefined;
  today: DateOnly;
}

export function CycleHistory({ cycles, intervals, prediction, today }: CycleHistoryProps) {
  const [expanded, setExpanded] = useState(false);

  const rows = useMemo(
    () => (cycles.data ? buildRows(cycles.data, intervals, prediction, today) : []),
    [cycles.data, intervals, prediction, today],
  );

  const visible = expanded ? rows : rows.slice(0, VISIBLE_CYCLES);

  return (
    <SettingsGroup
      title="Cycle history"
      action={
        rows.length > VISIBLE_CYCLES ? (
          <Button type="button" variant="ghost" size="sm" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>
            {expanded ? 'Show fewer' : 'See all'}
          </Button>
        ) : null
      }
    >
      {cycles.isInitialLoading && !cycles.data ? (
        <SettingsRow stacked>
          <Skeleton className="h-16 w-full rounded-lg" />
        </SettingsRow>
      ) : cycles.error && !cycles.data ? (
        <SettingsRow stacked>
          <div className="flex items-start gap-3">
            <span aria-hidden className="inline-flex shrink-0 text-muted-foreground">
              <ExclamationTriangleIcon className="size-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">Could not read the cycle history</p>
              <p className="text-sm text-muted-foreground">{cycles.error}</p>
            </div>
          </div>
          <Button type="button" variant="secondary" size="sm" onClick={() => void cycles.refresh()}>
            Try again
          </Button>
        </SettingsRow>
      ) : rows.length === 0 ? (
        <SettingsRow stacked>
          <p className="text-sm text-muted-foreground">
            No period start has been recorded yet. A cycle appears here once one is.
          </p>
        </SettingsRow>
      ) : (
        <>
          {visible.map((row) => {
            const days = cycleStripDays({
              startDate: row.startDate,
              endDate: row.endDate,
              lengthDays: row.lengthDays,
              fertileWindow: row.fertileWindow,
            });
            const lastDay = days[days.length - 1]!.date;
            return (
              <SettingsRow key={row.startDate} stacked>
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <span className="text-base font-semibold tabular-nums">
                    {row.lengthDays} {row.lengthDays === 1 ? 'day' : 'days'}
                    {row.current ? ' so far' : ''}
                  </span>
                  {row.current ? (
                    <Badge variant="outline">
                      <span className="text-muted-foreground">Current cycle</span>
                    </Badge>
                  ) : null}
                </div>
                <p className="text-xs text-muted-foreground tabular-nums">
                  {row.current ? `Started ${shortDate(row.startDate)}` : rangeLabel(row.startDate, lastDay)}
                </p>
                <CycleDotStrip startDate={row.startDate} days={days} />
              </SettingsRow>
            );
          })}
          <SettingsRow stacked>
            <CycleStripKey />
            <CycleStripNote />
          </SettingsRow>
        </>
      )}
    </SettingsGroup>
  );
}
