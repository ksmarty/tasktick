'use client';

/**
 * One habit card — the same row for every goal type.
 *
 * The row is two lines, and the split is the important part:
 *
 *   1. the check-in control and the name on its own line — the name is the only
 *      flexible thing there, so it is never squeezed into an ellipsis;
 *   2. the icon, the goal and cadence, the streak and the one action affordance
 *      (edit), then the week strip, and — only when the period spans days — the
 *      period progress bar.
 *
 * A counted habit's stepper is the widest thing on line 1, so nothing else may
 * compete with the name there: the streak chip, the action and the icon badge
 * live on line 2, where they have a whole card width behind them. That is what
 * stopped the name from being cut down to its first letter.
 *
 * Every number on the card comes from the server payload — see `./period` for
 * why the client is not allowed to recompute a streak.
 */
import { AlarmClock, GripVertical, Pencil } from 'lucide-react';
import { IconButton, ProgressBar } from '@/components/ui';
import { accentSoft, accentVar } from '@/lib/colors';
import { cn } from '@/lib/cn';
import { useAppearance } from '@/app/providers';
import { CheckInControl } from './CheckInControl';
import { HabitCalendarStrip } from './HabitCalendarStrip';
import { StreakBadge } from './StreakBadge';
import { habitIcon, habitIconLabel } from './icons';
import { completionLabel, habitMetaSummary, habitProgressView, reminderLabel } from './period';
import type { DateOnly, Habit } from '@/lib/types';
import type { PointerEvent as ReactPointerEvent } from 'react';

export interface HabitRowProps {
  habit: Habit;
  today: DateOnly;
  weekStartsOn: number;
  /** Human name of the window the completion rate covers, e.g. `This week`. */
  windowLabel: string;
  timeFormat: '12h' | '24h';
  onCheckIn: (change: { count?: number | null; delta?: number }) => void;
  onEdit: () => void;
  /** True while this habit's check-in is in flight. */
  pending?: boolean;
  dragging?: boolean;
  /**
   * Arms a long-press reorder when the finger lands on the card body (not on a
   * control). This is the touch affordance; the grip below is the pointer one.
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
  today,
  weekStartsOn,
  windowLabel,
  timeFormat,
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
  const { resolvedTheme } = useAppearance();
  const Icon = habitIcon(habit.icon);
  const view = habitProgressView(habit, today);
  const reminder = reminderLabel(habit, { zone: 'utc', timeFormat, weekStartsOn });
  const periodic = habit.frequency === 'weekly' || habit.frequency === 'monthly';
  // "Nothing completed this week" says nothing a zero-height bar would not; the
  // line is only worth its space once there is a percentage to report.
  const completion =
    typeof habit.completionRate === 'number' && habit.completionRate > 0
      ? completionLabel(habit.completionRate, windowLabel)
      : null;

  return (
    <article
      aria-label={`${habit.name}, ${habit.doneToday ? 'done today' : 'not done today'}`}
      onPointerDown={onRowPointerDown}
      className={cn(
        'group glass-card mx-4 mb-3 select-none rounded-ios-lg px-3.5 py-3 transition-opacity',
        habit.archived && 'opacity-70',
        dragging && 'opacity-60',
        className,
      )}
    >
      {/* Line 1 — the check-in control, then the name on its own line. */}
      <div className="flex min-h-11 items-center gap-2.5">
        <CheckInControl habit={habit} today={today} pending={pending} onCheckIn={onCheckIn} />

        <h3 className="min-w-0 flex-1 text-body font-medium text-label">{habit.name}</h3>
      </div>

      {/* Line 2 — identity, goal · cadence, streak, and the one action. */}
      <div className="mt-1 flex min-h-9 items-center gap-2">
        <span
          className="flex size-5 shrink-0 items-center justify-center rounded-full"
          style={{
            backgroundColor: accentSoft(habit.color, 0.18, resolvedTheme === 'dark'),
            color: accentVar(habit.color),
          }}
          role="img"
          aria-label={habitIconLabel(habit.icon)}
        >
          <Icon className="size-3" aria-hidden />
        </span>

        <p className="min-w-0 flex-1 text-footnote text-secondary">
          {habitMetaSummary(habit)}
          {habit.archived ? ' · Archived' : ''}
        </p>

        <StreakBadge streak={habit.streak ?? 0} frequency={habit.frequency} longestStreak={habit.longestStreak} />

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

        <IconButton
          icon={Pencil}
          size="sm"
          variant="plain"
          iconClassName="size-4"
          // 36px of ink, a 44px target: the pseudo-element grows the hit area to
          // the HIG minimum without making the glyph look heavier.
          className="relative before:absolute before:-inset-1 before:content-['']"
          aria-label={`Edit ${habit.name}`}
          onClick={onEdit}
        />
      </div>

      {reminder ? (
        <p className="mt-1 flex items-center gap-1 text-caption-1 text-tertiary">
          <AlarmClock className="size-3 shrink-0" aria-hidden />
          <span className="tnum">{reminder}</span>
        </p>
      ) : null}

      <HabitCalendarStrip habit={habit} today={today} weekStartsOn={weekStartsOn} className="mt-2.5" />

      {periodic ? (
        <ProgressBar
          className="mt-2.5"
          size="sm"
          value={view.fraction}
          color={habit.doneToday ? 'success' : 'tint'}
          label={`${habit.name} progress ${view.periodNoun}`}
        >
          {`${view.logged}/${view.target} ${view.periodNoun}`}
        </ProgressBar>
      ) : null}

      {completion ? (
        <p className="mt-2 whitespace-nowrap text-caption-1 text-tertiary">{completion}</p>
      ) : null}
    </article>
  );
}
