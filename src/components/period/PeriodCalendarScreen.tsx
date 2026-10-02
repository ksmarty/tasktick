'use client';

/**
 * The cycle month: the calendar screen's own `MonthGrid`, carrying cycle marks.
 *
 * ## The grid is reused, not re-drawn
 *
 * The month is the same surface on the calendar, the habits screen and here, so
 * this screen imports `MonthGrid` unchanged and paints through its
 * `renderDayMarker` / `dayMarkerLabel` seam — the same seam the habits screen uses
 * for its completion ring. The two gestures (drag for height, swipe to page), the
 * pinned header row, the paging track and the roving keyboard focus all come with
 * it, and nothing about dates is re-derived: the grid is handed
 * `rangeForView('month', …)` and nothing else.
 *
 * The payload it paints is deliberately empty. A day's calendar items are not a
 * cycle fact, and a dot meaning "something happened" on a screen whose whole
 * question is "where is my cycle" is the mistake the habits month already fixed —
 * see `HabitMonthGrid`'s long comment. The item dot lane is therefore free for the
 * ovulation mark, which is the one extra thing this screen needs it for.
 *
 * ## One read for all three panels
 *
 * The paging track draws the previous and next months beside the live one, and a
 * neighbouring month that slid in unpainted would pop its rings in after the
 * swipe. So the request window is the union of the three panels' day lists (about
 * three months of logs), and the marks for every day any panel can paint are
 * derived from that one response.
 *
 * ## The day detail is the scroller
 *
 * The grid is pinned (`shrink-0`) and the detail under it scrolls, exactly as the
 * habits screen arranges it, so the month stays put while the user reads about the
 * day they just selected. `useShellPane({ fullHeight: true })` is what hands the
 * scrolling to this screen and keeps exactly one element scrolling.
 */
import { useCallback, useMemo, useState } from 'react';
import { CalendarIcon } from '@svg-animated-icons/react/calendar';
import { PageHeader } from '@/components/app/PageHeader';
import { useToast } from '@/components/app/Toast';
import { useShellPane } from '@/components/app/ShellPane';
import {
  MonthGrid,
  createInteraction,
  useSectionReset,
  type CalendarInteraction,
  type CalendarLookup,
  type CalendarPrefs,
  type MonthPage,
} from '@/components/calendar';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { rangeForView, shiftViewAnchor } from '@/lib/dates';
import { cn } from '@/lib/utils';
import type { PeriodOverview } from '@/lib/period-types';
import type { CalendarItemsPayload } from '@/lib/view-types';
import type { DateOnly } from '@/lib/types';
import { dayLogFor, scheduleDayFor, usePeriodOverview, activeMethodFor, useUpdatePeriodSettings } from './data';
import { SHOW_ALL_TODAY_CATEGORIES } from './today-categories';
import { DayLogSheet } from './DayLogSheet';
import { PeriodDayMarker, PeriodLegend } from './DayMark';
import { PredictionSummary } from './PredictionSummary';
import { hasMarks, markWords, marksForDays, type DayMarks } from './markers';
import { intimacyLabel } from './intimacy';
import { FLOW_LABEL, METHOD_LABEL, DAY_STATUS_LABEL, humanise, longDate, weekdayLong } from './labels';
import { useTodayZone } from './useToday';

/** The marks' shape, for a day with none — one shared instance per render. */
const NO_MARKS: DayMarks = { period: false, predicted: false, fertile: false, ovulation: false };

/* The grid paints no items on this screen; see the file comment. */
const NO_ITEMS: CalendarItemsPayload = { items: [], calendars: [], days: {} };
const NO_CALENDARS: CalendarLookup = new Map();

export function PeriodCalendarScreen() {
  useShellPane({ fullHeight: true });

  const { today, zone, weekStartsOn, timeFormat } = useTodayZone();
  const { toast } = useToast();

  const [anchor, setAnchor] = useState<DateOnly>(today);
  const [selectedDate, setSelectedDate] = useState<DateOnly>(today);
  const [pageSeq, setPageSeq] = useState(0);
  const [preview, setPreview] = useState<-1 | 0 | 1>(0);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [interaction] = useState<CalendarInteraction>(createInteraction);

  /* Re-tapping the Cycle tab returns to today, as it does on Calendar and Habits. */
  useSectionReset('period-cycle', () => {
    setAnchor(today);
    setSelectedDate(today);
  });

  const prefs = useMemo<CalendarPrefs>(() => ({ zone, weekStartsOn, timeFormat }), [zone, weekStartsOn, timeFormat]);

  const range = useMemo(() => rangeForView('month', anchor, zone, weekStartsOn), [anchor, zone, weekStartsOn]);

  const neighbours = useMemo(
    () =>
      ([-1, 1] as const).map((delta) => {
        const neighbourAnchor = shiftViewAnchor('month', anchor, delta, zone);
        return { anchor: neighbourAnchor, range: rangeForView('month', neighbourAnchor, zone, weekStartsOn) };
      }),
    [anchor, zone, weekStartsOn],
  );

  /*
   * The window: the union of the three panels. Sorted lexicographically —
   * floating `YYYY-MM-DD` strings sort as they read — so the request covers the
   * earliest day any panel can show to the latest.
   */
  const allDays = useMemo(
    () => [...range.days, ...neighbours[0].range.days, ...neighbours[1].range.days],
    [range, neighbours],
  );
  const windowFrom = useMemo(() => allDays.reduce((min, day) => (day < min ? day : min), allDays[0]), [allDays]);
  const windowTo = useMemo(() => allDays.reduce((max, day) => (day > max ? day : max), allDays[0]), [allDays]);

  const overview = usePeriodOverview(windowFrom, windowTo);
  const data = overview.data;

  /*
   * "Show my sections again", from the day sheet.
   *
   * The sheet renders the one `DayLogForm` against this screen's overview, so the
   * write-through has to happen here — the same optimistic-then-revert shape the
   * settings switches use, because `invalidate()` refetches only after the worker
   * has acknowledged the drop and the form is rendered in the meantime.
   */
  const showAllSections = useUpdatePeriodSettings({
    onError: (message) => toast({ title: 'Could not save that', description: message, variant: 'error' }),
  });
  const onShowAllSections = useCallback(() => {
    const before = overview.data;
    overview.mutate((current) =>
      current ? { ...current, settings: { ...current.settings, ...SHOW_ALL_TODAY_CATEGORIES } } : current,
    );
    void showAllSections.run(SHOW_ALL_TODAY_CATEGORIES).then((saved) => {
      if (!saved && before) overview.mutate(before);
    });
  }, [overview, showAllSections]);

  const marks = useMemo(() => marksForDays(allDays, data), [allDays, data]);

  const renderDayMarker = useCallback(
    (date: DateOnly) => <PeriodDayMarker marks={marks.get(date) ?? NO_MARKS} />,
    [marks],
  );

  const dayMarkerLabel = useCallback(
    (date: DateOnly) => {
      const found = marks.get(date);
      if (!found || !hasMarks(found)) return null;
      return markWords(found).join(', ');
    },
    [marks],
  );

  const previousPage = useMemo<MonthPage>(
    () => ({ days: neighbours[0].range.days, anchor: neighbours[0].anchor, payload: NO_ITEMS }),
    [neighbours],
  );
  const nextPage = useMemo<MonthPage>(
    () => ({ days: neighbours[1].range.days, anchor: neighbours[1].anchor, payload: NO_ITEMS }),
    [neighbours],
  );

  const handlePage = useCallback((delta: number) => {
    if (delta !== 0) setPageSeq((value) => value + 1);
    setAnchor((current) => shiftViewAnchor('month', current, delta, zone));
    setSelectedDate((current) => shiftViewAnchor('month', current, delta, zone));
  }, [zone]);

  const ignoreItem = useCallback(() => undefined, []);

  const monthLabel = useMemo(
    () => fromMonthAnchor(shiftViewAnchor('month', anchor, preview, zone)),
    [anchor, preview, zone],
  );

  return (
    <>
      <PageHeader title="Cycle" />

      <div className="mx-auto flex min-h-0 w-full max-w-2xl flex-1 flex-col gap-stack pb-stack">
        {/* The prediction keeps the screen's gutter; the month below is
            full-bleed and carries its own inset (see `MonthGrid`). `headline`,
            not `compact`: the month is this screen's subject, and the detailed
            basis has its own screen — see `PredictionSummary`'s variant note. */}
        <div className="shrink-0 px-gutter">
          <PredictionSummary prediction={data?.prediction} today={today} variant="headline" />
        </div>

        {/*
         * The month under the finger, named while the paging drag is in flight,
         * and the legend on its own row below it. They shared a row first and
         * "September 2026" wrapped to two lines to make space for the key; the
         * key is four items and does not fit beside a month name at 390px.
         */}
        <div className="flex shrink-0 flex-col gap-1 px-gutter">
          <h2 aria-live="polite" className="text-sm font-semibold">
            {monthLabel}
          </h2>
          <PeriodLegend />
        </div>

        <MonthGrid
          days={range.days}
          anchor={anchor}
          previous={previousPage}
          next={nextPage}
          selectedDate={selectedDate}
          today={today}
          pageSeq={pageSeq}
          payload={NO_ITEMS}
          prefs={prefs}
          calendars={NO_CALENDARS}
          interaction={interaction}
          onSelectDate={setSelectedDate}
          onOpenDay={(date) => {
            setSelectedDate(date);
            setSheetOpen(true);
          }}
          onOpenItem={ignoreItem}
          onReschedule={ignoreItem}
          onPage={handlePage}
          onPagePreview={setPreview}
          renderDayMarker={renderDayMarker}
          dayMarkerLabel={dayMarkerLabel}
          /*
           * The marks are drawn *around* the disc, so the today/selected fill is
           * inset to leave them a gap — the same reason the habits month sets it.
           */
          dayMarkerInset
        />

        {/*
          The one scroller: the selected day. `fade-y` masks its edges and is
          gated on this element's own scroll position; the bottom padding is the
          mobile tab-bar clearance the shell used to carry on `<main>`, restated
          because this screen owns its own scroll now.
        */}
        <div className="fade-y min-h-0 flex-1 overflow-y-auto overscroll-contain px-gutter pb-[calc(env(safe-area-inset-bottom)_+_5.375rem)] lg:pb-0">
          {overview.isInitialLoading ? (
            <div className="flex flex-col gap-2 py-2">
              <Skeleton className="h-20 rounded-xl" />
              <Skeleton className="h-24 rounded-xl" />
            </div>
          ) : (
            <DayDetail
              date={selectedDate}
              today={today}
              marks={marks.get(selectedDate) ?? NO_MARKS}
              data={data}
              onLog={() => setSheetOpen(true)}
            />
          )}
        </div>
      </div>

      <DayLogSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        date={selectedDate}
        overview={data}
        today={today}
        onShowAllSections={onShowAllSections}
      />
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* the selected day                                                           */
/* -------------------------------------------------------------------------- */

/**
 * What the selected day holds, in words.
 *
 * This is the half of the screen the marks cannot carry: a ring says "period" and
 * a dashed ring says "predicted", but neither can say which symptoms were logged
 * or whether the pill was taken. Every line is read from the one overview response
 * — nothing here is recomputed.
 */
function DayDetail({
  date,
  today,
  marks,
  data,
  onLog,
}: {
  date: DateOnly;
  today: DateOnly;
  marks: DayMarks;
  data: PeriodOverview | undefined;
  onLog: () => void;
}) {
  const log = dayLogFor(data, date);
  const method = activeMethodFor(data, date);
  const schedule = scheduleDayFor(data, date, method?.id ?? null);
  const words = markWords(marks);

  const symptoms = log?.symptoms ?? [];
  const mood = log?.mood ?? [];

  return (
    <div className="flex flex-col gap-stack py-2">
      <section className="flex flex-col gap-2 rounded-xl border border-border bg-card p-card text-card-foreground shadow-xs">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold">
              {weekdayLong(date)}, {longDate(date)}
            </h2>
            <p className="text-xs text-muted-foreground">
              {words.length > 0 ? words.join(' · ') : 'No cycle marks on this day'}
            </p>
          </div>
          <Button type="button" size="sm" variant="outline" className="h-9 shrink-0" onClick={onLog}>
            {log ? 'Edit this day' : 'Log this day'}
          </Button>
        </div>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <Row label="Flow" value={log?.flow ? FLOW_LABEL[log.flow] : 'Not logged'} />
          <Row
            label="Temperature"
            value={log?.temperatureC !== null && log?.temperatureC !== undefined ? `${log.temperatureC} °C` : 'Not logged'}
          />
          <Row label="LH test" value={log?.lhTest ? humanise(log.lhTest) : 'Not logged'} />
          <Row label="Mucus" value={log?.mucus ? humanise(log.mucus) : 'Not logged'} />
          {/*
           * Protected and unprotected are kept apart here as well as in the form:
           * the month is where a user looks back, and "Yes" would throw away the
           * difference the field was added for. A day recorded through the old
           * boolean says so rather than reading as "not logged".
           */}
          <Row label="Sex" value={intimacyLabel(log) ?? 'Not logged'} />
          <Row label="Ovulation pain" value={log?.ovulationPain ? 'Yes' : 'No'} />
        </dl>

        {symptoms.length > 0 ? (
          <p className="text-xs text-muted-foreground">
            Symptoms: {symptoms.map(humanise).join(', ')}
          </p>
        ) : null}
        {mood.length > 0 ? <p className="text-xs text-muted-foreground">Mood: {mood.map(humanise).join(', ')}</p> : null}
        {log?.notes ? <p className="text-xs text-muted-foreground">Notes: {log.notes}</p> : null}
      </section>

      <section className="flex flex-col gap-2 rounded-xl border border-border bg-card p-card text-card-foreground shadow-xs">
        <h2 className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">Birth control</h2>
        {method ? (
          <>
            <p className="text-sm">
              {METHOD_LABEL[method.method]}
              {method.label ? <span className="text-muted-foreground"> · {method.label}</span> : null}
            </p>
            <p className="text-xs text-muted-foreground">
              {schedule
                ? `Day ${schedule.cycleDay}, expected ${schedule.expected === 'on' ? 'on' : 'off'}${
                    schedule.logged ? ` · logged ${DAY_STATUS_LABEL[schedule.logged].toLowerCase()}` : ' · nothing logged'
                  }`
                : 'No on/off rhythm for this method.'}
            </p>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">No method recorded for this day.</p>
        )}
      </section>

      <p className="text-xs text-muted-foreground">
        {date === today ? 'This is today.' : 'Tap a day on the month to read it here.'}
      </p>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-col">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={cn('truncate', value === 'Not logged' && 'text-muted-foreground')}>{value}</dd>
    </div>
  );
}

/**
 * `2025-10-14` -> `October 2025`.
 *
 * Deliberately not a `lx` format call, so this file does not need a zone or a
 * DateTime: the only thing it formats is a floating month. `rangeLabel` and
 * friends in `./labels` do the date formatting the rest of the feature needs.
 */
function fromMonthAnchor(anchor: DateOnly): string {
  const [year, month] = anchor.split('-');
  return `${MONTH_NAMES[Number(month) - 1]} ${year}`;
}

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
