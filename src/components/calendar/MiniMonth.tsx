'use client';

/**
 * The mini month, used inside the calendar sidebar.
 *
 * It builds its window through `rangeForView('month', …)` and chunks it with the
 * same `buildMonthRows` the full grid uses, so the two can never disagree about
 * which seven days a week contains. Day dots come from the *already fetched*
 * payload: the mini month never triggers a request of its own.
 */
import { useMemo } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { fromDateOnly, rangeForView, shiftViewAnchor } from '@/lib/dates';
import { cn } from '@/lib/cn';
import type { DateOnly } from '@/lib/types';
import { Button, IconButton } from '@/components/ui';
import { buildMonthRows, weekdayLabels } from './geometry';
import type { CalendarPrefs } from './types';

export interface MiniMonthProps {
  /** A day inside the month to display (not necessarily the selection). */
  anchor: DateOnly;
  selectedDate: DateOnly;
  today: DateOnly;
  /** `YYYY-MM-DD` → number of items, for the dots. */
  counts: Record<string, number>;
  prefs: CalendarPrefs;
  onSelectDate: (date: DateOnly) => void;
}

/** Dots drawn under a day before they stop being informative. */
const MAX_DOTS = 3;

export function MiniMonth({ anchor, selectedDate, today, counts, prefs, onSelectDate }: MiniMonthProps) {
  const months = useMemo(() => {
    const current = fromDateOnly(anchor, prefs.zone).startOf('month');
    const previous = shiftViewAnchor('month', anchor, -1, prefs.zone);
    const next = shiftViewAnchor('month', anchor, 1, prefs.zone);
    return {
      label: current.toFormat('LLLL yyyy'),
      previous,
      next,
      rows: buildMonthRows(rangeForView('month', anchor, prefs.zone, prefs.weekStartsOn).days, anchor),
    };
  }, [anchor, prefs.zone, prefs.weekStartsOn]);

  const headers = useMemo(() => weekdayLabels(prefs.weekStartsOn, 'initial'), [prefs.weekStartsOn]);

  return (
    <div className="rounded-ios-md bg-elevated px-2 py-2">
      <div className="flex items-center justify-between">
        <IconButton
          aria-label="Previous month"
          icon={ChevronLeft}
          size="sm"
          onClick={() => onSelectDate(months.previous)}
        />
        <span className="text-subhead font-semibold text-label">{months.label}</span>
        <IconButton aria-label="Next month" icon={ChevronRight} size="sm" onClick={() => onSelectDate(months.next)} />
      </div>

      <div className="mt-1 grid grid-cols-7">
        {headers.map((label, index) => (
          <span key={`${label}-${index}`} aria-hidden className="py-0.5 text-center text-caption-2 text-tertiary">
            {label}
          </span>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-y-0.5">
        {months.rows.flat().map((cell) => {
          const isSelected = cell.date === selectedDate;
          const isToday = cell.date === today;
          const dots = Math.min(counts[cell.date] ?? 0, MAX_DOTS);
          const label = fromDateOnly(cell.date, prefs.zone).toFormat('d LLLL yyyy');

          return (
            <button
              key={cell.date}
              type="button"
              aria-label={`${label}${dots > 0 ? `, ${counts[cell.date]} items` : ''}`}
              aria-current={isToday ? 'date' : undefined}
              aria-pressed={isSelected}
              onClick={() => onSelectDate(cell.date)}
              className={cn(
                'tnum flex h-8 flex-col items-center justify-center rounded-ios-sm text-caption-1 pressable',
                !cell.inMonth && 'text-tertiary',
                cell.inMonth && !isSelected && 'text-label',
                isSelected && 'bg-tint font-semibold text-tint-contrast',
                isToday && !isSelected && 'font-semibold text-tint',
              )}
            >
              {Number(cell.date.slice(8, 10))}
              <span aria-hidden className="flex h-1 items-center gap-0.5">
                {Array.from({ length: dots }, (_, index) => (
                  <span
                    key={index}
                    className={cn('size-1 rounded-full', isSelected ? 'bg-tint-contrast' : 'bg-tertiary')}
                  />
                ))}
              </span>
            </button>
          );
        })}
      </div>

      <div className="mt-1 flex justify-center">
        <Button variant="plain" size="sm" onClick={() => onSelectDate(today)} className="text-caption-1">
          Go to today
        </Button>
      </div>
    </div>
  );
}
