'use client';

/**
 * One habit row — the quiet, tall line from the reference layout.
 *
 * Left to right: the check-in control, the habit's own coloured glyph, the name
 * (never truncated), and the streak number right-aligned with its tiny caption.
 * That is the whole row. The per-habit week strip used to live here and was the
 * main source of the clutter this screen had; the week is now the page header's.
 *
 * A counted habit (`count` / `duration`) adds one quiet second line under its
 * name: a slim `LinearProgress` of the server's own period `progress`, with the
 * goal and schedule beside it. The bar is drawn *beside* the name's button
 * rather than inside it, so a screen reader still hears "Edit Drink water" on
 * the button and the progress as its own labelled element.
 *
 * Every number comes from the server payload — see `./period` for why the client
 * is not allowed to recompute a streak.
 *
 * The name is a button: a tap opens the editor, which is what retired the pencil
 * that used to sit next to it. A long press on the same button still lifts the
 * row for reordering (see `HabitList`): the row body is exempted from the
 * "press on a control belongs to the control" rule.
 */
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import LinearProgress from '@mui/material/LinearProgress';
import ListItem from '@mui/material/ListItem';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import DragIndicatorIcon from '@mui/icons-material/DragIndicator';
import { accentHex } from '@/lib/colors';
import { CheckInControl } from './CheckInControl';
import { StreakCount } from './StreakCount';
import { habitIcon } from './icons';
import { habitMetaSummary, habitProgressView, type CheckInChange } from './period';
import type { DateOnly, Habit } from '@/lib/types';
import type { PointerEvent as ReactPointerEvent } from 'react';

export interface HabitRowProps {
  habit: Habit;
  /** The day the row checks in for — the page's selected day. */
  date: DateOnly;
  /** Today, in the user's timezone. */
  today: DateOnly;
  onCheckIn: (change: CheckInChange) => void;
  onEdit: () => void;
  /** True while this habit's check-in is in flight. */
  pending?: boolean;
  dragging?: boolean;
  /**
   * Arms a long-press reorder when the finger lands on the row body (not on the
   * stepper). This is the touch affordance; the grip below is the pointer one.
   */
  onRowPointerDown?: (event: ReactPointerEvent<HTMLElement>) => void;
  /** Enables the desktop reorder handle (pointer drag + arrow keys). */
  onGripPointerDown?: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onMoveBy?: (delta: -1 | 1) => void;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
  className?: string;
}

export function HabitRow({
  habit,
  date,
  today,
  onCheckIn,
  onEdit,
  pending = false,
  dragging = false,
  onRowPointerDown,
  onGripPointerDown,
  onMoveBy,
  canMoveUp = false,
  canMoveDown = false,
  className,
}: HabitRowProps) {
  const Icon = habitIcon(habit.icon);
  const view = habitProgressView(habit, today);
  const unit = view.unit ? ` ${view.unit}` : '';
  const counted = view.counted;

  return (
    <ListItem
      disablePadding
      aria-label={habit.name}
      onPointerDown={onRowPointerDown}
      className={className}
      sx={{
        display: 'block',
        px: 1.5,
        py: counted ? 0.75 : 1,
        minHeight: 56,
        userSelect: 'none',
        ...(habit.archived ? { opacity: 0.7 } : null),
        ...(dragging ? { opacity: 0.6 } : null),
      }}
    >
      <Stack direction="row" sx={{ alignItems: 'center', gap: 0.5, minHeight: 40 }}>
        <CheckInControl habit={habit} date={date} today={today} pending={pending} onCheckIn={onCheckIn} />

        <Box
          component="button"
          type="button"
          // Marks the one button a long press may still drag from, so tapping the
          // name opens the editor while holding it reorders the card.
          data-habit-body="true"
          onClick={onEdit}
          aria-label={`Edit ${habit.name}`}
          sx={{
            display: 'flex',
            minWidth: 0,
            flex: 1,
            alignItems: 'center',
            gap: 1.25,
            p: 0.5,
            m: 0,
            border: 0,
            borderRadius: 1,
            bgcolor: 'transparent',
            color: 'inherit',
            font: 'inherit',
            textAlign: 'left',
            cursor: 'pointer',
            '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 2 },
          }}
        >
          <Box
            aria-hidden
            sx={{
              display: 'flex',
              width: 20,
              height: 20,
              flexShrink: 0,
              alignItems: 'center',
              justifyContent: 'center',
              color: accentHex(habit.color),
            }}
          >
            <Icon sx={{ fontSize: 18 }} />
          </Box>
          <Typography variant="body1" sx={{ minWidth: 0, fontWeight: 500 }}>
            {habit.name}
          </Typography>
        </Box>

        <StreakCount streak={habit.streak ?? 0} frequency={habit.frequency} longestStreak={habit.longestStreak} />

        {onGripPointerDown ? (
          <IconButton
            aria-label={`Reorder ${habit.name}`}
            aria-roledescription="sortable"
            onPointerDown={onGripPointerDown}
            onKeyDown={(event) => {
              if (event.key === 'ArrowUp' && canMoveUp) {
                event.preventDefault();
                onMoveBy?.(-1);
              }
              if (event.key === 'ArrowDown' && canMoveDown) {
                event.preventDefault();
                onMoveBy?.(1);
              }
            }}
            // Pointer devices only: it fades in on hover or keyboard focus, so a
            // touch screen never pays for a grip it cannot use.
            sx={{
              display: { xs: 'none', lg: 'inline-flex' },
              flexShrink: 0,
              touchAction: 'none',
              color: 'text.secondary',
              opacity: 0,
              transition: 'opacity 150ms',
              '.MuiListItem-root:hover &': { opacity: 1 },
              '&:focus-visible': { opacity: 1 },
            }}
          >
            <DragIndicatorIcon sx={{ fontSize: 18 }} />
          </IconButton>
        ) : null}
      </Stack>

      {counted ? (
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mt: 0.25, pl: 0.5, minWidth: 0 }}>
          <LinearProgress
            variant="determinate"
            value={Math.round(view.fraction * 100)}
            aria-label={`${view.logged} of ${view.target}${unit} ${view.periodNoun}`}
            sx={{ flex: 1, height: 4, borderRadius: 2 }}
          />
          <Typography variant="caption" color="text.secondary" noWrap sx={{ flexShrink: 1, minWidth: 0, maxWidth: '60%' }}>
            {habitMetaSummary(habit)}
          </Typography>
        </Stack>
      ) : null}
    </ListItem>
  );
}
