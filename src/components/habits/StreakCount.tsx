'use client';

/**
 * The right-aligned streak: the bare number in the habit's own period unit.
 *
 * The number itself always comes from the server (`habit.streak`) — this
 * component only formats it, so it can never disagree with the value the habit
 * list was sorted and summarised by.
 *
 * An empty streak renders nothing at all: a reading of "0" is noise, and the row
 * already has plenty to say.
 *
 * The visible figure is just the number — the bolt and the unit word are both
 * gone, so a five-day streak reads as `5`. That means the accessible name is the
 * only thing that still says what the number means: the wrapper keeps its
 * `Current streak 5 days, best 12` label and title, spelled out with
 * `streakPhrase`, because once the unit is off the screen a screen reader
 * would otherwise hear a context-free number.
 */
import { cn } from '@/lib/utils';
import { streakPhrase } from './period';
import type { HabitFrequency } from '@/lib/types';

export interface StreakCountProps {
  /** Consecutive completed periods, as computed server-side. */
  streak: number;
  frequency: HabitFrequency;
  /** Shown as a secondary "best" figure when it beats the current streak. */
  longestStreak?: number | null;
  className?: string;
}

export function StreakCount({ streak, frequency, longestStreak, className }: StreakCountProps) {
  if (streak <= 0) return null;

  const phrase = streakPhrase(streak, frequency);
  const best =
    typeof longestStreak === 'number' && longestStreak > streak ? streakPhrase(longestStreak, frequency) : null;
  const label = best ? `Current streak ${phrase}, best ${best}` : `Current streak ${phrase}`;

  return (
    <span
      aria-label={label}
      title={best ? `${phrase} · best ${best}` : phrase}
      className={cn('flex shrink-0 flex-col items-end leading-none', className)}
    >
      <span aria-hidden className="text-sm font-semibold leading-none tabular-nums">
        {streak}
      </span>
      <span aria-hidden className="mt-0.5 text-xs text-muted-foreground/70">
        Current Streak
      </span>
    </span>
  );
}
