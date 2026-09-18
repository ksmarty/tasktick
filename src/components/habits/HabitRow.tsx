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
 * name: a slim shadcn `Progress` of the server's own period `progress`, with the
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
 *
 * The habit's own colour is the one thing a class cannot carry — an accent name
 * is stored per habit and the palette lives in JS (`@/lib/colors`) — so it is the
 * single inline style on the row, exactly as the MUI version had it.
 */
import { DragHandleDots1Icon } from '@svg-animated-icons/react/drag-handle-dots-1';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
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
    <div
      role="listitem"
      aria-label={habit.name}
      onPointerDown={onRowPointerDown}
      className={cn(
        'group/row flex min-h-14 flex-col justify-center px-row py-2 select-none',
        habit.archived && 'opacity-70',
        dragging && 'opacity-60',
        className,
      )}
    >
      <div className="flex min-h-10 items-center gap-2">
        <CheckInControl habit={habit} date={date} today={today} pending={pending} onCheckIn={onCheckIn} />

        <button
          type="button"
          // Marks the one button a long press may still drag from, so tapping the
          // name opens the editor while holding it reorders the card.
          data-habit-body="true"
          onClick={onEdit}
          aria-label={`Edit ${habit.name}`}
          className="flex min-w-0 flex-1 items-center gap-3 rounded-md p-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span
            aria-hidden
            className="flex size-5 shrink-0 items-center justify-center [&_svg]:size-5"
            style={{ color: accentHex(habit.color) }}
          >
            <Icon />
          </span>
          <span className="min-w-0 text-base font-medium">{habit.name}</span>
        </button>

        <StreakCount streak={habit.streak ?? 0} frequency={habit.frequency} longestStreak={habit.longestStreak} />

        {onGripPointerDown ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
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
            className="hidden shrink-0 touch-none text-muted-foreground opacity-0 transition-opacity group-hover/row:opacity-100 focus-visible:opacity-100 lg:inline-flex"
          >
            <DragHandleDots1Icon />
          </Button>
        ) : null}
      </div>

      {counted ? (
        <div className="mt-1 flex min-w-0 items-center gap-2 pl-1">
          <Progress
            value={Math.round(view.fraction * 100)}
            aria-label={`${view.logged} of ${view.target}${unit} ${view.periodNoun}`}
            className="h-1 flex-1"
          />
          <span className="max-w-[60%] min-w-0 shrink truncate text-xs text-muted-foreground">
            {habitMetaSummary(habit)}
          </span>
        </div>
      ) : null}
    </div>
  );
}
