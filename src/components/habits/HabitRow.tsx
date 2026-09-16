'use client';

/**
 * One habit row — the quiet, tall line from the reference layout.
 *
 * Left to right: the check-in control, the habit's own coloured glyph, the name
 * (never truncated), and the streak number right-aligned with its tiny caption.
 * That is the whole row. The per-habit week strip and the percentage line used
 * to live here and were the main source of the clutter this screen had; the
 * week is now the page header's, and the completion rate is gone.
 *
 * Every number comes from the server payload — see `./period` for why the client
 * is not allowed to recompute a streak.
 *
 * The name is a button: a tap opens the editor, which is what retired the pencil
 * that used to sit next to it. A long press on the same button still lifts the
 * row for reordering (see `HabitList`): the row body is exempted from the
 * "press on a control belongs to the control" rule.
 */
import { GripVertical } from 'lucide-react';
import { accentVar } from '@/lib/colors';
import { cn } from '@/lib/cn';
import { CheckInControl } from './CheckInControl';
import { StreakCount } from './StreakCount';
import { habitIcon } from './icons';
import type { CheckInChange } from './period';
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

  return (
    <article
      aria-label={habit.name}
      onPointerDown={onRowPointerDown}
      className={cn(
        'group flex min-h-14 select-none items-center gap-2 px-3 py-2',
        habit.archived && 'opacity-70',
        dragging && 'opacity-60',
        className,
      )}
    >
      <CheckInControl habit={habit} date={date} today={today} pending={pending} onCheckIn={onCheckIn} />

      <button
        type="button"
        // Marks the one button a long press may still drag from, so tapping the
        // name opens the editor while holding it reorders the card.
        data-habit-body="true"
        onClick={onEdit}
        aria-label={`Edit ${habit.name}`}
        className="flex min-w-0 flex-1 items-center gap-2.5 rounded-ios text-left pressable"
      >
        <span className="flex size-5 shrink-0 items-center justify-center" style={{ color: accentVar(habit.color) }}>
          <Icon className="size-[18px]" aria-hidden />
        </span>
        <span className="min-w-0 text-body font-medium text-label">{habit.name}</span>
      </button>

      <StreakCount streak={habit.streak ?? 0} frequency={habit.frequency} longestStreak={habit.longestStreak} />

      {onGripPointerDown ? (
        <button
          type="button"
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
          className="hidden size-11 shrink-0 touch-none items-center justify-center rounded-ios text-tertiary opacity-0 pressable transition-opacity group-hover:opacity-100 focus-visible:opacity-100 lg:flex"
        >
          <GripVertical className="size-4" aria-hidden />
        </button>
      ) : null}
    </article>
  );
}
