'use client';

/**
 * Today: the log screen, and the fastest path to recording anything.
 *
 * ## The shape, and why
 *
 * The prediction is at the top because it is what a user opens the app to *see*;
 * the period actions sit under it because "my period started today" is the one
 * observation that is not a chip on the form; the log is next because it is what
 * they open the app to *do*.
 *
 * Everything below that is the same `DayLogForm` the cycle month opens in a
 * sheet, so the two screens cannot offer different fields. The form itself is
 * ordered by how often each field is set — see `DayLogForm`.
 *
 * ## Writes are immediate
 *
 * There is no Save button anywhere on this screen, and that is the point: the
 * draft in `useDayLogDraft` renders a tap before the request lands, so a chip
 * fills under the finger and the network is a background detail. A failure shows
 * in the line under the form rather than in a modal, because the user is holding
 * the phone in one hand.
 *
 * ## Only one request
 *
 * `GET /api/period` for today's window returns the settings, the cycles, the day
 * log, the contraception schedule (including the day's expected on/off state) and
 * the prediction. This screen makes that one call and nothing else, so no two
 * parts of it can be showing state from different moments — and the form renders
 * from `null`s before it even answers, because "nothing logged" is a truthful
 * state for every field on it.
 */
import { useMemo, useState } from 'react';
import { PlusIcon } from '@svg-animated-icons/react/plus';
import { TrashIcon } from '@svg-animated-icons/react/trash';
import { PageHeader } from '@/components/app/PageHeader';
import { useToast } from '@/components/app/Toast';
import { Drawer } from '@/components/godui/drawer';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { ContraceptionDayStatus, PeriodCycle } from '@/lib/period-types';
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
  usePeriodOverview,
  useUpdateCycle,
} from './data';
import { DayLogForm, type DayContraception } from './DayLogForm';
import { PredictionSummary } from './PredictionSummary';
import { longDate, weekdayLong } from './labels';
import { useTodayZone } from './useToday';

export function TodayLogScreen() {
  const { today } = useTodayZone();
  const { toast } = useToast();

  /* One window: today. The overview's schedule therefore has exactly one row per
     method, which is all the birth-control card needs. */
  const overview = usePeriodOverview(today, today);
  const data = overview.data;
  const log = dayLogFor(data, today);
  const form = useDayLogDraft(today, log);

  const [pastOpen, setPastOpen] = useState(false);

  const fail = (title: string) => (message: string) =>
    toast({ title, description: message, variant: 'error' as const });

  /* ---- the cycle covering today, if any ---- */
  const openCycle = useMemo<PeriodCycle | null>(
    () =>
      (data?.cycles ?? []).find(
        (cycle) => cycle.startDate <= today && (cycle.endDate === null || cycle.endDate >= today),
      ) ?? null,
    [data, today],
  );
  const cycleStartsToday = useMemo(
    () => (data?.cycles ?? []).some((cycle) => cycle.startDate === today),
    [data, today],
  );

  /* ---- contraception ---- */
  const method = useMemo(() => activeMethodFor(data, today), [data, today]);
  const schedule = scheduleDayFor(data, today, method?.id ?? null);

  const writeContraception = useLogContraception({ onError: fail('Could not save that') });
  const clearContraceptionLog = useClearContraceptionLog({ onError: fail('Could not clear that') });

  const contraception: DayContraception | null = method
    ? {
        method,
        schedule,
        onStatus: (status: ContraceptionDayStatus | null) => {
          if (status === null) void clearContraceptionLog.run(today, method.id);
          else void writeContraception.run({ methodId: method.id, date: today, status });
        },
      }
    : null;

  /* ---- writes for the cycle card and the day ---- */
  const createCycle = useCreateCycle({
    onError: fail('Could not add that period'),
    onSuccess: () => toast({ title: 'Period started', variant: 'success' }),
  });
  const updateCycle = useUpdateCycle({
    onError: fail('Could not close the period'),
    onSuccess: () => toast({ title: 'Period ended', variant: 'success' }),
  });
  const deleteCycle = useDeleteCycle({
    onError: fail('Could not remove that period'),
    onSuccess: () => toast({ title: 'Period removed', variant: 'success' }),
  });
  const deleteDayLog = useDeleteDayLog({
    onError: fail('Could not clear the day'),
    onSuccess: () => toast({ title: 'Cleared today', variant: 'success' }),
  });

  return (
    <>
      <PageHeader title="Today" />

      <div className="flex flex-col gap-stack px-gutter pt-4 pb-6">
        <p className="text-sm text-muted-foreground">
          {weekdayLong(today)}, {longDate(today)}
        </p>

        <PredictionSummary prediction={data?.prediction} today={today} />

        <PeriodCard
          today={today}
          openCycle={openCycle}
          cycleStartsToday={cycleStartsToday}
          onStart={() => void createCycle.run({ startDate: today, flowIntensity: 'medium' })}
          onEnd={(cycle) => void updateCycle.run(cycle.id, { endDate: today })}
          onRemove={(cycle) => void deleteCycle.run(cycle.id)}
          onAddPast={() => setPastOpen(true)}
        />

        <DayLogForm
          date={today}
          value={form.value}
          onChange={form.set}
          contraception={contraception}
        />

        <div className="flex items-center justify-between gap-2">
          {/*
            One line that says what just happened, next to the control that clears
            the day. `aria-live` because the form has no Save button: this is the
            only confirmation a write succeeded.
          */}
          <p aria-live="polite" className="min-w-0 flex-1 text-xs text-muted-foreground">
            {form.error
              ? `Not saved: ${form.error}`
              : form.isSaving
                ? 'Saving…'
                : data
                  ? 'Saved as you tap.'
                  : 'Loading this day…'}
          </p>

          {log ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-9 shrink-0 gap-1.5 px-2 text-muted-foreground"
              aria-label={`Clear everything logged on ${longDate(today)}`}
              onClick={() => void deleteDayLog.run(today)}
            >
              <TrashIcon className="size-4 text-base" />
              Clear day
            </Button>
          ) : null}
        </div>
      </div>

      <AddPastPeriodSheet
        open={pastOpen}
        onOpenChange={setPastOpen}
        today={today}
        onCreate={(input) => createCycle.run(input)}
      />
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* the period card                                                            */
/* -------------------------------------------------------------------------- */

/**
 * The one thing that is not a field on the form: a period starting or ending.
 *
 * Both are one tap and both are stated as the user's own observation — "my period
 * started today", not "create a cycle record". Each control appears only when it
 * would be correct: you cannot start a period twice on one day (the contract has a
 * unique index on the start date), and there is nothing to end while no period is
 * open, so neither button can produce a duplicate row or a silent no-op.
 *
 * The component is presentational — the screen owns the mutations — so the
 * loading and error handling for all four writes stay in one place.
 */
function PeriodCard({
  today,
  openCycle,
  cycleStartsToday,
  onStart,
  onEnd,
  onRemove,
  onAddPast,
}: {
  today: string;
  openCycle: PeriodCycle | null;
  cycleStartsToday: boolean;
  onStart: () => void;
  onEnd: (cycle: PeriodCycle) => void;
  onRemove: (cycle: PeriodCycle) => void;
  onAddPast: () => void;
}) {
  return (
    <section className="flex flex-col gap-2 rounded-xl border border-border bg-card p-card text-card-foreground shadow-xs">
      <h2 className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">Period</h2>

      {openCycle ? (
        <>
          <p className="text-sm">
            A period that began {longDate(openCycle.startDate)} is open
            {openCycle.startDate === today ? ' — it started today' : ''}.
          </p>
          <div className="flex flex-wrap gap-2">
            {openCycle.endDate === null ? (
              <Button type="button" variant="outline" size="sm" className="h-9" onClick={() => onEnd(openCycle)}>
                My period ended today
              </Button>
            ) : null}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-9 gap-1.5 px-2 text-muted-foreground"
              onClick={() => onRemove(openCycle)}
            >
              <TrashIcon className="size-4 text-base" />
              Remove this period
            </Button>
            <Button type="button" variant="ghost" size="sm" className="h-9 gap-1.5 px-2" onClick={onAddPast}>
              <PlusIcon className="size-4 text-base" />
              Add a past period
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            No period in progress. If one starts today, record it here and the day is marked on the cycle month.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" className="h-9" disabled={cycleStartsToday} onClick={onStart}>
              My period started today
            </Button>
            <Button type="button" variant="ghost" size="sm" className="h-9 gap-1.5 px-2" onClick={onAddPast}>
              <PlusIcon className="size-4 text-base" />
              Add a past period
            </Button>
          </div>
        </>
      )}
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* add a past period                                                          */
/* -------------------------------------------------------------------------- */

/**
 * A period that started before today.
 *
 * The date fields are native `date` inputs, which on a phone is the OS wheel —
 * the fastest way to reach a date months back — and whose value is already the
 * floating `YYYY-MM-DD` the contract stores, so nothing is converted.
 *
 * The sheet exists because the card's buttons can only say "today": a user who has
 * been tracking elsewhere, or who simply forgot for three days, needs to put the
 * start where it actually was, and without this the only other way in would be the
 * CSV importer.
 *
 * The end date is optional on purpose — the contract allows a cycle with only a
 * start, and the maths only needs the start — so a user who does not know how long
 * it lasted is not blocked.
 */
function AddPastPeriodSheet({
  open,
  onOpenChange,
  today,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  today: string;
  onCreate: (input: { startDate: string; endDate: string | null; flowIntensity: 'medium' }) => Promise<unknown>;
}) {
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState('');

  return (
    <Drawer open={open} onOpenChange={onOpenChange} side="bottom" title="Add a past period">
      <div className="flex flex-col gap-stack p-card pb-6">
        <div className="flex flex-col gap-2">
          <Label htmlFor="period-past-start">First day of bleeding</Label>
          <Input
            id="period-past-start"
            type="date"
            value={startDate}
            max={today}
            onChange={(event) => setStartDate(event.target.value)}
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="period-past-end">Last day of bleeding</Label>
          <Input
            id="period-past-end"
            type="date"
            value={endDate}
            min={startDate}
            max={today}
            onChange={(event) => setEndDate(event.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Optional — leave it blank if you only know the start. The cycle length only needs the start.
          </p>
        </div>

        <Button
          type="button"
          className="h-10"
          disabled={startDate === ''}
          onClick={() => {
            void onCreate({
              startDate,
              endDate: endDate === '' ? null : endDate,
              flowIntensity: 'medium',
            }).then(() => onOpenChange(false));
          }}
        >
          Add period
        </Button>
      </div>
    </Drawer>
  );
}
