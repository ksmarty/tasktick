'use client';

/**
 * The calendar toolbar — the month name, and nothing else.
 *
 * The bar used to carry a year, prev/next chevrons, a `Today` button and a
 * desktop-only `+`. All of them are gone: paging is a swipe on the grid and
 * creation is the shell's floating action button (or the agenda's own "New
 * event"), so a row of buttons above the month was chrome competing with the
 * two gestures the surface now owns. What is left is the label the grid needs
 * to be readable — the month name, without the year, because the arrow-free
 * month is the whole title.
 *
 * The visible `h1` is still a screen-reader-only "Calendar" heading; the month
 * itself is a plain label beside it. Because the label changes without a
 * navigation, the selected day is announced through an `aria-live` region —
 * that announcement is the only thing this bar owns besides the name.
 *
 * The `NavBar` is a touch shorter than the app's standard one. `--nav-h` (44px)
 * is the shell's token and belongs to `globals.css`, so the calendar shrinks its
 * own bar locally instead of moving the token for every screen: the row is 40px,
 * and the bar's own height is recomputed with the same safe-area inset `h-header`
 * uses, so a notched phone keeps its clearance.
 */
import { NavBar } from '@/components/ui';

export interface CalendarToolbarProps {
  /** The visible month alone, e.g. "September". */
  label: string;
  /** The selected day in full, e.g. "Wednesday 16 September 2025". */
  selectedLabel: string;
}

export function CalendarToolbar({ label, selectedLabel }: CalendarToolbarProps) {
  return (
    <NavBar
      /*
        The two arbitrary selectors reach `NavBar`'s own two wrappers (the
        `h-header` block and the 44px row) and have the specificity to win
        against them; see the note at the top of this file.
      */
      className="[&>div]:h-[calc(env(safe-area-inset-top,0px)+2.5rem)] [&>div>div]:h-10"
      title={<span className="sr-only">Calendar</span>}
      leading={<span className="min-w-0 truncate text-headline font-semibold text-label">{label}</span>}
    >
      <span aria-live="polite" className="sr-only">
        {selectedLabel}
      </span>
    </NavBar>
  );
}
