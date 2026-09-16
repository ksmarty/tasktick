'use client';

/**
 * One item in the month grid: a solid rounded pill.
 *
 * A month cell is about *what and when*, not *what kind*. At 390px a cell is
 * ~55px wide, and the previous rendering spent that width on a checkbox glyph
 * and a dashed outline, which left 2–4 characters of the title ("Sta…", "Pre…")
 * and read as visual noise. So the pill is now:
 *
 *   · the calendar colour as a **solid fill**, no dashed edge and no glyph;
 *   · one line of text, clipped with an ellipsis, never wrapped and never
 *     allowed to leave the pill (`overflow-hidden` + `truncate`);
 *   · foreground text derived from the fill's **luminance** — yellow, orange and
 *     green need dark text, and assuming white is how a yellow event becomes
 *     unreadable.
 *
 * The event/task distinction survives at month scale through the fill alone:
 * an event is the solid accent, a task is the same hue at a low tint. The
 * checkbox glyph and the dashed edge live in the agenda and the day sheet, where
 * there is room for them and where the reading order is linear.
 */
import type { PointerEvent as ReactPointerEvent } from 'react';
import { accentHex, accentSoft } from '@/lib/colors';
import { formatTime } from '@/lib/dates';
import { cn } from '@/lib/cn';
import type { CalendarItem } from '@/lib/types';
import { itemColor } from './colors';
import { readableTextOn } from './geometry';
import type { CalendarLookup, CalendarPrefs } from './types';

/**
 * Alpha of a task's tinted fill.
 *
 * Translucent on purpose: the pill sits on the themed cell background, so the
 * same value reads as a pale hue in light appearance and a deep one in dark,
 * which is what lets `text-label` stay legible in both without the component
 * having to know which theme is active.
 */
const TASK_TINT_ALPHA = 0.24;

export interface EventBlockProps {
  item: CalendarItem;
  prefs: CalendarPrefs;
  /** Used to honour the calendar's colour override. */
  calendars: CalendarLookup;
  /** Height and type size, owned by the caller so the grid's budget stays true. */
  className?: string;
  onOpen: (item: CalendarItem) => void;
  onPointerDown?: (item: CalendarItem, event: ReactPointerEvent<HTMLButtonElement>) => void;
  /** Pixel offset while this block is being dragged. */
  drag?: { offsetX: number; offsetY: number } | null;
}

export function EventBlock({ item, prefs, calendars, className, onOpen, onPointerDown, drag = null }: EventBlockProps) {
  const color = itemColor(item, calendars);
  const hex = accentHex(color);
  const isTask = item.kind === 'task';
  const done = Boolean(item.completed);

  // A task is a tint of its hue (translucent, so it adapts to the theme and
  // `text-label` — which flips with it — stays readable). An event is the solid
  // accent, with black text on the light hues.
  const background = isTask ? accentSoft(color, TASK_TINT_ALPHA) : hex;
  const textClass = isTask ? 'text-label' : readableTextOn(hex) === 'dark' ? 'text-black' : 'text-on-tint';

  const timeLabel = item.isAllDay
    ? 'All day'
    : `${formatTime(item.startMs, prefs)} to ${formatTime(item.endMs, prefs)}`;
  const accessibleName = [timeLabel, item.title, isTask ? 'task' : 'event', done ? 'completed' : null]
    .filter(Boolean)
    .join(', ');

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
        'block w-full select-none overflow-hidden rounded-full px-1.5 text-left',
        textClass,
        done && 'opacity-60',
        drag && 'relative z-40 shadow-ios-lg',
        className,
      )}
      style={{
        backgroundColor: background,
        ...(drag ? { transform: `translate3d(${drag.offsetX}px, ${drag.offsetY}px, 0)` } : null),
      }}
    >
      <span className={cn('block truncate whitespace-nowrap', done && 'line-through')}>{item.title}</span>
    </button>
  );
}
