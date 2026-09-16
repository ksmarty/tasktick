'use client';

/**
 * The check-in control that sits on the leading edge of a habit card.
 *
 * Two shapes, chosen by the habit's goal type, in one 44px-tall box so the row
 * geometry is identical for every habit:
 *
 *   - **boolean** — one circular checkbox, exactly the iOS task circle, that
 *     toggles between `{ count: 1 }` and `{ count: null }`.
 *   - **count / duration** — `[−] 3/8 glasses [+]`: the amount the server holds
 *     for the period, with `−` and `+` sending `delta: -1` / `delta: 1` so the
 *     server increments the stored amount instead of the client guessing it.
 *
 * Both buttons are full 44×44 targets; the glyph inside is smaller than the
 * button, so the control stays visually compact without shrinking the hit area.
 *
 * The satisfying bit is deliberately tiny: the tick pops (`animate-pop`) each
 * time the habit becomes done, which is enough feedback without a confetti
 * library or a layout-thrashing animation.
 */
import { Minus, Plus } from 'lucide-react';
import { Checkbox, IconButton } from '@/components/ui';
import { cn } from '@/lib/cn';
import { habitProgressView, type CheckInChange } from './period';
import type { DateOnly, Habit } from '@/lib/types';

export interface CheckInControlProps {
  habit: Habit;
  /** Today, in the user's timezone. */
  today: DateOnly;
  onCheckIn: (change: Omit<CheckInChange, 'date'>) => void;
  /** Disables the controls while a write is in flight. */
  pending?: boolean;
  className?: string;
}

export function CheckInControl({ habit, today, onCheckIn, pending = false, className }: CheckInControlProps) {
  const view = habitProgressView(habit, today);

  if (!view.counted) {
    return (
      <span className={cn('flex shrink-0 items-center', className)} data-checked={habit.doneToday ? 'true' : 'false'}>
        {/* Remounting on the flip replays the pop, which is the whole animation. */}
        <span key={habit.doneToday ? 'checked' : 'open'} className="animate-pop inline-flex">
          <Checkbox
            checked={Boolean(habit.doneToday)}
            disabled={pending}
            size="md"
            className="size-11 justify-center"
            aria-label={habit.doneToday ? `Uncheck ${habit.name} for today` : `Check in ${habit.name} for today`}
            onCheckedChange={(next) => onCheckIn({ count: next ? 1 : null })}
          />
        </span>
      </span>
    );
  }

  const canDecrease = view.logged > 0 && !pending;
  const amount = `${view.logged} of ${view.target}${view.unit ? ` ${view.unit}` : ''}`;

  return (
    <span className={cn('flex shrink-0 items-center', className)} data-checked={habit.doneToday ? 'true' : 'false'}>
      <IconButton
        icon={Minus}
        size="md"
        variant="tinted"
        iconClassName="size-4"
        disabled={!canDecrease}
        aria-label={`Remove one from ${habit.name} today`}
        onClick={() => onCheckIn({ delta: -1 })}
      />

      <span
        role="img"
        aria-label={`${amount} ${view.periodNoun}`}
        className={cn(
          'tnum min-w-16 px-1 text-center text-footnote font-semibold leading-none',
          habit.doneToday ? 'text-success' : 'text-label',
        )}
      >
        {view.label}
      </span>

      <IconButton
        icon={Plus}
        size="md"
        variant={habit.doneToday ? 'tinted' : 'filled'}
        iconClassName="size-4"
        disabled={pending}
        aria-label={`Add one to ${habit.name} today`}
        onClick={() => onCheckIn({ delta: 1 })}
      />
    </span>
  );
}
