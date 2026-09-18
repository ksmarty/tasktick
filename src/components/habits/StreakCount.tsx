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
 *
 * The glyph is `lightning-bolt` rather than a flame: `local-fire-department` has
 * no animated counterpart, and a bolt is the app's existing "streak/priority"
 * mark. It is decorative — the accessible name on the wrapper already spells the
 * streak out in words.
 */
import { LightningBoltIcon } from '@svg-animated-icons/react/lightning-bolt';
import { cn } from '@/lib/utils';
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
      aria-label={label}
      title={best ? `${phrase} · best ${best}` : phrase}
      className={cn('flex shrink-0 flex-col items-end leading-none', className)}
    >
      <span aria-hidden className="flex items-baseline gap-1">
        <LightningBoltIcon className="size-4 text-muted-foreground" />
        <span className="text-lg font-semibold leading-none tabular-nums">{streak}</span>
        <span className="text-xs font-medium text-muted-foreground">{plural}</span>
      </span>
      <span aria-hidden className="mt-0.5 text-xs text-muted-foreground/70">
        Current Streak
      </span>
    </span>
  );
}
