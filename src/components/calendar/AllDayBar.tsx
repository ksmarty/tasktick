'use client';

/**
 * A single all-day item in the week/day all-day strip.
 *
 * The strip is a grid with one column per visible day, so a multi-day item is
 * ONE element spanning several columns — never a block drawn separately on each
 * day, which is what makes an all-day trip read as a continuous bar.
 */
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { CalendarItem } from '@/lib/types';
import { cn } from '@/lib/cn';
import { EventBlock } from './EventBlock';
import type { CalendarLookup, CalendarPrefs } from './types';

export interface AllDayBarProps {
  item: CalendarItem;
  prefs: CalendarPrefs;
  calendars: CalendarLookup;
  /** Zero-based index of the bar's first day column. */
  startIndex: number;
  /** Number of day columns the bar covers. */
  span: number;
  /** Index of the row the bar was packed into. */
  lane: number;
  onOpen: (item: CalendarItem) => void;
  onPointerDown?: (item: CalendarItem, event: ReactPointerEvent<HTMLButtonElement>) => void;
  drag?: { offsetX: number; offsetY: number } | null;
}

export function AllDayBar({
  item,
  prefs,
  calendars,
  startIndex,
  span,
  lane,
  onOpen,
  onPointerDown,
  drag = null,
}: AllDayBarProps) {
  return (
    <div
      className={cn('min-w-0 px-px', drag && 'relative z-40')}
      style={{ gridColumn: `${startIndex + 1} / span ${span}`, gridRow: lane + 1 }}
    >
      <EventBlock
        item={item}
        prefs={prefs}
        calendars={calendars}
        variant="bar"
        onOpen={onOpen}
        onPointerDown={onPointerDown}
        drag={drag}
        className="h-5 leading-5"
      />
    </div>
  );
}
