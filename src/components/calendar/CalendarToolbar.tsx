'use client';

/**
 * The calendar toolbar — one tidy row, and nothing else.
 *
 * `[◀] [Month Year] [▶]` on the left, `[Today] [+]` on the right. The previous
 * version squeezed a four-item segmented control in beside the title, which on a
 * phone rendered as "M.. W.. D.. A..", and parked the prev/next chevrons in a
 * second row that floated over the weekday header. Both are gone: the toolbar is
 * a single `NavBar` row, so it is `sticky` inside the scroll pane and the grid
 * below it can never collide with it.
 *
 * The month label is the `NavBar` title in spirit but sits with the chevrons, so
 * the three read as one control; the visible `h1` is a screen-reader-only
 * "Calendar" heading instead. Because the label changes without a navigation,
 * the selected day is announced through an `aria-live` region.
 */
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { Button, IconButton, NavBar } from '@/components/ui';

export interface CalendarToolbarProps {
  /** The visible month, e.g. "September 2025". */
  label: string;
  /** The selected day in full, e.g. "Wednesday 16 September 2025". */
  selectedLabel: string;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  onAdd: () => void;
}

export function CalendarToolbar({ label, selectedLabel, onPrev, onNext, onToday, onAdd }: CalendarToolbarProps) {
  return (
    <NavBar
      title={<span className="sr-only">Calendar</span>}
      leading={
        <div className="flex min-w-0 items-center gap-1">
          <IconButton aria-label="Previous month" icon={ChevronLeft} size="sm" onClick={onPrev} />
          <span className="min-w-0 truncate text-headline font-semibold text-label">{label}</span>
          <IconButton aria-label="Next month" icon={ChevronRight} size="sm" onClick={onNext} />
        </div>
      }
      trailing={
        <div className="flex items-center gap-1">
          <Button variant="plain" size="sm" onClick={onToday} className="px-2">
            Today
          </Button>
          <IconButton aria-label="New event" icon={Plus} size="sm" variant="tinted" onClick={onAdd} />
        </div>
      }
    >
      <span aria-live="polite" className="sr-only">
        {selectedLabel}
      </span>
    </NavBar>
  );
}
