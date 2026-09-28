'use client';

/**
 * The week strip: seven days, weekday initial over the date, with the selected
 * day raised.
 *
 * ## It is the month grid's own row, not a second calendar
 *
 * The strip never decides which days a week holds. The screen hands it the seven
 * days it took out of `buildMonthRows(rangeForView('month', …).days, anchor)` —
 * the same two calls `MonthGrid` is driven by, and the same expression
 * `MonthGrid` itself uses to pick the row its collapsed strip shows. So the strip
 * and the month cannot disagree about where a week starts: both read the user's
 * one `weekStartsOn` setting through `startOfWeek`, and both get whole weeks of
 * the same server-padded day list. There is deliberately no second week-start
 * setting and no date arithmetic in this file.
 *
 * The weekday initials come from the month header's own `weekdayLabels` helper,
 * for the same reason: rotating the captions is the one place a week start is
 * visible, and two helpers would be two chances to rotate it differently.
 *
 * ## The marks come from the month's own seam
 *
 * `markFor(date)` returns the same {@link DayMarks} the cycle month paints
 * (`./markers`), so "is this a period day" is answered by the one function that
 * answers it for the grid — a day whose flow the user recorded, or a day inside a
 * recorded cycle range. The strip paints only the `period` half of it (a filled
 * disc); the words behind that mark are the same `markWords` the grid's day
 * buttons announce, so a screen reader hears "period day" in both places.
 *
 * ## Decoration never takes a tap
 *
 * The tail under the selected day is `pointer-events-none` and `aria-hidden`,
 * like the month grid's dot lane: the selected day's own button keeps its whole
 * hit area, and nothing is announced twice.
 *
 * ## Semantics: a group of toggle buttons, not a tablist
 *
 * The seven days are a *set of controls with one active member*, which is what
 * `aria-pressed` models, so the strip is a `role="group"` named by the week it
 * shows and every day is a real `<button>`. It is deliberately not a tablist:
 * there is no tabpanel, nothing is hidden or revealed, and the arrow keys would
 * then have to mean "move the selection the way a tab strip does" — a promise
 * this control does not make. It is not a radiogroup either: the days are not
 * form options and nothing is submitted, and a radio role would drop the
 * `aria-current="date"` that today needs. Today keeps the `aria-current="date"`
 * the month grid's day buttons use, so "today" is stated the same way on both.
 *
 * Keyboard: one tab stop for the row (roving `tabindex`), arrows move *and*
 * select, `Home`/`End` jump to the ends — the same model as the month grid's day
 * lattice, which also selects as the arrow moves. The arrows clamp to the week
 * rather than paging: the two chevrons are the way to another week, and a
 * keystroke that silently refetches a month would be a surprising amount of work
 * for one arrow press.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { CaretDownIcon } from '@svg-animated-icons/react/caret-down';
import { ChevronLeftIcon } from '@svg-animated-icons/react/chevron-left';
import { ChevronRightIcon } from '@svg-animated-icons/react/chevron-right';
import { weekdayLabels } from '@/components/calendar';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { DateOnly } from '@/lib/types';
import { markWords, type DayMarks } from './markers';
import { longDate, weekdayLong } from './labels';

export interface WeekStripProps {
  /** The seven days of the shown week, from the month grid's own chunking. */
  days: readonly DateOnly[];
  /** The marks for a day, as `./markers` computes them for the month. */
  markFor: (date: DateOnly) => DayMarks;
  /** The day the screen is about: the raised disc. */
  selectedDate: DateOnly;
  today: DateOnly;
  /** The user's week start — the same value the month header is rotated by. */
  weekStartsOn: number;
  /** `July 2026`, from the same month range the days came from. */
  monthLabel: string;
  onSelectDate: (date: DateOnly) => void;
  onPreviousWeek: () => void;
  onNextWeek: () => void;
  /** Null when the selection is already today; the way back when it is not. */
  onToday: (() => void) | null;
}

export function WeekStrip({
  days,
  markFor,
  selectedDate,
  today,
  weekStartsOn,
  monthLabel,
  onSelectDate,
  onPreviousWeek,
  onNextWeek,
  onToday,
}: WeekStripProps) {
  const initials = useMemo(() => weekdayLabels(weekStartsOn, 'initial'), [weekStartsOn]);
  const buttons = useRef(new Map<DateOnly, HTMLButtonElement>());
  const [focusDate, setFocusDate] = useState(selectedDate);
  const pendingFocus = useRef(false);

  // The roving focus follows the selection whenever it changes from outside.
  useEffect(() => setFocusDate(selectedDate), [selectedDate]);

  useEffect(() => {
    if (!pendingFocus.current) return;
    pendingFocus.current = false;
    buttons.current.get(focusDate)?.focus({ preventScroll: true });
  }, [focusDate]);

  function onKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const index = days.indexOf(focusDate);
    if (index < 0) return;
    let next: number;

    switch (event.key) {
      case 'ArrowLeft':
        next = index - 1;
        break;
      case 'ArrowRight':
        next = index + 1;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = days.length - 1;
        break;
      default:
        return;
    }

    event.preventDefault();
    if (next < 0 || next >= days.length || next === index) return;
    const date = days[next];
    pendingFocus.current = true;
    setFocusDate(date);
    onSelectDate(date);
  }

  return (
    <section aria-label="This week" className="flex flex-col gap-1">
      {/*
        The strip's own heading row: which month the week belongs to, and how to
        reach another week. The chevrons replace the reference's month picker —
        the app already has a month grid on the cycle screen, and a second date
        picker would be a second place for the week start to disagree.
      */}
      <div className="flex items-center gap-1">
        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">{monthLabel}</h2>
        {onToday ? (
          <Button type="button" variant="ghost" size="sm" className="h-8 px-2 text-muted-foreground" onClick={onToday}>
            Today
          </Button>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Previous week"
          onClick={onPreviousWeek}
        >
          <ChevronLeftIcon className="size-4 text-base" />
        </Button>
        <Button type="button" variant="ghost" size="icon-sm" aria-label="Next week" onClick={onNextWeek}>
          <ChevronRightIcon className="size-4 text-base" />
        </Button>
      </div>

      <div
        role="group"
        data-week-strip={days[0] ?? selectedDate}
        aria-label={`Week of ${longDate(days[0] ?? selectedDate)}`}
        onKeyDown={onKeyDown}
        className="grid grid-cols-7 gap-1"
      >
        {days.map((date, index) => {
          const marks = markFor(date);
          const words = markWords(marks);
          const selected = date === selectedDate;
          const isToday = date === today;
          const state = marks.period
            ? selected
              ? 'period-selected'
              : 'period'
            : selected
              ? 'selected'
              : isToday
                ? 'today'
                : 'plain';
          const name = `${weekdayLong(date)}, ${longDate(date)}${words.length > 0 ? `, ${words.join(', ')}` : ''}${
            selected ? ', selected' : ''
          }`;

          return (
            <button
              key={date}
              ref={(node) => {
                if (node) buttons.current.set(date, node);
                else buttons.current.delete(date);
              }}
              type="button"
              data-date={date}
              tabIndex={focusDate === date ? 0 : -1}
              aria-pressed={selected}
              aria-current={isToday ? 'date' : undefined}
              aria-label={name}
              onClick={() => onSelectDate(date)}
              className="flex min-w-0 cursor-pointer flex-col items-center gap-1 rounded-lg py-1"
            >
              {/* The caption the month header uses, in the same dimmed grey. */}
              <span aria-hidden className="text-xs leading-none text-muted-foreground/60">
                {initials[index]}
              </span>

              {/*
                One layout box for every state, so the row never re-lays-out as
                the selection and the marks move: the painted disc is a child of
                it (`absolute inset-0 m-auto`), exactly as the month grid's day
                disc is, and the selected disc is the full 44px while plain and
                period days are 36px — the "larger than the row" the reference
                shows.

                The two states are independent, and the fill wins over the
                raised disc: a user who is bleeding today gets a filled disc that
                is also raised, because losing the period mark on the one day it
                is most likely to be true would be the wrong trade. The raised
                card-coloured disc with its shadow is the selection; today, when
                it is neither, keeps an outline so it is findable in a week the
                user has stepped away from.
              */}
              <span className="relative flex size-11 items-center justify-center">
                <span
                  aria-hidden
                  data-day-disc={state}
                  className={cn(
                    'absolute inset-0 m-auto rounded-full transition-colors duration-200',
                    selected ? 'size-11 shadow-md' : 'size-9',
                    marks.period
                      ? 'bg-primary'
                      : selected
                        ? 'bg-card ring-1 ring-border'
                        : isToday
                          ? 'border border-primary'
                          : '',
                  )}
                />
                <span
                  className={cn(
                    'relative text-sm leading-none tabular-nums',
                    marks.period
                      ? 'font-semibold text-primary-foreground'
                      : selected || isToday
                        ? 'font-semibold text-foreground'
                        : 'text-foreground',
                  )}
                >
                  {Number(date.slice(8, 10))}
                </span>
              </span>

              {/*
                The tail, from the selected day down into the card below it — the
                reference's one piece of ornament, and the thing that says the
                card belongs to the disc above it. It occupies a fixed-height slot
                in every cell so the row stays level, and it is decoration:
                `pointer-events-none` and `aria-hidden`, so the day keeps its own
                tap and its own accessible name.
              */}
              <span aria-hidden className="pointer-events-none flex h-3 flex-col items-center justify-start">
                {selected ? (
                  <>
                    <span className="h-1.5 w-px bg-border" />
                    <CaretDownIcon className="size-3 text-muted-foreground" />
                  </>
                ) : null}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
