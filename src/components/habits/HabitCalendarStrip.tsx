'use client';

/**
 * The current week, one column per day.
 *
 * Presentational on purpose: a seven-column row of 44pt buttons would eat the
 * card, and back-filling a different day already has a home (the heatmap cell
 * popover). So the strip is announced as a single image with a sentence that
 * reads the week out, and its marks are decorative.
 *
 * Every cell is the same box — `min-h-11`, the full touch-target height — so the
 * "today" ring is exactly the height of the strip instead of hanging off it,
 * and the bars line up across all seven columns.
 */
import { accentVar } from '@/lib/colors';
import { cn } from '@/lib/cn';
import { weekStripDays } from './period';
import type { DateOnly, Habit } from '@/lib/types';

export interface HabitCalendarStripProps {
  habit: Pick<Habit, 'frequency' | 'weekDays' | 'startDate' | 'entries' | 'color' | 'goalType'>;
  today: DateOnly;
  weekStartsOn: number;
  className?: string;
}

export function HabitCalendarStrip({ habit, today, weekStartsOn, className }: HabitCalendarStripProps) {
  const days = weekStripDays(habit, today, weekStartsOn);

  const description = days
    .map((day) => {
      const state = day.logged > 0 ? 'done' : day.isToday ? 'today, not logged yet' : day.due ? 'missed' : 'not scheduled';
      return `${day.initial}${day.date.slice(8)} ${state}`;
    })
    .join(', ');

  return (
    <div className={cn('grid grid-cols-7 gap-1', className)} role="img" aria-label={`This week: ${description}`}>
      {days.map((day) => (
        <div
          key={day.date}
          aria-hidden
          className={cn(
            'flex min-h-11 flex-col items-center justify-center gap-1.5 rounded-ios px-1',
            day.isToday && 'bg-fill-quaternary ring-1 ring-label',
          )}
        >
          <span
            className={cn(
              'text-caption-2 leading-none',
              day.due ? 'font-medium text-secondary' : 'text-tertiary',
            )}
          >
            {day.initial}
          </span>
          <span
            className={cn(
              'h-1.5 w-full rounded-full',
              day.logged === 0 && (day.due ? 'bg-fill-secondary' : 'bg-fill-quaternary'),
            )}
            style={day.logged > 0 ? { backgroundColor: accentVar(habit.color) } : undefined}
          />
        </div>
      ))}
    </div>
  );
}
