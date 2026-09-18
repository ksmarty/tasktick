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
 * ## The label is a control
 *
 * The published title is now `MonthPicker` rather than a bare string: the month
 * name is a button that opens a year/month picker. `PageHeader` publishes a
 * node, not a string, so this is the same mechanism with a different child — the
 * shell still renders exactly one title, still inside the same `h1`, and the
 * heading's accessible name is still the month name.
 *
 * The picker element is memoised on its primitive inputs rather than rebuilt on
 * every render. `PageHeader` republishes whenever the node's identity changes,
 * and a fresh element on every render of the screen would make the shell re-render
 * with it — through every gesture sample the month grid reports.
 *
 * Because that label changes without a navigation, the selected day is announced
 * through an `aria-live` region. That announcement is published *with* the title,
 * into the shell's bar, rather than dropped somewhere in the screen's own tree:
 * the bar is the landmark the heading lives in, so the announcement belongs to
 * the same element that changed, and it is never unmounted by the route wrapper
 * the shell remounts on every navigation. Tailwind's `sr-only` is the
 * visually-hidden recipe, so no hand-rolled clip is carried any more.
 */
import { useMemo } from 'react';
import { PageHeader } from '@/components/app/PageHeader';
import { MonthPicker } from './MonthPicker';

export interface CalendarToolbarProps {
  /** The visible month alone, e.g. "September". */
  label: string;
  /** The selected day in full, e.g. "Wednesday 16 September 2025". */
  selectedLabel: string;
  /** The visible month's year, e.g. 2026. Shown only inside the picker. */
  year: number;
  /** The visible month, zero-based (0 = January). */
  month: number;
  /** The user's zone, so the picker formats its twelve names like the label. */
  zone: string;
  /** Commits a month chosen in the picker; the screen turns it into a page move. */
  onSelectMonth: (year: number, month: number) => void;
}

export function CalendarToolbar({ label, selectedLabel, year, month, zone, onSelectMonth }: CalendarToolbarProps) {
  /*
   * Stable across unrelated re-renders: the four primitives are the whole input,
   * and `onSelectMonth` is a `useCallback` in the screen. Without this the
   * `PageHeader` publish effect would fire on every render of the calendar.
   */
  const title = useMemo(
    () => <MonthPicker label={label} year={year} month={month} zone={zone} onSelect={onSelectMonth} />,
    [label, year, month, zone, onSelectMonth],
  );

  return (
    <PageHeader title={title}>
      <span aria-live="polite" className="sr-only">
        {selectedLabel}
      </span>
    </PageHeader>
  );
}
