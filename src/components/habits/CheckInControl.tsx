'use client';

/**
 * The check-in control that sits on the leading edge of a habit card.
 *
 * Two shapes, chosen by the habit's goal type:
 *
 *   - **boolean** — one circular checkbox, exactly the iOS task circle, that
 *     toggles between `{ count: 1 }` and `{ count: null }`.
 *   - **count / duration** — the current progress (`3/8 glasses`) with `−` and
 *     `+` buttons that send `delta: -1` / `delta: 1`, so the server increments
 *     the stored amount instead of the client guessing it.
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
      <span className={cn('flex items-center', className)} data-checked={habit.doneToday ? 'true' : 'false'}>
        {/* Remounting on the flip replays the pop, which is the whole animation. */}
        <span key={habit.doneToday ? 'checked' : 'open'} className="animate-pop inline-flex">
          <Checkbox
            checked={Boolean(habit.doneToday)}
            disabled={pending}
            aria-label={habit.doneToday ? `Uncheck ${habit.name} for today` : `Check in ${habit.name} for today`}
            onCheckedChange={(next) => onCheckIn({ count: next ? 1 : null })}
          />
        </span>
      </span>
    );
  }

  const canDecrease = view.logged > 0 && !pending;

  return (
    <span className={cn('flex items-center gap-1', className)} data-checked={habit.doneToday ? 'true' : 'false'}>
      <IconButton
        icon={Minus}
        size="md"
        variant="tinted"
        disabled={!canDecrease}
        aria-label={`Remove one from ${habit.name} today`}
        onClick={() => onCheckIn({ delta: -1 })}
      />

      <span
        className="tnum flex min-w-11 flex-col items-center leading-none"
        aria-label={`${habit.name}: ${view.logged} of ${view.target}${view.unit ? ` ${view.unit}` : ''} ${view.periodNoun}`}
      >
        <span className={cn('text-subhead font-semibold', habit.doneToday ? 'text-success' : 'text-label')}>
          {view.logged}/{view.target}
        </span>
        {view.unit ? <span className="mt-0.5 text-caption-2 text-secondary">{view.unit}</span> : null}
      </span>

      <IconButton
        icon={Plus}
        size="md"
        variant={habit.doneToday ? 'tinted' : 'filled'}
        disabled={pending}
        aria-label={`Add one to ${habit.name} today`}
        onClick={() => onCheckIn({ delta: 1 })}
      />
    </span>
  );
}
