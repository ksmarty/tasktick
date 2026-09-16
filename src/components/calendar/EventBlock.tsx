'use client';

/**
 * One block in the calendar: an event or a scheduled task.
 *
 * Both object kinds travel as the same `CalendarItem`, so the only visual
 * difference is the one a user actually needs — a task carries a checkbox glyph
 * and a dashed outline (a to-do you have scheduled), an event is a solid bar (a
 * commitment). Colour is never the only signal.
 *
 * The text colour is derived from the accent's luminance rather than assumed to
 * be white: yellow, orange and green blocks need dark text and would be
 * unreadable with the usual white label. `text-black` is used for that side
 * because the only other candidate — `text-label` — flips to white in dark mode,
 * which is exactly the failure this avoids.
 */
import type { PointerEvent as ReactPointerEvent, CSSProperties } from 'react';
import { formatTime } from '@/lib/dates';
import { cn } from '@/lib/cn';
import type { CalendarItem } from '@/lib/types';
import { itemColor } from './colors';
import { accentHex } from '@/lib/colors';
import { MIN_TOUCH_TARGET_PX, readableTextOn } from './geometry';
import type { CalendarLookup, CalendarPrefs } from './types';

export type EventBlockVariant = 'block' | 'bar';

export interface EventBlockProps {
  item: CalendarItem;
  prefs: CalendarPrefs;
  /** Used to honour the calendar's colour override. */
  calendars: CalendarLookup;
  /** `block` fills the timed grid; `bar` is the compact month/all-day row. */
  variant?: EventBlockVariant;
  /** Height in px of the surrounding slot, used for the expanded hit area. */
  heightPx?: number;
  /** Renders the start time before the title (timed grid only). */
  showTime?: boolean;
  onOpen: (item: CalendarItem) => void;
  onPointerDown?: (item: CalendarItem, event: ReactPointerEvent<HTMLButtonElement>) => void;
  /** Pixel offset while this block is being dragged. */
  drag?: { offsetX: number; offsetY: number } | null;
  className?: string;
  style?: CSSProperties;
}

export function EventBlock({
  item,
  prefs,
  calendars,
  variant = 'block',
  heightPx,
  showTime = false,
  onOpen,
  onPointerDown,
  drag = null,
  className,
  style,
}: EventBlockProps) {
  const hex = accentHex(itemColor(item, calendars));
  const darkText = readableTextOn(hex) === 'dark';
  const isTask = item.kind === 'task';
  const done = Boolean(item.completed);

  const timeLabel = item.isAllDay
    ? 'All day'
    : `${formatTime(item.startMs, prefs)} to ${formatTime(item.endMs, prefs)}`;
  const accessibleName = [timeLabel, item.title, isTask ? 'task' : 'event', done ? 'completed' : null]
    .filter(Boolean)
    .join(', ');

  // A 15-minute block is ~14px tall, which no finger can hit. The timed grid
  // therefore grows every short block to a 44px hit area. The month grid does
  // not: its bars sit on a 18px pitch, so 44px targets would overlap each other
  // and the tap would land on whichever happened to be last in the DOM.
  const expandHitArea = variant === 'block' && (heightPx ?? MIN_TOUCH_TARGET_PX) < MIN_TOUCH_TARGET_PX;

  return (
    <button
      type="button"
      aria-label={accessibleName}
      data-item-block="true"
      onClick={(event) => {
        event.stopPropagation();
        onOpen(item);
      }}
      onPointerDown={(event) => onPointerDown?.(item, event)}
      onContextMenu={(event) => event.preventDefault()}
      className={cn(
        'relative block w-full select-none overflow-visible text-left',
        variant === 'bar' ? 'h-4 rounded-ios-sm px-1 text-caption-2 leading-4' : 'rounded-ios-sm px-1.5 py-0.5 text-caption-1',
        isTask && 'border border-dashed',
        done && 'opacity-55',
        darkText ? 'text-black' : 'text-on-tint',
        drag && 'shadow-ios-lg opacity-90',
        className,
      )}
      style={{
        backgroundColor: hex,
        ...(drag ? { transform: `translate3d(${drag.offsetX}px, ${drag.offsetY}px, 0)`, zIndex: 40 } : null),
        ...style,
      }}
    >
      <span className={cn('block truncate', done && 'line-through')}>
        {isTask ? (
          <span aria-hidden className="mr-0.5 align-middle">
            {done ? '☑' : '☐'}
          </span>
        ) : null}
        {showTime && !item.isAllDay ? <span className="tnum mr-1">{formatTime(item.startMs, prefs)}</span> : null}
        {item.title}
      </span>

      {expandHitArea ? (
        <span
          aria-hidden
          className="absolute inset-x-0 top-1/2 -translate-y-1/2"
          style={{ height: MIN_TOUCH_TARGET_PX }}
        />
      ) : null}
    </button>
  );
}
