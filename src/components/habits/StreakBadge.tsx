'use client';

/**
 * The streak chip: a flame, the number of consecutive periods and the unit.
 *
 * The number itself always comes from the server (`habit.streak`) — this
 * component only formats it, so the badge can never disagree with the value the
 * habit list was sorted and summarised by.
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
  const label = streakLabel(streak, frequency);
  const unit = streakUnit(frequency);
  const best = longestStreak && longestStreak > streak ? longestStreak : null;

  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-footnote font-medium',
        streak > 0 ? 'bg-tint-soft text-tint' : 'bg-fill-tertiary text-tertiary',
        className,
      )}
      aria-label={best ? `${label}, best ${best} ${unit}s` : label}
      title={best ? `${label} · best ${best}` : label}
    >
      <Flame className={cn('size-3.5 shrink-0', streak > 0 && 'text-warning')} aria-hidden />
      <span className="tnum">{streak}</span>
      <span className="text-caption-1">{unit === 'day' ? 'day' : unit}</span>
    </span>
  );
}
