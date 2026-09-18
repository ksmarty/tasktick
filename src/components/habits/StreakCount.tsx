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
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
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
    <Box
      component="span"
      className={className}
      aria-label={label}
      title={best ? `${phrase} · best ${best}` : phrase}
      sx={{
        display: 'flex',
        flexShrink: 0,
        flexDirection: 'column',
        alignItems: 'flex-end',
        lineHeight: 1,
      }}
    >
      <Box component="span" aria-hidden sx={{ display: 'flex', alignItems: 'baseline', gap: 0.5 }}>
        <Typography
          component="span"
          variant="h6"
          sx={{ fontWeight: 600, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}
        >
          {streak}
        </Typography>
        <Typography component="span" variant="caption" color="text.secondary" sx={{ fontWeight: 500 }}>
          {plural}
        </Typography>
      </Box>
      <Typography component="span" aria-hidden variant="caption" color="text.disabled" sx={{ mt: 0.25 }}>
        Current Streak
      </Typography>
    </Box>
  );
}
