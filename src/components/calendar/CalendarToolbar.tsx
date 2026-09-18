'use client';

/**
 * The calendar toolbar — the month name, and nothing else.
 *
 * The bar used to carry a year, prev/next chevrons, a `Today` button and a
 * desktop-only `+`. All of them are gone: paging is a swipe on the grid and
 * creation is the shell's floating action button (or the day detail sheet), so
 * a row of buttons above the month was chrome competing with the two gestures
 * the surface now owns. What is left is the label the grid needs to be readable
 * — the month name, without the year, because the arrow-free month is the whole
 * title.
 *
 * ## One header, not two
 *
 * The app shell owns the single top app bar, so this bar *publishes* its month
 * into it rather than stacking a second header under it — that is what
 * `PageHeader` is for, and it is how the safe-area inset, the border and the
 * title row stay identical on every screen. The month is therefore the page
 * heading, which is exactly the label the grid is showing. That mechanism is
 * unchanged by the GodUI migration and other code depends on it: nothing here
 * may stop publishing, and nothing may start rendering a second visible title.
 *
 * Because that label changes without a navigation, the selected day is announced
 * through an `aria-live` region. That announcement is published *with* the title,
 * into the shell's bar, rather than dropped somewhere in the screen's own tree:
 * the bar is the landmark the heading lives in, so the announcement belongs to
 * the same element that changed, and it is never unmounted by the route wrapper
 * the shell remounts on every navigation. Tailwind's `sr-only` is the
 * visually-hidden recipe, so no hand-rolled clip is carried any more.
 */
import { PageHeader } from '@/components/app/PageHeader';

export interface CalendarToolbarProps {
  /** The visible month alone, e.g. "September". */
  label: string;
  /** The selected day in full, e.g. "Wednesday 16 September 2025". */
  selectedLabel: string;
}

export function CalendarToolbar({ label, selectedLabel }: CalendarToolbarProps) {
  return (
    <PageHeader title={label}>
      <span aria-live="polite" className="sr-only">
        {selectedLabel}
      </span>
    </PageHeader>
  );
}
