'use client';

/**
 * The calendar screen: one place that owns the visible window.
 *
 * There is exactly ONE read for every mode — `/api/calendar/items` with the range
 * `rangeForView` produced — and the range is recomputed whenever the view or the
 * anchor day changes. Everything the server already did (recurrence expansion,
 * day bucketing, overlap columns) is consumed as-is; nothing about dates is
 * re-derived here. Writes are optimistic through `mutate`, then invalidated and
 * refetched so the server's answer always wins in the end.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { api, errorMessage } from '@/lib/api-client';
import {
  addDaysToDateOnly,
  combineDateAndTime,
  dateOnlyToMillis,
  eachDayInclusive,
  fromDateOnly,
  rangeForView,
  shiftViewAnchor,
  timeIn,
  toDateOnly,
  todayIn,
} from '@/lib/dates';
import { invalidate, useResource } from '@/lib/store';
import { Sheet, Skeleton, useToast } from '@/components/ui';
import type { Calendar, CalendarItem, DateOnly, TimeOnly } from '@/lib/types';
import type { BootstrapPayload, CalendarItemsPayload } from '@/lib/view-types';
import { AgendaView } from './AgendaView';
import { CalendarSidebar } from './CalendarSidebar';
import { CalendarToolbar } from './CalendarToolbar';
import { DayDetailSheet, DEFAULT_EVENT_START_MINUTE } from './DayDetailSheet';
import { DayView } from './DayView';
import { EventEditorSheet, type EventDefaults } from './EventEditorSheet';
import { MiniMonth } from './MiniMonth';
import { MonthGrid } from './MonthGrid';
import { WeekView } from './WeekView';
import { SWIPE_PAGE_PX, minuteToTime, timeToMinute } from './geometry';
import { moveItemInPayload } from './optimistic';
import { createInteraction } from './types';
import type {
  CalendarInteraction,
  CalendarLookup,
  CalendarPrefs,
  CalendarViewMode,
  RescheduleTarget,
} from './types';

/** Days the agenda starts with, how much each scroll adds, and the hard cap. */
const AGENDA_PAGE_DAYS = 30;
const AGENDA_MAX_DAYS = 360;

/**
 * Sent as `calendarIds` when the user has hidden every calendar.
 *
 * The API treats an empty list as "use each calendar's own visibility", so an
 * empty list cannot express "nothing"; a sentinel that matches no id can.
 */
const NO_CALENDAR_ID = '__none__';

export interface CalendarScreenProps {
  initialView: CalendarViewMode;
  /** `null` when `?date=` was missing or invalid: the screen falls back to today. */
  initialDate: DateOnly | null;
  /** `?calendar=<id>` — pins the view to one calendar. */
  initialCalendarId: string | null;
}

export function CalendarScreen({ initialView, initialDate, initialCalendarId }: CalendarScreenProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { toast } = useToast();

  const bootstrap = useResource<BootstrapPayload>('/api/bootstrap');
  const settings = bootstrap.data?.settings;
  const zone = settings?.timezone ?? 'UTC';
  const weekStartsOn = settings?.weekStartsOn ?? 1;
  const timeFormat = settings?.timeFormat ?? '24h';

  const [view, setView] = useState<CalendarViewMode>(initialView);
  const [anchor, setAnchor] = useState<DateOnly | null>(initialDate);
  const [selectedDate, setSelectedDate] = useState<DateOnly | null>(initialDate);
  const [filterId, setFilterId] = useState<string | null>(initialCalendarId);
  const [agendaExtraDays, setAgendaExtraDays] = useState(0);
  const [visibility, setVisibility] = useState<Record<string, boolean>>({});
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [daySheetDate, setDaySheetDate] = useState<DateOnly | null>(null);
  const [editor, setEditor] = useState<{ open: boolean; eventId: string | null; defaults: EventDefaults } | null>(null);

  // One mutable gesture record, shared with every view: it is how a paging
  // swipe knows to stand down during a drag, and how a drag swallows the click
  // that follows it.
  const [interaction] = useState<CalendarInteraction>(createInteraction);

  const today = todayIn(zone);
  const activeDate = anchor ?? today;
  const prefs: CalendarPrefs = useMemo(() => ({ zone, weekStartsOn, timeFormat }), [zone, weekStartsOn, timeFormat]);

  const calendars = bootstrap.data?.calendars ?? [];
  const calendarLookup: CalendarLookup = useMemo(() => new Map(calendars.map((c) => [c.id, c])), [calendars]);
  const filterCalendar = filterId ? (calendarLookup.get(filterId) ?? null) : null;

  const visibilityById = useMemo(() => {
    const out: Record<string, boolean> = {};
    for (const calendar of calendars) out[calendar.id] = visibility[calendar.id] ?? calendar.isVisible;
    return out;
  }, [calendars, visibility]);

  /** The `calendarIds` the request is scoped to; `undefined` until we know better. */
  const calendarIds = useMemo(() => {
    if (filterCalendar) return [filterCalendar.id];
    if (calendars.length === 0) return undefined;
    const visible = calendars.filter((calendar) => visibilityById[calendar.id]).map((calendar) => calendar.id);
    return visible.length > 0 ? visible : [NO_CALENDAR_ID];
  }, [filterCalendar, calendars, visibilityById]);

  /** The visible window, widened by whole agenda pages as the list is scrolled. */
  const range = useMemo(() => {
    const base = rangeForView(view, activeDate, zone, weekStartsOn);
    if (view !== 'agenda' || agendaExtraDays === 0) return base;

    const endDate = addDaysToDateOnly(base.endDate, agendaExtraDays, zone);
    return {
      ...base,
      endDate,
      endMs: dateOnlyToMillis(addDaysToDateOnly(endDate, 1, zone), zone),
      days: eachDayInclusive(base.startDate, endDate, zone),
      label: `Next ${base.days.length + agendaExtraDays} days`,
    };
  }, [view, activeDate, zone, weekStartsOn, agendaExtraDays]);

  const wantsLayout = view === 'day' || view === 'week';

  // Wait for the user's timezone before asking for a range: the window depends
  // on it, and a UTC range would be a wasted round trip that is immediately
  // superseded.
  const settingsReady = Boolean(bootstrap.data) || Boolean(bootstrap.error);

  const resource = useResource<CalendarItemsPayload>(
    '/api/calendar/items',
    {
      startMs: range.startMs,
      endMs: range.endMs,
      layout: wantsLayout ? 1 : undefined,
      calendarIds,
    },
    { enabled: settingsReady },
  );

  // Keep the last answer for this view while the next one is in flight, so
  // widening the agenda (or landing on a prefetched month) never flashes a
  // skeleton. `resource.data` still wins the moment it arrives.
  const lastPayload = useRef<{ view: CalendarViewMode; payload: CalendarItemsPayload } | null>(null);
  if (resource.data) lastPayload.current = { view, payload: resource.data };
  const payload = resource.data ?? (lastPayload.current?.view === view ? lastPayload.current.payload : undefined);

  const isLoadingMore = Boolean(payload) && resource.isLoading;

  /* ------------------------------------------------------------------ */
  /* navigation                                                         */
  /* ------------------------------------------------------------------ */

  const goTo = useCallback(
    (date: DateOnly) => {
      setAnchor(date);
      setSelectedDate(date);
      setAgendaExtraDays(0);
    },
    [],
  );

  const page = useCallback(
    (delta: number) => {
      setAnchor(shiftViewAnchor(view, activeDate, delta, zone));
      // The selection travels with the view, so the month view's "add" action
      // never prefills a day from the month the user just paged away from.
      setSelectedDate(shiftViewAnchor(view, selectedDate ?? activeDate, delta, zone));
      setAgendaExtraDays(0);
    },
    [view, activeDate, selectedDate, zone],
  );

  const changeView = useCallback((next: CalendarViewMode) => {
    setView(next);
    setAgendaExtraDays(0);
  }, []);

  // Mirror the state into the URL so a reload, a bookmark or the back gesture
  // lands on the same window.
  useEffect(() => {
    const params = new URLSearchParams({ view, date: activeDate });
    if (filterId) params.set('calendar', filterId);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }, [view, activeDate, filterId, pathname, router]);

  // Horizontal swipe across the grid body pages the period on touch.
  const swipe = useRef<{ x: number; y: number } | null>(null);

  function onSwipeStart(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.pointerType === 'mouse' || interaction.dragging) return;
    swipe.current = { x: event.clientX, y: event.clientY };
  }

  function onSwipeEnd(event: ReactPointerEvent<HTMLDivElement>) {
    const start = swipe.current;
    swipe.current = null;
    if (!start || interaction.dragging || event.pointerType === 'mouse') return;

    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.abs(dx) < SWIPE_PAGE_PX || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    page(dx < 0 ? 1 : -1);
  }

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

  const toggleCalendar = useCallback(
    async (calendar: Calendar, visible: boolean) => {
      setVisibility((current) => ({ ...current, [calendar.id]: visible }));
      try {
        await api.patch(`/api/calendars/${calendar.id}`, { isVisible: visible });
        invalidate('/api/bootstrap');
      } catch (error) {
        setVisibility((current) => ({ ...current, [calendar.id]: !visible }));
        toast({ title: 'Could not update the calendar', description: errorMessage(error), variant: 'error' });
      }
    },
    [toast],
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

  const addFromToolbar = useCallback(() => {
    if (view === 'month') {
      createAt(selectedDate ?? activeDate, DEFAULT_EVENT_START_MINUTE);
      return;
    }
    createAt(activeDate, DEFAULT_EVENT_START_MINUTE);
  }, [view, selectedDate, activeDate, createAt]);

  const hasMoreAgenda = range.days.length < AGENDA_MAX_DAYS;
  const loadMoreAgenda = useCallback(() => {
    setAgendaExtraDays((current) =>
      Math.min(current + AGENDA_PAGE_DAYS, AGENDA_MAX_DAYS - AGENDA_PAGE_DAYS),
    );
  }, []);

  const daySheetItems = daySheetDate && payload ? (payload.days[daySheetDate] ?? []) : [];

  const emptyPayload = useMemo<CalendarItemsPayload>(
    () => ({ items: [], calendars, days: {} }),
    [calendars],
  );
  const activePayload = payload ?? emptyPayload;

  const viewProps = {
    today,
    payload: activePayload,
    prefs,
    calendars: calendarLookup,
    interaction,
    onCreateAt: createAt,
    onOpenItem: openItem,
    onReschedule: reschedule,
    onOpenDay: setDaySheetDate,
  };

  return (
    <>
      <CalendarToolbar
        view={view}
        onViewChange={changeView}
        label={range.label}
        anchorLabel={fromDateOnly(activeDate, prefs.zone).toFormat('ccc d LLL')}
        onPrev={() => page(-1)}
        onNext={() => page(1)}
        onToday={() => goTo(today)}
        onAdd={addFromToolbar}
        onOpenCalendars={() => setSidebarOpen(true)}
        filter={filterCalendar ? { id: filterCalendar.id, name: filterCalendar.name, color: filterCalendar.color } : null}
        onClearFilter={() => setFilterId(null)}
      />

      <div
        onPointerDown={onSwipeStart}
        onPointerUp={onSwipeEnd}
        onPointerCancel={() => {
          swipe.current = null;
        }}
        className="touch-pan-y"
      >
        {!payload ? (
          resource.error ? (
            <p role="alert" className="px-4 py-8 text-center text-footnote text-danger">
              {resource.error}
            </p>
          ) : (
            <CalendarSkeleton />
          )
        ) : view === 'month' ? (
          <MonthGrid
            {...viewProps}
            days={range.days}
            anchor={activeDate}
            selectedDate={selectedDate ?? activeDate}
          />
        ) : view === 'week' ? (
          <WeekView {...viewProps} days={range.days} />
        ) : view === 'day' ? (
          <DayView {...viewProps} days={range.days} />
        ) : (
          <AgendaView
            days={range.days}
            today={today}
            payload={activePayload}
            prefs={prefs}
            calendars={calendarLookup}
            onOpenItem={openItem}
            onOpenDay={setDaySheetDate}
            onLoadMore={loadMoreAgenda}
            hasMore={hasMoreAgenda}
            isLoadingMore={isLoadingMore}
          />
        )}
      </div>

      <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen} title="Calendars" snapPoints={[0.6, 0.95]}>
        <CalendarSidebar
          calendars={calendars}
          visibility={visibilityById}
          onToggleVisibility={toggleCalendar}
          onFocusCalendar={(calendar) => setFilterId(calendar.id)}
          filter={filterCalendar ? { id: filterCalendar.id, name: filterCalendar.name, color: filterCalendar.color } : null}
          onClearFilter={() => setFilterId(null)}
          onCreateEvent={() => {
            setSidebarOpen(false);
            createAt(selectedDate ?? activeDate, DEFAULT_EVENT_START_MINUTE);
          }}
        >
          <MiniMonth
            anchor={activeDate}
            selectedDate={selectedDate ?? activeDate}
            today={today}
            counts={payload?.days ? Object.fromEntries(Object.entries(payload.days).map(([day, items]) => [day, items.length])) : {}}
            prefs={prefs}
            onSelectDate={(date) => {
              goTo(date);
              setSidebarOpen(false);
            }}
          />
        </CalendarSidebar>
      </Sheet>

      <DayDetailSheet
        open={Boolean(daySheetDate)}
        onOpenChange={(open) => {
          if (!open) setDaySheetDate(null);
        }}
        date={daySheetDate ?? activeDate}
        items={daySheetItems}
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
            date: activeDate,
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

      {view !== 'agenda' ? (
        <PrefetchNeighbours
          view={view}
          anchor={activeDate}
          zone={zone}
          weekStartsOn={weekStartsOn}
          layout={wantsLayout}
          calendarIds={calendarIds}
          enabled={Boolean(payload) && !resource.isLoading}
        />
      ) : null}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* helpers                                                                     */
/* -------------------------------------------------------------------------- */

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
 * Warms the neighbouring ranges so paging a month (or a week) renders instantly.
 *
 * It is a second `useResource` on purpose: the cache is keyed by range, so the
 * only way to have the next month ready is to have asked for it. It renders
 * nothing and never blocks the view.
 */
function PrefetchNeighbours({
  view,
  anchor,
  zone,
  weekStartsOn,
  layout,
  calendarIds,
  enabled,
}: {
  view: CalendarViewMode;
  anchor: DateOnly;
  zone: string;
  weekStartsOn: number;
  layout: boolean;
  calendarIds: string[] | undefined;
  enabled: boolean;
}) {
  const [previous, next] = useMemo(
    () =>
      [-1, 1].map((delta) =>
        rangeForView(view, shiftViewAnchor(view, anchor, delta, zone), zone, weekStartsOn),
      ),
    [view, anchor, zone, weekStartsOn],
  );

  const options = { enabled, staleAfterMs: 60_000, revalidateOnFocus: false } as const;

  useResource<CalendarItemsPayload>(
    '/api/calendar/items',
    { startMs: previous.startMs, endMs: previous.endMs, layout: layout ? 1 : undefined, calendarIds },
    options,
  );
  useResource<CalendarItemsPayload>(
    '/api/calendar/items',
    { startMs: next.startMs, endMs: next.endMs, layout: layout ? 1 : undefined, calendarIds },
    options,
  );

  return null;
}

/** The first-load placeholder: shapes only, never a fake calendar. */
function CalendarSkeleton() {
  return (
    <div className="space-y-2 p-4" aria-busy>
      <Skeleton variant="rect" className="h-8" />
      <div className="grid grid-cols-7 gap-1">
        {Array.from({ length: 42 }, (_, index) => (
          <Skeleton key={index} variant="rect" className="h-12" />
        ))}
      </div>
    </div>
  );
}
