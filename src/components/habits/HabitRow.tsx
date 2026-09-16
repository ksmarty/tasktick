'use client';

/**
 * One habit card.
 *
 * Reading order, left to right: the check-in control you tap, the identity
 * (icon, name, streak), then this week's strip and the window's completion
 * rate. Every number on it comes from the server payload — see `./period` for
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
import { completionLabel, frequencySummary, goalSummary, habitProgressView, reminderLabel } from './period';
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
  pending?: boolean;
  dragging?: boolean;
  /** Enables the reorder handle (pointer drag + arrow keys). */
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

  return (
    <article
      aria-label={`${habit.name}, ${habit.doneToday ? 'done today' : 'not done today'}`}
      className={cn(
        'grouped mx-4 mb-3 px-4 py-3 shadow-ios-sm transition-opacity',
        habit.archived && 'opacity-70',
        dragging && 'opacity-60',
        className,
      )}
    >
      <div className="flex items-start gap-3">
        <CheckInControl habit={habit} today={today} pending={pending} onCheckIn={onCheckIn} className="pt-0.5" />

        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <span
              className="flex size-6 shrink-0 items-center justify-center rounded-full"
              style={{ backgroundColor: accentSoft(habit.color, 0.18, resolvedTheme === 'dark'), color: accentVar(habit.color) }}
              role="img"
              aria-label={habitIconLabel(habit.icon)}
            >
              <Icon className="size-3.5" aria-hidden />
            </span>
            <h3 className="min-w-0 truncate text-body font-medium text-label">{habit.name}</h3>
            <StreakBadge streak={habit.streak ?? 0} frequency={habit.frequency} longestStreak={habit.longestStreak} />
            {habit.archived ? (
              <span className="shrink-0 rounded-full bg-fill-tertiary px-2 py-0.5 text-caption-1 text-secondary">
                Archived
              </span>
            ) : null}
          </div>

          <p className="mt-0.5 truncate text-footnote text-secondary">
            {goalSummary(habit)} · {frequencySummary(habit)}
          </p>

          {reminder ? (
            <p className="mt-0.5 flex items-center gap-1 text-caption-1 text-tertiary">
              <AlarmClock className="size-3 shrink-0" aria-hidden />
              <span className="tnum">{reminder}</span>
            </p>
          ) : null}

          <HabitCalendarStrip habit={habit} today={today} weekStartsOn={weekStartsOn} className="mt-2" />

          {periodic ? (
            <ProgressBar
              className="mt-2"
              size="sm"
              value={view.fraction}
              color={habit.doneToday ? 'success' : 'tint'}
              label={`${habit.name} progress ${view.periodNoun}`}
            >
              {view.periodNoun}
            </ProgressBar>
          ) : null}

          <p className="mt-1.5 text-caption-1 text-tertiary">{completionLabel(habit.completionRate, windowLabel)}</p>
        </div>

        <div className="flex shrink-0 flex-col items-center gap-1">
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
              className="flex size-9 touch-none items-center justify-center rounded-ios text-tertiary pressable"
            >
              <GripVertical className="size-4" aria-hidden />
            </button>
          ) : null}

          <IconButton
            icon={Pencil}
            size="sm"
            variant="plain"
            aria-label={`Edit ${habit.name}`}
            onClick={onEdit}
          />
        </div>
      </div>
    </article>
  );
}
