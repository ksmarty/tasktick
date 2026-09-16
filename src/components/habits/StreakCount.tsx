'use client';

/**
 * The right-aligned streak: the number in the habit's own period unit, with a
 * tiny "Current Streak" caption under it.
 *
 * The number itself always comes from the server (`habit.streak`) — this
 * component only formats it, so it can never disagree with the value the habit
 * list was sorted and summarised by.
 *
 * An empty streak renders nothing at all: a reading of "0 day" is both
 * ungrammatical and noise, and the row already has plenty to say.
 */
import { cn } from '@/lib/cn';
import { streakPhrase, streakUnit } from './period';
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

  const unit = streakUnit(frequency);
  const plural = streak === 1 ? unit : `${unit}s`;
  const phrase = streakPhrase(streak, frequency);
  const best =
    typeof longestStreak === 'number' && longestStreak > streak ? streakPhrase(longestStreak, frequency) : null;
  const label = best ? `Current streak ${phrase}, best ${best}` : `Current streak ${phrase}`;

  return (
    <span
      className={cn('flex shrink-0 flex-col items-end leading-none', className)}
      aria-label={label}
      title={best ? `${phrase} · best ${best}` : phrase}
    >
      <span aria-hidden className="flex items-baseline gap-1">
        <span className="tnum text-title-3 font-semibold text-label">{streak}</span>
        <span className="text-caption-2 font-medium text-secondary">{plural}</span>
      </span>
      <span aria-hidden className="mt-0.5 text-caption-2 text-tertiary">
        Current Streak
      </span>
    </span>
  );
}
