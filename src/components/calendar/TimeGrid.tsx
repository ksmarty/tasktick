'use client';

/**
 * The shared time grid behind the week and day views.
 *
 * One column (day view) or seven (week view), 24 hour rows and a sticky hour
 * gutter. The interesting rules it encodes:
 *
 *   · Position of a timed block comes *entirely* from the server's `layout`
 *     (`column` / `columns`). There is no overlap sweep in the client — a second
 *     implementation would be a second source of truth for the same fact.
 *   · A block never renders shorter than `MIN_BLOCK_PX`, and shorter blocks grow
 *     an invisible hit area to the 44px minimum, so a 15-minute event is
 *     still tappable.
 *   · The current-time line is a red rule that refreshes on a minute interval
 *     and clears it on unmount.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { addDaysToDateOnly, fromDateOnly, toDateOnly } from '@/lib/dates';
import { cn } from '@/lib/cn';
import { useMediaQuery } from '@/lib/store';
import type { CalendarItem, DateOnly } from '@/lib/types';
import type { CalendarItemsPayload } from '@/lib/view-types';
import { AllDayBar } from './AllDayBar';
import { DragGhostLabel } from './DragGhostLabel';
import { EventBlock } from './EventBlock';
import {
  DEFAULT_HOUR_HEIGHT,
  DESKTOP_HOUR_HEIGHT,
  HOURS_PER_DAY,
  LONG_PRESS_MS,
  MIN_BLOCK_PX,
  MINUTES_PER_DAY,
  PRESS_SLOP_PX,
  clamp,
  formatHourLabel,
  formatMinuteLabel,
  layoutAllDayLanes,
  minuteOfDay,
  minutesToPixels,
  pixelsToSnappedMinutes,
  weekdayLabels,
} from './geometry';
import { useItemDrag } from './use-item-drag';
import type { CalendarInteraction, CalendarLookup, CalendarPrefs, ItemOpenHandler, RescheduleHandler } from './types';

export interface TimeGridProps {
  /** One day (day view) or seven (week view), as returned by the server. */
  days: DateOnly[];
  today: DateOnly;
  payload: CalendarItemsPayload;
  prefs: CalendarPrefs;
  /** Lookup used to honour each calendar's colour override. */
  calendars: CalendarLookup;
  interaction: CalendarInteraction;
  /** Prefills the editor from a tapped empty slot. */
  onCreateAt: (date: DateOnly, startMinute: number) => void;
  onOpenItem: ItemOpenHandler;
  onReschedule: RescheduleHandler;
  /** Tapping a day header opens that day's detail sheet. */
  onOpenDay: (date: DateOnly) => void;
}

/** All-day rows shown before the strip collapses into "+N more". */
const MAX_ALL_DAY_LANES = 3;

export function TimeGrid({
  days,
  today,
  payload,
  prefs,
  calendars,
  interaction,
  onCreateAt,
  onOpenItem,
  onReschedule,
  onOpenDay,
}: TimeGridProps) {
  const gridRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const isWide = useMediaQuery('(min-width: 640px)');
  const hourHeight = isWide ? DESKTOP_HOUR_HEIGHT : DEFAULT_HOUR_HEIGHT;

  const { lanes, laneCount } = useMemo(
    () => layoutAllDayLanes(payload.items, days, prefs.zone),
    [payload.items, days, prefs.zone],
  );

  const visibleLanes = lanes.filter((lane) => lane.lane < MAX_ALL_DAY_LANES);
  const hiddenPerDay = useMemo(() => {
    const hidden = new Array<number>(days.length).fill(0);
    for (const lane of lanes) {
      if (lane.lane < MAX_ALL_DAY_LANES) continue;
      for (let index = lane.startIndex; index < lane.startIndex + lane.span; index += 1) hidden[index] += 1;
    }
    return hidden;
  }, [lanes, days.length]);

  const drag = useItemDrag({
    hourHeight,
    gridRef,
    boundsRef: containerRef,
    interaction,
    axis: (init) => {
      const rect = gridRef.current?.getBoundingClientRect();
      if (!rect) return null;
      return {
        columns: days.length,
        index: init.cellIndex,
        count: days.length,
        cellWidth: rect.width / Math.max(days.length, 1),
        rowHeight: 0,
      };
    },
    formatLabel: (item, target) => {
      const date = addDaysToDateOnly(toDateOnly(item.startMs, prefs.zone), target.dayDelta, prefs.zone);
      const dayLabel = fromDateOnly(date, prefs.zone).toFormat(days.length > 1 ? 'ccc' : 'd LLL');
      return `${dayLabel} ${formatMinuteLabel(target.startMinute, prefs.timeFormat)}`;
    },
    onDrop: onReschedule,
  });

  const nowMs = useMinuteTick();
  const nowMinute = nowMs === null ? null : minuteOfDay(nowMs, prefs.zone);
  const todayIndex = days.indexOf(today);

  const dayIndexByDate = useMemo(() => new Map(days.map((day, index) => [day, index])), [days]);

  const timed = useMemo(() => {
    const out: { item: CalendarItem; dayIndex: number; column: number; columns: number; startMinute: number; endMinute: number }[] = [];
    for (const entry of payload.layout ?? []) {
      const dayIndex = dayIndexByDate.get(toDateOnly(entry.item.startMs, prefs.zone));
      if (dayIndex === undefined) continue;

      const startMinute = clamp(minuteOfDay(entry.item.startMs, prefs.zone), 0, MINUTES_PER_DAY);
      // A block crossing midnight is drawn to the end of its start day; the
      // server already puts the same item on the following day as well.
      const duration = Math.round((entry.item.endMs - entry.item.startMs) / 60_000);
      const endMinute = clamp(startMinute + duration, startMinute, MINUTES_PER_DAY);

      out.push({
        item: entry.item,
        dayIndex,
        column: Math.max(0, entry.column),
        columns: Math.max(1, entry.columns),
        startMinute,
        endMinute,
      });
    }
    return out;
  }, [payload.layout, dayIndexByDate, prefs.zone]);

  /** Timed blocks grouped by the column they belong to, ready to position. */
  const timedByDay = useMemo(() => {
    const grouped = new Map<number, typeof timed>();
    for (const entry of timed) {
      const list = grouped.get(entry.dayIndex);
      if (list) list.push(entry);
      else grouped.set(entry.dayIndex, [entry]);
    }
    return grouped;
  }, [timed]);

  /** Tap or long-press an empty slot to create an event at that time. */
  function onSlotPointerDown(event: ReactPointerEvent<HTMLDivElement>, date: DateOnly) {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if (interaction.dragging) return;

    const rect = event.currentTarget.getBoundingClientRect();
    const originX = event.clientX;
    const originY = event.clientY;
    let cancelled = false;
    let fired = false;

    const minuteAt = (clientY: number) =>
      clamp(pixelsToSnappedMinutes(clientY - rect.top, hourHeight), 0, MINUTES_PER_DAY - 15);

    const fire = (clientY: number) => {
      if (cancelled || fired) return;
      fired = true;
      cleanup();
      onCreateAt(date, minuteAt(clientY));
    };

    const move = (pointer: PointerEvent) => {
      if (Math.hypot(pointer.clientX - originX, pointer.clientY - originY) > PRESS_SLOP_PX) {
        cancelled = true;
        cleanup();
      }
    };
    const up = (pointer: PointerEvent) => fire(pointer.clientY);
    const cancel = () => {
      cancelled = true;
      cleanup();
    };
    const cleanup = () => {
      window.clearTimeout(timer);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
    };

    const timer = window.setTimeout(() => fire(originY), LONG_PRESS_MS);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
  }

  const weekdayCaptions = weekdayLabels(prefs.weekStartsOn);

  return (
    <div ref={containerRef} className="flex flex-col">
      {/* Day headers + all-day strip. Sticky under the nav bar, because an
          all-day item is context the user needs while scrolling the hours. */}
      <div className="material sticky z-30 border-b border-separator" style={{ top: 'var(--header-total)' }}>
        <div className="flex">
          <div className="w-14 shrink-0" aria-hidden />
          <div className="grid flex-1" style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}>
            {days.map((day) => {
              const isToday = day === today;
              return (
                <button
                  key={day}
                  type="button"
                  aria-label={fromDateOnly(day, prefs.zone).toFormat('cccc d LLLL yyyy')}
                  aria-current={isToday ? 'date' : undefined}
                  onClick={() => onOpenDay(day)}
                  className="flex min-h-11 flex-col items-center justify-center pressable"
                >
                  {days.length > 1 ? (
                    <span className="text-caption-1 text-secondary">
                      {weekdayCaptions[(fromDateOnly(day, prefs.zone).weekday - prefs.weekStartsOn + 7) % 7]}
                    </span>
                  ) : null}
                  <span
                    className={cn(
                      'tnum flex size-6 items-center justify-center rounded-full text-footnote',
                      isToday ? 'bg-tint font-semibold text-tint-contrast' : 'text-label',
                    )}
                  >
                    {Number(day.slice(8, 10))}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {laneCount > 0 ? (
          <div className="flex border-t border-separator py-0.5">
            <span className="w-14 shrink-0 pt-0.5 pr-1 text-right text-caption-2 text-tertiary">all-day</span>
            <div
              className="grid min-w-0 flex-1 gap-y-0.5"
              style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}
            >
              {visibleLanes.map((lane) => (
                <AllDayBar
                  key={lane.item.key}
                  item={lane.item}
                  prefs={prefs}
                  calendars={calendars}
                  startIndex={lane.startIndex}
                  span={lane.span}
                  lane={lane.lane}
                  onOpen={onOpenItem}
                  onPointerDown={(item, event) => {
                    event.stopPropagation();
                    drag.begin(item, event, {
                      startMinute: 0,
                      durationMinutes: 0,
                      cellIndex: lane.startIndex,
                    });
                  }}
                  drag={drag.ghost?.item.key === lane.item.key ? drag.ghost : null}
                />
              ))}

              {hiddenPerDay.some((count) => count > 0)
                ? days.map((day, index) =>
                    hiddenPerDay[index] > 0 ? (
                      <button
                        key={`more-${day}`}
                        type="button"
                        onClick={() => onOpenDay(day)}
                        style={{ gridColumn: index + 1, gridRow: MAX_ALL_DAY_LANES + 1 }}
                        className="min-h-5 truncate px-1 text-left text-caption-2 text-secondary pressable"
                      >
                        +{hiddenPerDay[index]} more
                      </button>
                    ) : null,
                  )
                : null}
            </div>
          </div>
        ) : null}
      </div>

      {/* The scrolling hours. */}
      <div className="flex">
        <div className="sticky left-0 z-20 w-14 shrink-0 bg-bg">
          {Array.from({ length: HOURS_PER_DAY }, (_, hour) => (
            <div key={hour} className="relative" style={{ height: hourHeight }}>
              <span className="tnum absolute -top-2 right-1 text-caption-2 text-tertiary">
                {hour === 0 ? '' : formatHourLabel(hour, prefs.timeFormat)}
              </span>
            </div>
          ))}
        </div>

        <div
          ref={gridRef}
          className="relative min-w-0 flex-1 select-none"
          style={{ height: hourHeight * HOURS_PER_DAY, touchAction: 'pan-y' }}
        >
          <div className="grid h-full" style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}>
            {days.map((day, dayIndex) => (
              <div
                key={day}
                className="relative border-r border-separator last:border-r-0"
                onPointerDown={(event) => onSlotPointerDown(event, day)}
              >
                {Array.from({ length: HOURS_PER_DAY }, (_, hour) => (
                  <div key={hour} className="border-b border-separator" style={{ height: hourHeight }} />
                ))}

                {(timedByDay.get(dayIndex) ?? []).map((entry) => {
                  const height = Math.max(
                    MIN_BLOCK_PX,
                    minutesToPixels(entry.endMinute - entry.startMinute, hourHeight),
                  );
                  const isDragging = drag.ghost?.item.key === entry.item.key;

                  return (
                    <div
                      key={entry.item.key}
                      className="absolute px-px"
                      style={{
                        top: minutesToPixels(entry.startMinute, hourHeight),
                        height,
                        // Straight from the server's overlap layout.
                        left: `${(entry.column / entry.columns) * 100}%`,
                        width: `${(1 / entry.columns) * 100}%`,
                        zIndex: isDragging ? 40 : entry.column + 1,
                      }}
                    >
                      <EventBlock
                        item={entry.item}
                        prefs={prefs}
                        calendars={calendars}
                        heightPx={height}
                        showTime
                        onOpen={onOpenItem}
                        onPointerDown={(item, event) => {
                          event.stopPropagation();
                          drag.begin(item, event, {
                            startMinute: entry.startMinute,
                            durationMinutes: entry.endMinute - entry.startMinute,
                            cellIndex: entry.dayIndex,
                          });
                        }}
                        drag={isDragging ? drag.ghost : null}
                        className="h-full"
                      />
                    </div>
                  );
                })}
              </div>
            ))}
          </div>

          {nowMinute !== null && todayIndex >= 0 ? (
            <div
              aria-hidden
              className="pointer-events-none absolute z-30"
              style={{
                top: minutesToPixels(nowMinute, hourHeight),
                left: `${(todayIndex / days.length) * 100}%`,
                width: `${100 / days.length}%`,
              }}
            >
              <div className="relative h-0.5 bg-ios-red">
                <span className="absolute -top-[3px] -left-1 size-2 rounded-full bg-ios-red" />
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {drag.ghost ? <DragGhostLabel ghost={drag.ghost} /> : null}
    </div>
  );
}

/**
 * The current instant, refreshed once a minute.
 *
 * Starts as `null` so the server-rendered HTML and the first client render
 * agree (a red line at a different minute on each side would be a hydration
 * mismatch), and the interval is cleared on unmount.
 */
function useMinuteTick(): number | null {
  const [nowMs, setNowMs] = useState<number | null>(null);

  useEffect(() => {
    setNowMs(Date.now());
    const id = window.setInterval(() => setNowMs(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  return nowMs;
}
