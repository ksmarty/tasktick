'use client';

/**
 * The calendar screen: one TickTick-style surface — a month grid on top and the
 * selected day's agenda below — replacing the old month/week/day/agenda modes.
 *
 * The month grid above is a dot indicator — the server's bucketed `days` map
 * says which days have anything on them — and the agenda below is the detail,
 * so the two never have to agree about anything but the selected date.
 *
 * What this file owns is the *window*: there is exactly ONE read of
 * `/api/calendar/items`, for the month containing the anchor day, recomputed
 * whenever the anchor changes. Everything the server already did (recurrence
 * expansion, day bucketing) is consumed as-is; nothing about dates is re-derived
 * here beyond the arithmetic of "which month am I looking at". Writes are
 * optimistic through `mutate`, then invalidated and refetched so the server's
 * answer always wins in the end.
 *
 * The neighbouring months are prefetched, so paging the month (or selecting a
 * day just past the month edge) renders from cache instead of flashing a
 * skeleton. The layout is a plain CSS breakpoint rather than a media-query hook:
 * on a phone the grid is a fixed share of the viewport and the agenda takes the
 * rest; on `lg:` the two sit side by side, the agenda a fixed 380px column.
 */
import { usePrimaryAction } from '@/lib/events';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { api, errorMessage } from '@/lib/api-client';
import {
  DATE_FORMAT,
  addDaysToDateOnly,
  combineDateAndTime,
  dateOnlyToMillis,
  fromDateOnly,
  rangeForView,
  shiftViewAnchor,
  timeIn,
  toDateOnly,
  todayIn,
} from '@/lib/dates';
import { invalidate, useResource } from '@/lib/store';
import { Chip, Skeleton, useToast } from '@/components/ui';
import type { CalendarItem, DateOnly, TimeOnly } from '@/lib/types';
import type { BootstrapPayload, CalendarItemsPayload } from '@/lib/view-types';
import { CalendarToolbar } from './CalendarToolbar';
import { DayAgenda } from './DayAgenda';
import { DayDetailSheet, DEFAULT_EVENT_START_MINUTE } from './DayDetailSheet';
import { EventEditorSheet, type EventDefaults } from './EventEditorSheet';
import { MonthGrid } from './MonthGrid';
import { SWIPE_PAGE_PX, minuteToTime, timeToMinute } from './geometry';
import { moveItemInPayload } from './optimistic';
import { createInteraction } from './types';
import type { CalendarInteraction, CalendarLookup, CalendarPrefs, RescheduleTarget } from './types';

/**
 * Sent as `calendarIds` when the user has hidden every calendar.
 *
 * The API treats an empty list as "use each calendar's own visibility", so an
 * empty list cannot express "nothing"; a sentinel that matches no id can.
 */
const NO_CALENDAR_ID = '__none__';

export interface CalendarScreenProps {
  /** `null` when `?date=` was missing or invalid: the screen falls back to today. */
  initialDate: DateOnly | null;
  /** `?calendar=<id>` — pins the view to one calendar. */
  initialCalendarId: string | null;
}

export function CalendarScreen({ initialDate, initialCalendarId }: CalendarScreenProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { toast } = useToast();

  const bootstrap = useResource<BootstrapPayload>('/api/bootstrap');
  const settings = bootstrap.data?.settings;
  const zone = settings?.timezone ?? 'UTC';
  const weekStartsOn = settings?.weekStartsOn ?? 1;
  const timeFormat = settings?.timeFormat ?? '24h';

  const [anchor, setAnchor] = useState<DateOnly | null>(initialDate);
  const [selectedDate, setSelectedDate] = useState<DateOnly | null>(initialDate);
  const [filterId, setFilterId] = useState<string | null>(initialCalendarId);
  const [daySheetDate, setDaySheetDate] = useState<DateOnly | null>(null);
  const [editor, setEditor] = useState<{ open: boolean; eventId: string | null; defaults: EventDefaults } | null>(null);

  // One mutable gesture record, shared with the grid and the agenda: it is how a
  // paging swipe knows to stand down during a drag, and how a drag swallows the
  // click that follows it.
  const [interaction] = useState<CalendarInteraction>(createInteraction);

  /*
   * Which way the last paging move went.
   *
   * `seq` is what the grid is keyed on: it changes on every paging move, so
   * React remounts the grid and the entrance animation replays instead of
   * playing once on first render. `direction` picks the side it enters from —
   * +1 for the next period, -1 for the previous one.
   *
   * Only `page` bumps it, so a period change caused by selecting a day (a
   * padding day from a neighbouring month) stays immediate: there is no gesture
   * direction to honour there.
   */
  const [pageMotion, setPageMotion] = useState<{ seq: number; direction: 1 | -1 }>({ seq: 0, direction: 1 });

  const today = todayIn(zone);
  const activeDate = anchor ?? today;
  const selected = selectedDate ?? today;
  const prefs: CalendarPrefs = useMemo(() => ({ zone, weekStartsOn, timeFormat }), [zone, weekStartsOn, timeFormat]);

  /*
   * The toolbar shows the month alone — no year, because there are no arrows to
   * page with any more; the swipe and the month itself are the title.
   */
  const monthLabel = useMemo(() => fromDateOnly(activeDate, zone).toFormat('LLLL'), [activeDate, zone]);

  const calendars = bootstrap.data?.calendars ?? [];
  const calendarLookup: CalendarLookup = useMemo(() => new Map(calendars.map((c) => [c.id, c])), [calendars]);
  const filterCalendar = filterId ? (calendarLookup.get(filterId) ?? null) : null;

  /**
   * The `calendarIds` the request is scoped to; `undefined` until we know better.
   *
   * Visibility is the calendar's own `isVisible`, set in Settings → Calendars:
   * the calendar view no longer carries a visibility control of its own, so
   * there is nothing local to overlay on top of it.
   */
  const calendarIds = useMemo(() => {
    if (filterCalendar) return [filterCalendar.id];
    if (calendars.length === 0) return undefined;
    const visible = calendars.filter((calendar) => calendar.isVisible).map((calendar) => calendar.id);
    return visible.length > 0 ? visible : [NO_CALENDAR_ID];
  }, [filterCalendar, calendars]);

  /** The visible month, padded out to whole weeks by the server's own range helper. */
  const range = useMemo(
    () => rangeForView('month', activeDate, zone, weekStartsOn),
    [activeDate, zone, weekStartsOn],
  );

  // Wait for the user's timezone before asking for a range: the window depends
  // on it, and a UTC range would be a wasted round trip that is immediately
  // superseded.
  const settingsReady = Boolean(bootstrap.data) || Boolean(bootstrap.error);

  const resource = useResource<CalendarItemsPayload>(
    '/api/calendar/items',
    { startMs: range.startMs, endMs: range.endMs, calendarIds },
    { enabled: settingsReady },
  );

  const payload = resource.data;
  const emptyPayload = useMemo<CalendarItemsPayload>(() => ({ items: [], calendars, days: {} }), [calendars]);
  const activePayload = payload ?? emptyPayload;
  const selectedItems = payload?.days[selected] ?? [];

  /* ------------------------------------------------------------------ */
  /* navigation                                                         */
  /* ------------------------------------------------------------------ */

  /** Moves a day by whole months, keeping the day-of-month where it exists. */
  const shiftMonthKeepingDay = useCallback(
    (date: DateOnly, delta: number): DateOnly =>
      fromDateOnly(date, zone).plus({ months: delta }).toFormat(DATE_FORMAT),
    [zone],
  );

  /** Selects a day, moving the displayed month with it when they disagree. */
  const selectDate = useCallback(
    (date: DateOnly) => {
      setSelectedDate(date);
      setAnchor((current) => {
        const base = current ?? date;
        return base.slice(0, 7) === date.slice(0, 7) ? base : date;
      });
    },
    [],
  );

  const page = useCallback(
    (delta: number) => {
      if (delta !== 0) {
        setPageMotion((current) => ({ seq: current.seq + 1, direction: delta > 0 ? 1 : -1 }));
      }
      setAnchor(shiftViewAnchor('month', activeDate, delta, zone));
      // The selection travels with the view, so the agenda keeps showing the
      // same day-of-month as the user pages.
      setSelectedDate((current) => shiftMonthKeepingDay(current ?? activeDate, delta));
    },
    [activeDate, zone, shiftMonthKeepingDay],
  );

  const moveDay = useCallback(
    (delta: number) => {
      selectDate(addDaysToDateOnly(selected, delta, zone));
    },
    [selected, zone, selectDate],
  );

  // Mirror the state into the URL so a reload, a bookmark or the back gesture
  // lands on the same day.
  useEffect(() => {
    const params = new URLSearchParams({ date: selected });
    if (filterId) params.set('calendar', filterId);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }, [selected, filterId, pathname, router]);

  /* ------------------------------------------------------------------ */
  /* writes                                                             */
  /* ------------------------------------------------------------------ */

  const refresh = useCallback(() => {
    invalidate('/api/calendar/items');
    void resource.refresh();
  }, [resource]);

  const reschedule = useCallback(
    (item: CalendarItem, target: RescheduleTarget) => {
      const base = resource.data ?? payload;
      if (!base) return;

      const move = planMove(item, target, prefs);
      resource.mutate((data) => moveItemInPayload(data ?? base, item.key, move, prefs.zone));

      const write =
        item.kind === 'event'
          ? move.isAllDay
            ? api.patch(`/api/events/${item.id}`, {
                isAllDay: true,
                startDate: move.startDate,
                endDate: move.endDateExclusive,
              })
            : api.patch(`/api/events/${item.id}`, { isAllDay: false, startMs: move.startMs, endMs: move.endMs })
          : // A task keeps its floating day plus a wall-clock time: the server
            // resolves `dueAtMs` from those two in the user's zone, which is the
            // only place that conversion is allowed to happen.
            api.patch(
              `/api/tasks/${item.id}`,
              move.isAllDay ? { dueDate: move.startDate } : { dueDate: move.startDate, dueTime: move.startTime },
            );

      write
        .then(() => {
          invalidate('/api/calendar/items');
          return resource.refresh();
        })
        .catch((error: unknown) => {
          // Roll back just this item, inside whatever the cache holds now, so the
          // grid never disagrees with the server about where the block is.
          resource.mutate((data) =>
            data
              ? moveItemInPayload(data, item.key, { startMs: item.startMs, endMs: item.endMs }, prefs.zone)
              : data,
          );
          toast({ title: 'Could not reschedule', description: errorMessage(error), variant: 'error' });
        });
    },
    [resource, payload, prefs, toast],
  );

  /* ------------------------------------------------------------------ */
  /* item interactions                                                   */
  /* ------------------------------------------------------------------ */

  const openItem = useCallback(
    (item: CalendarItem) => {
      // The click that follows a drag must not also open the editor.
      if (interaction.suppressClick) {
        interaction.suppressClick = false;
        return;
      }

      if (item.kind === 'event') {
        setEditor({ open: true, eventId: item.id, defaults: defaultsFor(item, prefs) });
        return;
      }
      router.push(`/tasks?task=${encodeURIComponent(item.id)}`);
    },
    [interaction, prefs, router],
  );

  const createAt = useCallback(
    (date: DateOnly, startMinute: number) => {
      const defaultCalendarId =
        filterCalendar?.id ?? calendars.find((calendar) => calendar.isDefault)?.id ?? calendars[0]?.id ?? null;
      setDaySheetDate(null);
      setEditor({
        open: true,
        eventId: null,
        defaults: {
          date,
          startMinute,
          endMinute: Math.min(startMinute + 60, 24 * 60),
          calendarId: defaultCalendarId,
        },
      });
    },
    [filterCalendar, calendars],
  );

  /*
   * The shell's action button starts a new event on the selected day.
   *
   * Registered AFTER `createAt` exists — a hook that closes over a `const`
   * declared below it hits the temporal dead zone the moment it runs.
   */
  usePrimaryAction(
    useCallback(() => {
      createAt(selected, DEFAULT_EVENT_START_MINUTE);
    }, [createAt, selected]),
  );

  /* ------------------------------------------------------------------ */
  /* swipe paging                                                       */
  /* ------------------------------------------------------------------ */

  /*
   * The month grid owns its own two gestures (vertical height, horizontal
   * paging) — see `MonthGrid` and `use-month-gestures` — because they share one
   * surface and must agree on their axis lock. What is left here is the agenda's
   * swipe: across the agenda it moves the selected day by one. A drag in flight
   * stands both down (`interaction.dragging`).
   */
  const agendaSwipe = useSwipePaging(interaction, moveDay);

  return (
    <>
      <div className="flex h-full min-h-0 flex-col">
        <CalendarToolbar
          label={monthLabel}
          selectedLabel={fromDateOnly(selected, prefs.zone).toFormat('cccc d LLLL yyyy')}
        />

        {filterCalendar ? (
          <div className="flex shrink-0 items-center px-4 pb-1.5">
            <Chip
              color={filterCalendar.color}
              onRemove={() => setFilterId(null)}
              removeLabel={`Stop filtering by ${filterCalendar.name}`}
            >
              {filterCalendar.name}
            </Chip>
          </div>
        ) : null}

        <div className="flex min-h-0 flex-1 flex-col lg:flex-row lg:gap-4 lg:p-3">
          {/*
            Sized by its own content — six 36px rows — not by a share of the
            viewport. The old `h-[48dvh]` stretched every row on a phone (~62px
            of mostly empty cell) and pushed the agenda down; the month is a
            plain surface now, so it only needs the room its numbers and dots
            occupy. Desktop keeps the left column.
          */}
          <section aria-label="Month" className="flex min-h-0 shrink-0 flex-col lg:flex-1">
            {!payload ? (
              resource.error ? (
                <p role="alert" className="px-4 py-8 text-center text-footnote text-danger">
                  {resource.error}
                </p>
              ) : (
                <CalendarSkeleton />
              )
            ) : (
              <MonthGrid
                days={range.days}
                anchor={activeDate}
                selectedDate={selected}
                today={today}
                pageSeq={pageMotion.seq}
                pageDirection={pageMotion.direction}
                payload={activePayload}
                prefs={prefs}
                calendars={calendarLookup}
                interaction={interaction}
                onSelectDate={selectDate}
                onOpenDay={setDaySheetDate}
                onOpenItem={openItem}
                onReschedule={reschedule}
                onPage={page}
              />
            )}
          </section>

          <section
            aria-label="Day agenda"
            {...agendaSwipe}
            className="flex min-h-0 flex-1 flex-col lg:h-auto lg:w-[380px] lg:flex-none"
          >
            <DayAgenda
              date={selected}
              today={today}
              items={selectedItems}
              prefs={prefs}
              calendars={calendarLookup}
              interaction={interaction}
              onOpenItem={openItem}
              onReschedule={reschedule}
              onCreateAt={createAt}
            />
          </section>
        </div>
      </div>

      <DayDetailSheet
        open={Boolean(daySheetDate)}
        onOpenChange={(open) => {
          if (!open) setDaySheetDate(null);
        }}
        date={daySheetDate ?? activeDate}
        items={daySheetDate && payload ? (payload.days[daySheetDate] ?? []) : []}
        calendars={calendarLookup}
        prefs={prefs}
        onOpenItem={(item) => {
          setDaySheetDate(null);
          openItem(item);
        }}
        onCreateAt={createAt}
      />

      <EventEditorSheet
        open={Boolean(editor?.open)}
        onOpenChange={(open) => {
          if (!open) setEditor(null);
        }}
        eventId={editor?.eventId ?? null}
        defaults={
          editor?.defaults ?? {
            date: selected,
            startMinute: DEFAULT_EVENT_START_MINUTE,
            endMinute: DEFAULT_EVENT_START_MINUTE + 60,
            calendarId: filterCalendar?.id ?? null,
          }
        }
        calendars={calendars}
        prefs={prefs}
        filter={filterCalendar ? { id: filterCalendar.id, name: filterCalendar.name, color: filterCalendar.color } : null}
        onChanged={refresh}
      />

      <PrefetchNeighbours
        anchor={activeDate}
        zone={zone}
        weekStartsOn={weekStartsOn}
        calendarIds={calendarIds}
        enabled={Boolean(payload) && !resource.isLoading}
      />
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* helpers                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * A horizontal swipe on `element` calls `onPage(±1)`.
 *
 * Deliberately touch-only: a mouse already has the chevrons and the keyboard,
 * and hijacking a mouse drag would fight the drag-to-reschedule gesture.
 */
function useSwipePaging(interaction: CalendarInteraction, onPage: (delta: number) => void) {
  const start = useRef<{ x: number; y: number } | null>(null);

  return {
    onPointerDown(event: ReactPointerEvent<HTMLElement>) {
      if (event.pointerType === 'mouse' || interaction.dragging) return;
      start.current = { x: event.clientX, y: event.clientY };
    },
    onPointerUp(event: ReactPointerEvent<HTMLElement>) {
      const from = start.current;
      start.current = null;
      if (!from || interaction.dragging || event.pointerType === 'mouse') return;

      const dx = event.clientX - from.x;
      const dy = event.clientY - from.y;
      if (Math.abs(dx) < SWIPE_PAGE_PX || Math.abs(dx) < Math.abs(dy) * 1.5) return;
      onPage(dx < 0 ? 1 : -1);
    },
    onPointerCancel() {
      start.current = null;
    },
  };
}

interface MovePlan {
  isAllDay: boolean;
  startMs: number;
  endMs: number;
  /** Inclusive first/last day, which is what the API takes for all-day spans. */
  startDate: DateOnly;
  endDateExclusive: DateOnly;
  startTime: TimeOnly;
}

/**
 * Turns a drag target into the instants that get written.
 *
 * Duration is preserved across a vertical drag; an all-day item moves by whole
 * days only. The day arithmetic goes through `lib/dates`, so a DST change on the
 * way cannot silently alter the result.
 */
function planMove(item: CalendarItem, target: RescheduleTarget, prefs: CalendarPrefs): MovePlan {
  if (item.isAllDay) {
    const lastDay = toDateOnly(Math.max(item.startMs, item.endMs - 1), prefs.zone);
    const startDate = addDaysToDateOnly(toDateOnly(item.startMs, prefs.zone), target.dayDelta, prefs.zone);
    const inclusiveEnd = addDaysToDateOnly(lastDay, target.dayDelta, prefs.zone);

    return {
      isAllDay: true,
      startMs: dateOnlyToMillis(startDate, prefs.zone),
      endMs: dateOnlyToMillis(addDaysToDateOnly(inclusiveEnd, 1, prefs.zone), prefs.zone),
      startDate,
      endDateExclusive: addDaysToDateOnly(inclusiveEnd, 1, prefs.zone),
      startTime: '00:00',
    };
  }

  const startDate = addDaysToDateOnly(toDateOnly(item.startMs, prefs.zone), target.dayDelta, prefs.zone);
  const startTime = minuteToTime(target.startMinute);
  const startMs = combineDateAndTime(startDate, startTime, prefs.zone);

  return {
    isAllDay: false,
    startMs,
    endMs: startMs + Math.max(0, item.endMs - item.startMs),
    startDate,
    endDateExclusive: addDaysToDateOnly(startDate, 1, prefs.zone),
    startTime,
  };
}

/** Prefill for the editor when an existing block is tapped. */
function defaultsFor(item: CalendarItem, prefs: CalendarPrefs): EventDefaults {
  const startMinute = item.isAllDay
    ? DEFAULT_EVENT_START_MINUTE
    : timeToMinute(timeIn(item.startMs, prefs.zone));

  return {
    date: toDateOnly(item.startMs, prefs.zone),
    startMinute,
    endMinute: item.isAllDay
      ? DEFAULT_EVENT_START_MINUTE + 60
      : startMinute + Math.max(30, Math.round((item.endMs - item.startMs) / 60_000)),
    calendarId: item.calendarId,
  };
}

/**
 * Warms the neighbouring months so paging renders instantly.
 *
 * It is a second `useResource` on purpose: the cache is keyed by range, so the
 * only way to have the next month ready is to have asked for it. It renders
 * nothing and never blocks the view.
 */
function PrefetchNeighbours({
  anchor,
  zone,
  weekStartsOn,
  calendarIds,
  enabled,
}: {
  anchor: DateOnly;
  zone: string;
  weekStartsOn: number;
  calendarIds: string[] | undefined;
  enabled: boolean;
}) {
  const [previous, next] = useMemo(
    () =>
      [-1, 1].map((delta) =>
        rangeForView('month', shiftViewAnchor('month', anchor, delta, zone), zone, weekStartsOn),
      ),
    [anchor, zone, weekStartsOn],
  );

  const options = { enabled, staleAfterMs: 60_000, revalidateOnFocus: false } as const;

  useResource<CalendarItemsPayload>(
    '/api/calendar/items',
    { startMs: previous.startMs, endMs: previous.endMs, calendarIds },
    options,
  );
  useResource<CalendarItemsPayload>(
    '/api/calendar/items',
    { startMs: next.startMs, endMs: next.endMs, calendarIds },
    options,
  );

  return null;
}

/** The first-load placeholder: shapes only, never a fake calendar. */
function CalendarSkeleton() {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 p-4" aria-busy>
      <div className="grid grid-cols-7 gap-1">
        {Array.from({ length: 42 }, (_, index) => (
          <Skeleton key={index} variant="rect" className="h-10" />
        ))}
      </div>
    </div>
  );
}
