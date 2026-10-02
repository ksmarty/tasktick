'use client';

/**
 * Today: the week strip, the estimate, and the fastest path to recording anything.
 *
 * ## The shape, and why
 *
 * Top to bottom: the week strip (which day this screen is about), the hero card
 * (what is next and the one period action), the prediction card (the same
 * estimate with its basis and its caveats), the day log, then "My daily insights"
 * and "My cycles".
 *
 * The order is the reference's, with one addition: `PredictionSummary` stays
 * under the hero. The hero is a headline — a count and one sentence — and a
 * headline is where a caveat gets lost, so the card that carries the ± band, the
 * measured intervals and the API's own `meaning` sentence keeps its place on this
 * screen. The strip and the hero are new; the day log is not: it is the same
 * `DayLogForm` the cycle month opens in a sheet, so the two screens cannot offer
 * different fields.
 *
 * ## One selected day, and everything below it moves
 *
 * `selectedDate` is the screen's subject. It starts as today (`null` means "follow
 * the clock", so the screen is still on today after midnight) and any day in the
 * strip replaces it: the hero's count, the prediction's relative wording, the
 * form, the status line and "Clear day" all follow. The strip's week comes from
 * the month grid's own `rangeForView('month', …)` + `buildMonthRows` chunking, so
 * tapping through weeks cannot show a day the month screen would place in a
 * different week — see `./WeekStrip`.
 *
 * ## Writes are immediate
 *
 * There is no Save button anywhere on this screen, and that is the point: the
 * draft in `useDayLogDraft` renders a tap before the request lands, so a chip
 * fills under the finger and the network is a background detail. A failure shows
 * in the line under the form rather than in a modal, because the user is holding
 * the phone in one hand.
 *
 * ## Two requests, and why the second one is there
 *
 * `GET /api/period` for the displayed month's window returns the settings, the
 * cycles (in full — the API sends every cycle because the prediction needs the
 * history), the day logs, the contraception schedule and the prediction. This
 * screen makes that one call for everything it shows, so no two parts of it can be
 * showing state from different moments — and the form renders from `null`s before
 * it even answers, because "nothing logged" is a truthful state for every field on
 * it.
 *
 * The window is the *month* the selected week sits in rather than the single day,
 * because the week strip paints seven days: a strip whose neighbours' period marks
 * were outside the window would disagree with the month grid about the same week.
 * The prediction's `asOf` is deliberately not passed — the server's own today is
 * what "next period" is measured from, so stepping the strip through a month
 * cannot make the estimate wander.
 *
 * The one thing that call cannot answer is "has this user ever recorded
 * anything", because its day-log window is a month: an empty window is equally
 * consistent with a brand-new account and with someone who logged last autumn. The
 * empty state that leads to the importer needs the real answer, so the existing
 * stats read (`GET /api/period/stats`, the same one Insights uses, under the same
 * cache key, invalidated by every period write) is consulted for that and for the
 * two facts the insights row and the cycles card state — the measured cycle
 * lengths and the number of logged days.
 */
import { useCallback, useMemo, useState } from 'react';
import { TrashIcon } from '@svg-animated-icons/react/trash';
import { PageHeader } from '@/components/app/PageHeader';
import { useToast } from '@/components/app/Toast';
import { buildMonthRows } from '@/components/calendar';
import { Drawer } from '@/components/godui/drawer';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { addDaysToDateOnly, rangeForView } from '@/lib/dates';
import type { ContraceptionDayStatus, PeriodCycle } from '@/lib/period-types';
import type { DateOnly } from '@/lib/types';
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
  usePeriodStats,
  useUpdateCycle,
  useUpdatePeriodSettings,
} from './data';
import { DayLogForm, type DayContraception } from './DayLogForm';
import { HeroCard } from './HeroCard';
import { ImportEmptyState } from './ImportCard';
import { MyCyclesCard } from './MyCyclesCard';
import { PredictionSummary } from './PredictionSummary';
import { TodayInsightsRow } from './TodayInsightsRow';
import { WeekStrip } from './WeekStrip';
import { SHOW_ALL_TODAY_CATEGORIES } from './today-categories';
import { longDate, weekdayLong } from './labels';
import { marksForDays, type DayMarks } from './markers';
import { useTodayZone } from './useToday';

/** The id the insights row's action scrolls to; one form per screen. */
const DAY_LOG_ID = 'today-day-log';

/** The marks for a day with none — one shared instance per render. */
const NO_MARKS: DayMarks = { period: false, predicted: false, fertile: false, ovulation: false };

export function TodayLogScreen() {
  const { today, zone, weekStartsOn } = useTodayZone();
  const { toast } = useToast();

  /*
   * The day the screen is about. `null` rather than `today` so that "today" keeps
   * following the clock: at midnight the screen rolls over with the rest of the
   * app instead of staying on yesterday because a `useState` captured it.
   */
  const [pickedDate, setPickedDate] = useState<DateOnly | null>(null);
  const selectedDate = pickedDate ?? today;

  /*
   * The window, and the week inside it.
   *
   * `rangeForView('month', …)` is the same call the cycle month makes and the
   * same one its sliding panels are built from; `buildMonthRows` is the function
   * that chunks it into whole weeks, and it is also how `MonthGrid` picks the row
   * its own collapsed strip shows. The strip below is therefore literally one row
   * of the month lattice — not a second calendar that could start its week
   * somewhere else.
   */
  const range = useMemo(
    () => rangeForView('month', selectedDate, zone, weekStartsOn),
    [selectedDate, zone, weekStartsOn],
  );
  const week = useMemo(() => {
    const rows = buildMonthRows(range.days, selectedDate);
    const row = rows.find((candidate) => candidate.some((cell) => cell.date === selectedDate));
    return (row ?? []).map((cell) => cell.date);
  }, [range, selectedDate]);

  const overview = usePeriodOverview(range.startDate, range.endDate);
  const data = overview.data;
  const log = dayLogFor(data, selectedDate);
  const form = useDayLogDraft(selectedDate, log);

  /**
   * A second read, used for "has this user ever recorded anything" and for the
   * two facts the insights row and the cycles card state.
   *
   * The overview is windowed to a month, so on its own it cannot tell the
   * difference between a new user and someone who logged last year — and the one
   * decision that needs the answer is whether to lead with the importer. The
   * request is cached under the same key Insights uses and is invalidated by every
   * period write, so it is paid once and then free.
   */
  const stats = usePeriodStats();
  const nothingRecorded = (data?.cycles.length ?? 0) === 0 && stats.data?.loggedDays === 0;

  const [pastOpen, setPastOpen] = useState(false);

  const fail = (title: string) => (message: string) =>
    toast({ title, description: message, variant: 'error' as const });

  /* ---- the marks the strip paints, from the month's own derivation ---- */
  const marks = useMemo(() => marksForDays(range.days, data), [range, data]);
  const markFor = useCallback((date: DateOnly) => marks.get(date) ?? NO_MARKS, [marks]);

  /* ---- the cycle covering the selected day, if any ---- */
  const coveringCycle = useMemo<PeriodCycle | null>(
    () =>
      (data?.cycles ?? []).find(
        (cycle) =>
          cycle.startDate <= selectedDate && (cycle.endDate === null || cycle.endDate >= selectedDate),
      ) ?? null,
    [data, selectedDate],
  );

  /* ---- contraception ---- */
  const method = useMemo(() => activeMethodFor(data, selectedDate), [data, selectedDate]);
  const schedule = scheduleDayFor(data, selectedDate, method?.id ?? null);

  const writeContraception = useLogContraception({ onError: fail('Could not save that') });
  const clearContraceptionLog = useClearContraceptionLog({ onError: fail('Could not clear that') });

  const contraception: DayContraception | null = method
    ? {
        method,
        schedule,
        onStatus: (status: ContraceptionDayStatus | null) => {
          if (status === null) void clearContraceptionLog.run(selectedDate, method.id);
          else void writeContraception.run({ methodId: method.id, date: selectedDate, status });
        },
      }
    : null;

  /* ---- writes for the hero and the day ---- */

  const createCycle = useCreateCycle({
    onError: fail('Could not add that period'),
    onSuccess: () => {
      toast({ title: 'Period started', variant: 'success' });
    },
  });
  const updateCycle = useUpdateCycle({
    onError: fail('Could not close the period'),
    onSuccess: () => {
      toast({ title: 'Period ended', variant: 'success' });
    },
  });
  const deleteCycle = useDeleteCycle({
    onError: fail('Could not remove that period'),
    onSuccess: () => {
      toast({ title: 'Period removed', variant: 'success' });
    },
  });
  const deleteDayLog = useDeleteDayLog({
    onError: fail('Could not clear the day'),
    onSuccess: () => toast({ title: 'Cleared the day', variant: 'success' }),
  });

  /* The escape hatch from an all-hidden form — see `DayLogForm` and
     `today-categories.ts`. It restores the ordinary sections and leaves the body
     signs switch exactly as the user set it.

     The overview is written through the store first, for the same reason the
     settings switches are: `invalidate()` refetches only after the worker has
     acknowledged the drop, so this entry still holds the old value for a moment,
     and the form is rendered from it. Without the write the button would look
     like it did nothing. */
  const showAllSections = useUpdatePeriodSettings({
    onError: fail('Could not save that'),
  });

  function onShowAllSections() {
    const before = overview.data;
    overview.mutate((current) =>
      current ? { ...current, settings: { ...current.settings, ...SHOW_ALL_TODAY_CATEGORIES } } : current,
    );
    void showAllSections.run(SHOW_ALL_TODAY_CATEGORIES).then((saved) => {
      if (!saved && before) overview.mutate(before);
    });
  }

  /**
   * The insights row's first card, and the only thing it does.
   *
   * It brings the day log into view and focuses it — the form is already on this
   * screen, so the honest action is to reveal it, not to open a second copy of it
   * in a sheet. `preventScroll` on the focus call because the smooth scroll is
   * already doing that job; the two together otherwise fight.
   */
  const onLogSymptoms = useCallback(() => {
    const node = document.getElementById(DAY_LOG_ID);
    if (!node) return;
    node.scrollIntoView({ block: 'start', behavior: 'smooth' });
    node.focus({ preventScroll: true });
  }, []);

  return (
    <>
      <PageHeader title="Today" />

      {/* The column itself carries no gutter: the insights row is deliberately
          full-bleed so its cards can scroll from the page edge, and every other
          child puts the gutter on itself. */}
      <div className="flex flex-col gap-stack pt-4 pb-6">
        <div className="px-gutter">
          <WeekStrip
            days={week}
            markFor={markFor}
            selectedDate={selectedDate}
            today={today}
            weekStartsOn={weekStartsOn}
            monthLabel={range.label}
            onSelectDate={setPickedDate}
            onPreviousWeek={() => setPickedDate(addDaysToDateOnly(selectedDate, -7, zone))}
            onNextWeek={() => setPickedDate(addDaysToDateOnly(selectedDate, 7, zone))}
            onToday={pickedDate === null ? null : () => setPickedDate(null)}
          />
        </div>

        {/*
         * Nothing recorded at all: the importer leads, right under the strip. A
         * new user's first job is to get their history in — otherwise the
         * prediction has nothing to say for a month — and it disappears the moment
         * there is a single row.
         */}
        {nothingRecorded ? (
          <div className="px-gutter">
            <ImportEmptyState />
          </div>
        ) : null}

        <div className="px-gutter">
          <HeroCard
            prediction={data?.prediction}
            selectedDate={selectedDate}
            coveringCycle={coveringCycle}
            onStart={(date) => void createCycle.run({ startDate: date, flowIntensity: 'medium' })}
            onEnd={(cycle, date) => void updateCycle.run(cycle.id, { endDate: date })}
            onRemove={(cycle) => void deleteCycle.run(cycle.id)}
            onAddPast={() => setPastOpen(true)}
          />
        </div>

        <div className="px-gutter">
          {/*
            The prediction card keeps `today` even though the hero above follows
            the selected day. It is not an oversight: every sentence in it is
            anchored to the prediction's own `asOf` — "Today is day N of the
            current cycle", "Expected tomorrow", "The estimate passed N days
            ago" — so handing it a day the user tapped makes it say "Expected 5
            days ago" about a date that is still ahead. The hero answers "what is
            this day"; this card answers "what is coming", and it answers it about
            the one day the API answered for.
          */}
          <PredictionSummary prediction={data?.prediction} today={today} />
        </div>

        <TodayInsightsRow prediction={data?.prediction} stats={stats.data} today={today} onLogSymptoms={onLogSymptoms} />

        {/*
          The day being edited, named, then the form. `tabIndex={-1}` is the
          scroll-and-focus target of the insights row's first card: not in the tab
          order, but focusable by script so a keyboard user lands where the tap
          took them.
        */}
        <div id={DAY_LOG_ID} tabIndex={-1} className="flex flex-col gap-2 px-gutter outline-none">
          <p className="text-sm text-muted-foreground">
            {selectedDate === today ? 'Today · ' : ''}
            {weekdayLong(selectedDate)}, {longDate(selectedDate)}
          </p>

          <DayLogForm
            date={selectedDate}
            value={form.value}
            onChange={form.set}
            contraception={contraception}
            settings={data?.settings}
            onShowAllSections={onShowAllSections}
          />

          <div className="flex items-center justify-between gap-2">
            {/*
              One line that says what just happened, next to the control that
              clears the day. `aria-live` because the form has no Save button:
              this is the only confirmation a write succeeded.
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
                aria-label={`Clear everything logged on ${longDate(selectedDate)}`}
                onClick={() => void deleteDayLog.run(selectedDate)}
              >
                <TrashIcon className="size-4 text-base" />
                Clear day
              </Button>
            ) : null}
          </div>
        </div>

        <MyCyclesCard stats={stats.data} />
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
/* add a past period                                                          */
/* -------------------------------------------------------------------------- */

/**
 * A period that started before today.
 *
 * The date fields are native `date` inputs, which on a phone is the OS wheel —
 * the fastest way to reach a date months back — and whose value is already the
 * floating `YYYY-MM-DD` the contract stores, so nothing is converted.
 *
 * The sheet exists because the hero's button can only say "this day": a user who
 * has been tracking elsewhere, or who simply forgot for three days, needs to put
 * the start where it actually was, and without this the only other way in would be
 * the CSV importer.
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
