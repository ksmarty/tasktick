'use client';

/**
 * One day's log, in a sheet.
 *
 * Opened from the cycle month when a day is tapped, and it renders the very same
 * `DayLogForm` the Today screen shows — the two screens cannot drift, because
 * there is one form.
 *
 * ## Why a sheet rather than a route
 *
 * A day log is a detail of the month the user is looking at. Tapping 3 October
 * should not throw the month away and make coming back a second navigation, so the
 * sheet opens over it and closing it returns exactly where the finger was. The
 * Today screen is the full-page version of the same thing for the one day that
 * deserves a destination.
 *
 * ## The cycle actions live here
 *
 * "Period started on this day" is the observation that gives the month its shape,
 * and the month is where the user notices it is missing — so the correction is
 * offered next to the day rather than only on Today. All three shapes are covered:
 * start a period here, end the one covering this day, or remove the one that
 * starts here.
 */
import { useMemo } from 'react';
import { TrashIcon } from '@svg-animated-icons/react/trash';
import { useToast } from '@/components/app/Toast';
import { Drawer } from '@/components/godui/drawer';
import { Button } from '@/components/ui/button';
import type { ContraceptionDayStatus, PeriodCycle, PeriodOverview } from '@/lib/period-types';
import {
  activeMethodFor,
  dayLogFor,
  scheduleDayFor,
  useClearContraceptionLog,
  useCreateCycle,
  useDayLogDraft,
  useDeleteCycle,
  useDeleteDayLog,
  useLogContraception,
  useUpdateCycle,
} from './data';
import { DayLogForm, type DayContraception } from './DayLogForm';
import { longDate, weekdayLong } from './labels';

export interface DayLogSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  date: string;
  overview: PeriodOverview | undefined;
  /** The user's today, for the "end the period today" wording. */
  today: string;
}

export function DayLogSheet({ open, onOpenChange, date, overview, today }: DayLogSheetProps) {
  const { toast } = useToast();
  const log = dayLogFor(overview, date);
  const form = useDayLogDraft(date, log);

  const fail = (title: string) => (message: string) =>
    toast({ title, description: message, variant: 'error' as const });

  /* ---- contraception for this day ---- */
  const method = useMemo(() => activeMethodFor(overview, date), [overview, date]);
  const schedule = scheduleDayFor(overview, date, method?.id ?? null);

  const writeContraception = useLogContraception({ onError: fail('Could not save that') });
  const clearContraceptionLog = useClearContraceptionLog({ onError: fail('Could not clear that') });

  const contraception: DayContraception | null = method
    ? {
        method,
        schedule,
        onStatus: (status: ContraceptionDayStatus | null) => {
          if (status === null) void clearContraceptionLog.run(date, method.id);
          else void writeContraception.run({ methodId: method.id, date, status });
        },
      }
    : null;

  /* ---- the cycle touching this day ---- */
  const cycleCovering = useMemo<PeriodCycle | null>(
    () =>
      (overview?.cycles ?? []).find(
        (cycle) => cycle.startDate <= date && (cycle.endDate === null || cycle.endDate >= date),
      ) ?? null,
    [overview, date],
  );

  const createCycle = useCreateCycle({
    onError: fail('Could not add that period'),
    onSuccess: () => toast({ title: 'Period started here', variant: 'success' }),
  });
  const updateCycle = useUpdateCycle({
    onError: fail('Could not change that period'),
    onSuccess: () => toast({ title: 'Period updated', variant: 'success' }),
  });
  const deleteCycle = useDeleteCycle({
    onError: fail('Could not remove that period'),
    onSuccess: () => toast({ title: 'Period removed', variant: 'success' }),
  });
  const deleteDayLog = useDeleteDayLog({
    onError: fail('Could not clear the day'),
    onSuccess: () => {
      toast({ title: 'Day cleared', variant: 'success' });
      onOpenChange(false);
    },
  });

  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      side="bottom"
      title={`${weekdayLong(date)}, ${longDate(date)}`}
      className="max-h-[90dvh] p-0 px-card pt-2"
    >
      <div className="flex flex-col gap-stack pt-2 pb-6">
        <DayLogForm date={date} value={form.value} onChange={form.set} contraception={contraception} />

        <section className="flex flex-col gap-2 rounded-xl border border-border bg-card p-card text-card-foreground shadow-xs">
          <h2 className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">Period</h2>

          {cycleCovering ? (
            <>
              <p className="text-sm">
                This day is inside the period that began {longDate(cycleCovering.startDate)}
                {cycleCovering.endDate ? ` and ended ${longDate(cycleCovering.endDate)}` : ' and is still open'}.
              </p>
              <div className="flex flex-wrap gap-2">
                {cycleCovering.endDate === null || cycleCovering.endDate > date ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-9"
                    onClick={() => void updateCycle.run(cycleCovering.id, { endDate: date })}
                  >
                    The period ended this day
                  </Button>
                ) : null}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-9 gap-1.5 px-2 text-muted-foreground"
                  onClick={() => void deleteCycle.run(cycleCovering.id)}
                >
                  <TrashIcon className="size-4 text-base" />
                  Remove this period
                </Button>
              </div>
            </>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                No period on this day. If bleeding started here
                {date === today ? ' — today —' : ''}, record it and the day is marked on the month.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  className="h-9"
                  onClick={() => void createCycle.run({ startDate: date, flowIntensity: 'medium' })}
                >
                  Period started this day
                </Button>
              </div>
            </>
          )}
        </section>

        <div className="flex items-center justify-between gap-2">
          <p aria-live="polite" className="min-w-0 flex-1 text-xs text-muted-foreground">
            {form.error ? `Not saved: ${form.error}` : form.isSaving ? 'Saving…' : 'Saved as you tap.'}
          </p>
          {log ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-9 shrink-0 gap-1.5 px-2 text-muted-foreground"
              aria-label={`Clear everything logged on ${longDate(date)}`}
              onClick={() => void deleteDayLog.run(date)}
            >
              <TrashIcon className="size-4 text-base" />
              Clear day
            </Button>
          ) : null}
        </div>
      </div>
    </Drawer>
  );
}
