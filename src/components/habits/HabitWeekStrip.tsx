'use client';

/**
 * The page header's week strip: one column per day, the selected day filled.
 *
 * Deliberately schedule-free — the habit's own week strip used to live inside
 * every card and said the same seven things over and over. Here the week is the
 * page's, and picking a day scopes the card list to it.
 *
 * The shape matches the calendar's week strip so the two screens read as
 * siblings: caption weekday letters, a plain date number, and a filled circle
 * for the selection. Days outside the selectable range — after today, or before
 * the earliest habit started — are dimmed and inert rather than hidden, so the
 * week keeps its shape.
 *
 * Each day is a real `<button>` in a `role="group"`; `disabled`, `aria-pressed`
 * and the full-date accessible name are unchanged from the Material version.
 */
import { cn } from '@/lib/utils';
import { WEEKDAY_SHORT, longDateLabel, weekOfDays } from './period';
import type { DateOnly } from '@/lib/types';

export interface HabitWeekStripProps {
  /** The week shown is the one containing `today`; this marks the chosen day. */
  selected: DateOnly;
  today: DateOnly;
  weekStartsOn: number;
  /** Earlier than this cannot be selected (the earliest habit's start date). */
  earliest?: DateOnly | null;
  onSelect: (date: DateOnly) => void;
  className?: string;
}

export function HabitWeekStrip({
  selected,
  today,
  weekStartsOn,
  earliest = null,
  onSelect,
  className,
}: HabitWeekStripProps) {
  const days = weekOfDays(today, weekStartsOn);

  return (
    <div
      role="group"
      aria-label="Week"
      className={cn('grid grid-cols-7 gap-1 px-row pt-1 pb-2', className)}
    >
      {days.map((day) => {
        const isSelected = day.date === selected;
        const isToday = day.date === today;
        const outOfRange = day.date > today || (earliest !== null && day.date < earliest);

        return (
          <button
            key={day.date}
            type="button"
            disabled={outOfRange}
            aria-pressed={isSelected}
            aria-label={`${WEEKDAY_SHORT[day.weekday]}, ${longDateLabel(day.date)}`}
            onClick={() => onSelect(day.date)}
            className="flex min-h-11 flex-col items-center justify-center gap-1 rounded-md py-1 select-none outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none"
          >
            <span aria-hidden className={cn('text-xs leading-none', outOfRange ? 'text-muted-foreground/50' : 'text-muted-foreground')}>
              {day.letter}
            </span>
            <span
              aria-hidden
              className={cn(
                'flex size-8 items-center justify-center rounded-full leading-none tabular-nums',
                isSelected
                  ? 'bg-primary font-semibold text-primary-foreground'
                  : outOfRange
                    ? 'text-muted-foreground/50'
                    : isToday
                      ? 'font-semibold text-primary'
                      : 'text-foreground',
              )}
            >
              {day.dayOfMonth}
            </span>
          </button>
        );
      })}
    </div>
  );
}
