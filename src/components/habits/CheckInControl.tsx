'use client';

/**
 * The check-in control that leads a habit row.
 *
 * Two shapes, chosen by the habit's goal type, in one 44px-tall box so the row
 * geometry is identical for every habit:
 *
 *   - **boolean** — one circular checkbox, exactly the iOS task circle, that
 *     toggles between `{ count: 1 }` and `{ count: null }`.
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
 * The satisfying bit is deliberately tiny: the tick pops (`animate-pop`) each
 * time the habit becomes done, which is enough feedback without a confetti
 * library or a layout-thrashing animation.
 */
import { Minus, Plus } from 'lucide-react';
import { Checkbox, IconButton } from '@/components/ui';
import { cn } from '@/lib/cn';
import { habitDoneOn, habitProgressView, longDateLabel, type CheckInChange } from './period';
import type { DateOnly, Habit } from '@/lib/types';

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
      <span className={cn('flex shrink-0 items-center', className)} data-checked={done ? 'true' : 'false'}>
        {/* Remounting on the flip replays the pop, which is the whole animation. */}
        <span key={done ? 'checked' : 'open'} className="animate-pop inline-flex">
          <Checkbox
            checked={done}
            disabled={pending}
            size="md"
            className="size-11 justify-center"
            aria-label={done ? `Uncheck ${habit.name} for ${when}` : `Check in ${habit.name} for ${when}`}
            onCheckedChange={(next) => onCheckIn({ date, count: next ? 1 : null })}
          />
        </span>
      </span>
    );
  }

  // A weekly/monthly habit's progress is the server's period total; a daily
  // habit's is the selected day's own entry.
  const periodic = habit.frequency === 'weekly' || habit.frequency === 'monthly';
  const logged = periodic ? view.logged : habit.entries?.[date] ?? 0;
  const canDecrease = logged > 0 && !pending;
  const unit = view.unit ? ` ${view.unit}` : '';

  return (
    <span className={cn('flex shrink-0 items-center', className)} data-checked={done ? 'true' : 'false'}>
      <IconButton
        icon={Minus}
        size="sm"
        variant="plain"
        iconClassName="size-4"
        // 32px of ink, a 44px target: the pseudo-element grows the hit area to
        // the HIG minimum without making the glyph look heavier.
        className="relative before:absolute before:-inset-1.5 before:content-['']"
        disabled={!canDecrease}
        aria-label={`Remove one from ${habit.name} for ${when}`}
        onClick={() => onCheckIn({ date, delta: -1 })}
      />

      <span
        role="img"
        aria-label={`${logged} of ${view.target}${unit} for ${when}`}
        className="tnum min-w-9 px-1 text-center text-footnote font-semibold leading-none text-label"
      >
        {`${logged}/${view.target}`}
      </span>

      <IconButton
        icon={Plus}
        size="sm"
        variant="tinted"
        iconClassName="size-4"
        className="relative before:absolute before:-inset-1.5 before:content-['']"
        disabled={pending}
        aria-label={`Add one to ${habit.name} for ${when}`}
        onClick={() => onCheckIn({ date, delta: 1 })}
      />
    </span>
  );
}
