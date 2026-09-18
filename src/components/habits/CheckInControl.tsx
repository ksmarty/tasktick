'use client';

/**
 * The check-in control that leads a habit row.
 *
 * Two shapes, chosen by the habit's goal type, in one 44px-tall box so the row
 * geometry is identical for every habit:
 *
 *   - **boolean** — one circular MUI `Checkbox`, exactly the iOS task circle,
 *     that toggles between `{ count: 1 }` and `{ count: null }`.
 *   - **count / duration** — `[−] 3/8 [+]`: the amount the server holds for the
 *     period, with `−` and `+` sending `delta: -1` / `delta: 1` so the server
 *     increments the stored amount instead of the client guessing it.
 *
 * It is the leading element but deliberately not the loudest: the stepper's
 * glyphs are tinted, not filled, because the streak number on the other end of
 * the row is what the reference layout puts the weight on.
 *
 * The control checks in for `date` — the day the page's week strip selected —
 * never for a date it assumes. A daily habit reads that day's entry from the
 * server's `entries` map; a weekly/monthly habit keeps the server's period
 * total, because its period spans days and only the server can aggregate it.
 *
 * The satisfying bit is deliberately tiny: the tick pops each time the habit
 * becomes done, which is enough feedback without a confetti library or a
 * layout-thrashing animation. Material has no `pop`; it is a state cue, so it is
 * drawn here with Emotion's `keyframes` — remounting the wrapper on the flip
 * replays it.
 */
import { keyframes } from '@emotion/react';
import Box from '@mui/material/Box';
import Checkbox from '@mui/material/Checkbox';
import IconButton from '@mui/material/IconButton';
import Typography from '@mui/material/Typography';
import AddIcon from '@mui/icons-material/Add';
import RemoveIcon from '@mui/icons-material/Remove';
import { habitDoneOn, habitProgressView, longDateLabel, type CheckInChange } from './period';
import type { DateOnly, Habit } from '@/lib/types';

/** The tick's little pop; the whole animation is the remount on the flip. */
const pop = keyframes`
  0% { transform: scale(0.82); }
  55% { transform: scale(1.12); }
  100% { transform: scale(1); }
`;

export interface CheckInControlProps {
  habit: Habit;
  /** The day this control checks in for. */
  date: DateOnly;
  /** Today, in the user's timezone — anchors the period view. */
  today: DateOnly;
  onCheckIn: (change: CheckInChange) => void;
  /** Disables the controls while a write is in flight. */
  pending?: boolean;
  className?: string;
}

export function CheckInControl({ habit, date, today, onCheckIn, pending = false, className }: CheckInControlProps) {
  const view = habitProgressView(habit, today);
  const done = habitDoneOn(habit, date, today);
  const when = date === today ? 'today' : longDateLabel(date);

  if (!view.counted) {
    return (
      <Box
        component="span"
        className={className}
        data-checked={done ? 'true' : 'false'}
        sx={{ display: 'flex', flexShrink: 0, alignItems: 'center' }}
      >
        {/* Remounting on the flip replays the pop, which is the whole animation. */}
        <Box
          component="span"
          key={done ? 'checked' : 'open'}
          sx={{ display: 'inline-flex', animation: `${pop} 300ms ease-out` }}
        >
          <Checkbox
            checked={done}
            disabled={pending}
            // 24px of glyph over 10px of padding is the 44px touch target.
            sx={{ p: '10px', '& .MuiSvgIcon-root': { fontSize: 24 } }}
            slotProps={{
              input: {
                'aria-label': done
                  ? `Uncheck ${habit.name} for ${when}`
                  : `Check in ${habit.name} for ${when}`,
              },
            }}
            onChange={(event) => onCheckIn({ date, count: event.target.checked ? 1 : null })}
          />
        </Box>
      </Box>
    );
  }

  // A weekly/monthly habit's progress is the server's period total; a daily
  // habit's is the selected day's own entry.
  const periodic = habit.frequency === 'weekly' || habit.frequency === 'monthly';
  const logged = periodic ? view.logged : habit.entries?.[date] ?? 0;
  const canDecrease = logged > 0 && !pending;
  const unit = view.unit ? ` ${view.unit}` : '';

  return (
    <Box
      component="span"
      className={className}
      data-checked={done ? 'true' : 'false'}
      sx={{ display: 'flex', flexShrink: 0, alignItems: 'center' }}
    >
      <IconButton
        size="small"
        // 32px of ink, a 44px target: the pseudo-element grows the hit area to
        // the HIG minimum without making the glyph look heavier.
        sx={{ '&::after': { position: 'absolute', inset: -6, content: '""' } }}
        disabled={!canDecrease}
        aria-label={`Remove one from ${habit.name} for ${when}`}
        onClick={() => onCheckIn({ date, delta: -1 })}
      >
        <RemoveIcon sx={{ fontSize: 18 }} />
      </IconButton>

      <Typography
        variant="body2"
        role="img"
        aria-label={`${logged} of ${view.target}${unit} for ${when}`}
        sx={{
          minWidth: 36,
          px: 0.5,
          textAlign: 'center',
          fontWeight: 600,
          lineHeight: 1,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {`${logged}/${view.target}`}
      </Typography>

      <IconButton
        size="small"
        // The plus is the affirmative half, so it carries a tinted surface the
        // minus does not.
        sx={{
          bgcolor: 'action.hover',
          color: 'primary.main',
          '&:hover': { bgcolor: 'action.selected' },
          '&::after': { position: 'absolute', inset: -6, content: '""' },
        }}
        disabled={pending}
        aria-label={`Add one to ${habit.name} for ${when}`}
        onClick={() => onCheckIn({ date, delta: 1 })}
      >
        <AddIcon sx={{ fontSize: 18 }} />
      </IconButton>
    </Box>
  );
}
