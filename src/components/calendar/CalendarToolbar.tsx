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
 *
 * The bar is a touch shorter than the app's standard one. `--nav-h` (44px) is
 * the shell's token and belongs to `globals.css`, so the calendar shrinks its
 * own bar locally instead of moving the token for every screen: the row is 40px
 * — still 4px clear of the 36px chevrons, the `Today` button and the `+` — and
 * the bar's own height is recomputed with the same safe-area inset
 * `h-header` uses, so a notched phone keeps its clearance.
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
      /*
        The two arbitrary selectors reach `NavBar`'s own two wrappers (the
        `h-header` block and the 44px row) and have the specificity to win
        against them; see the note at the top of this file.
      */
      className="[&>div]:h-[calc(env(safe-area-inset-top,0px)+2.5rem)] [&>div>div]:h-10"
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
          {/* Desktop only: on a phone the floating action button owns creation. */}
          <span className="hidden lg:inline-flex">
            <IconButton aria-label="New event" icon={Plus} size="sm" variant="tinted" onClick={onAdd} />
          </span>
        </div>
      }
    >
      <span aria-live="polite" className="sr-only">
        {selectedLabel}
      </span>
    </NavBar>
  );
}
