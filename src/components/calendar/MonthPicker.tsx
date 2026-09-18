'use client';

/**
 * The month name in the app bar, as a control: a `Popover` holding a year
 * stepper and a twelve-month grid.
 *
 * The toolbar is deliberately month-only — no year, no chevrons — because the
 * swipe and the month itself are the title. That leaves the year reachable only
 * through this picker: the label is a button now, and choosing a month is the
 * one jump the calendar cannot express as a gesture (a swipe moves one month at
 * a time, so January is eleven swipes away).
 *
 * ## Why it is a `Popover` and not a `SegmentedControl`
 *
 * The choice is two-dimensional (a year *and* a month) and it closes on commit;
 * a segmented control is a persistent single-row selector, which would put
 * twelve months — or twelve years — across the app bar. `Popover` also brings
 * the behaviour this needs for free: focus into the panel on open, focus back to
 * the trigger on close, Escape to dismiss and focus trapping inside the panel.
 *
 * ## Keyboard
 *
 * The trigger is a real `button`, so Enter and Space open it; the panel then
 * holds three controls — previous year, next year, and the twelve months — all
 * of them tabbable, with the arrow keys moving focus across the month grid in
 * both axes. The month the calendar is showing carries `aria-current`, and the
 * accessible name of the trigger says both what it shows and what it does, so
 * the control is not just "September" floating in the header.
 *
 * ## Dates
 *
 * The only arithmetic here is "which month did the user pick": the picker
 * reports a year and a zero-based month, and `CalendarScreen` turns that into a
 * whole number of month steps through `lib/dates`. Nothing about recurrence,
 * EXDATE or overlap is touched — the server expands all three.
 *
 * Month names come from the same `lib/dates`/Luxon formatting the toolbar label
 * uses, so the twelve names and the title can never disagree about the locale.
 */
import { useCallback, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { CaretDownIcon } from '@svg-animated-icons/react/caret-down';
import { ChevronLeftIcon } from '@svg-animated-icons/react/chevron-left';
import { ChevronRightIcon } from '@svg-animated-icons/react/chevron-right';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { fromDateOnly } from '@/lib/dates';

const MONTHS_PER_YEAR = 12;

/** How many months sit on one row of the picker's grid. */
const MONTH_GRID_COLUMNS = 3;

export interface MonthPickerProps {
  /** The displayed month's name, e.g. "September" — the trigger's visible text. */
  label: string;
  /** The displayed month's year, e.g. 2026. */
  year: number;
  /** The displayed month, zero-based (0 = January). */
  month: number;
  /** The user's zone, used only to format the twelve month names. */
  zone: string;
  /** Commits a choice: the caller turns it into whole month steps. */
  onSelect: (year: number, month: number) => void;
}

export function MonthPicker({ label, year, month, zone, onSelect }: MonthPickerProps) {
  const [open, setOpen] = useState(false);
  /*
   * The year the panel is browsing, which is not the displayed year once the
   * user steps away from it. Opening the panel always starts on the displayed
   * year again — otherwise the last browsing session would silently decide
   * which months a later tap picks.
   */
  const [pickerYear, setPickerYear] = useState(year);
  const monthRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const onOpenChange = useCallback(
    (next: boolean) => {
      if (next) setPickerYear(year);
      setOpen(next);
    },
    [year],
  );

  const monthNames = useMemo(
    () =>
      Array.from({ length: MONTHS_PER_YEAR }, (_, index) =>
        fromDateOnly(`${pickerYear}-${String(index + 1).padStart(2, '0')}-01`, zone).toFormat('LLLL'),
      ),
    [pickerYear, zone],
  );

  /**
   * Arrow-key movement across the twelve months.
   *
   * Focus is what moves, never the selection: choosing a month is the commit,
   * and arrowing through the grid must not jump the calendar twelve times.
   */
  const onMonthGridKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    const step =
      event.key === 'ArrowLeft'
        ? -1
        : event.key === 'ArrowRight'
          ? 1
          : event.key === 'ArrowUp'
            ? -MONTH_GRID_COLUMNS
            : event.key === 'ArrowDown'
              ? MONTH_GRID_COLUMNS
              : 0;
    if (step === 0) return;

    const focused = monthRefs.current.indexOf(document.activeElement as HTMLButtonElement);
    if (focused < 0) return;
    const next = Math.min(MONTHS_PER_YEAR - 1, Math.max(0, focused + step));
    if (next === focused) return;

    event.preventDefault();
    monthRefs.current[next]?.focus();
  }, []);

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          /*
           * The name says what it shows and what it does. "September" alone
           * would announce a heading's worth of text on a control whose effect
           * is invisible until it is pressed.
           */
          aria-label={`Change month, currently ${label}`}
          className="hover:bg-accent focus-visible:ring-ring -mx-1 flex min-w-0 cursor-pointer items-center gap-0.5 rounded-md px-1 py-0.5 text-lg font-semibold outline-none focus-visible:ring-2"
        >
          <span className="truncate">{label}</span>
          <CaretDownIcon aria-hidden className="text-muted-foreground size-4" />
        </button>
      </PopoverTrigger>

      <PopoverContent align="start" aria-label="Choose a month" className="w-72 gap-2 p-2">
        {/* Year stepper: the year is only ever visible in here. */}
        <div className="flex items-center justify-between gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Previous year"
            onClick={() => setPickerYear((current) => current - 1)}
          >
            <ChevronLeftIcon aria-hidden className="size-4" />
          </Button>

          <span aria-live="polite" className="text-sm font-semibold tabular-nums">
            {pickerYear}
          </span>

          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Next year"
            onClick={() => setPickerYear((current) => current + 1)}
          >
            <ChevronRightIcon aria-hidden className="size-4" />
          </Button>
        </div>

        <div
          onKeyDown={onMonthGridKeyDown}
          className="grid grid-cols-3 gap-1"
        >
          {monthNames.map((name, index) => {
            const isShown = pickerYear === year && index === month;
            return (
              <Button
                key={name}
                ref={(node) => {
                  monthRefs.current[index] = node;
                }}
                type="button"
                variant={isShown ? 'default' : 'ghost'}
                size="sm"
                aria-current={isShown ? 'true' : undefined}
                aria-label={isShown ? `${name} ${pickerYear}, shown` : `${name} ${pickerYear}`}
                onClick={() => {
                  onSelect(pickerYear, index);
                  setOpen(false);
                }}
                className="w-full min-w-0 px-1 text-xs"
              >
                <span className="truncate">{name}</span>
              </Button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
