'use client';

/**
 * The streak chip: a flame, the number of consecutive periods and the unit.
 *
 * The number itself always comes from the server (`habit.streak`) — this
 * component only formats it, so the badge can never disagree with the value the
 * habit list was sorted and summarised by.
 *
 * An empty streak renders nothing at all: a chip reading "0 day" is both
 * ungrammatical and noise, and the row already has plenty to say.
 */
import { Flame } from 'lucide-react';
import { cn } from '@/lib/cn';
import { streakLabel, streakUnit } from './period';
import type { HabitFrequency } from '@/lib/types';

export interface StreakBadgeProps {
  /** Consecutive completed periods, as computed server-side. */
  streak: number;
  frequency: HabitFrequency;
  /** Shown as a secondary "best" figure when it beats the current streak. */
  longestStreak?: number | null;
  className?: string;
}

export function StreakBadge({ streak, frequency, longestStreak, className }: StreakBadgeProps) {
  if (streak <= 0) return null;

  const unit = streakUnit(frequency);
  const plural = streak === 1 ? unit : `${unit}s`;
  const label = streakLabel(streak, frequency);
  const best =
    typeof longestStreak === 'number' && longestStreak > streak
      ? `${longestStreak} ${longestStreak === 1 ? unit : `${unit}s`}`
      : null;

  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-full bg-tint-soft px-2 py-0.5 text-footnote font-medium text-tint',
        className,
      )}
      aria-label={best ? `${label}, best ${best}` : label}
      title={best ? `${label} · best ${best}` : label}
    >
      <Flame className="size-3.5 shrink-0 text-warning" aria-hidden />
      <span className="tnum">{streak}</span>
      <span>{plural}</span>
    </span>
  );
}
