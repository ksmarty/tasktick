'use client';

/**
 * The check-in control that leads a habit row.
 *
 * Two shapes, chosen by the habit's goal type, drawn at the same 32px scale so
 * the row geometry is identical for every habit:
 *
 *   - **boolean** — one shadcn `Checkbox`, styled back to the iOS task circle,
 *     that toggles between `{ count: 1 }` and `{ count: null }`. It is still a
 *     real checkbox: `role="checkbox"`, `aria-checked` and Space/Enter come from
 *     Radix. The circle is 32px of ink; the 44px touch target is grown by the
 *     `after:` pseudo-element rather than by the box, exactly as the stepper's
 *     two buttons do it, so the two shapes read at the same weight.
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
 * The satisfying bit is deliberately tiny: the tick pops each time the user
 * checks in, which is enough feedback without a layout-thrashing animation. The
 * pop used to be an Emotion keyframe, then a framer-motion scale on a wrapper
 * keyed by the flip. The key was the bug: keying on the state replayed the
 * animation on every mount, so opening the habits tab popped every habit on the
 * screen at once. It is now a one-shot scale started from the check handler —
 * the same keyframes, fired by the actual toggle instead of by a remount, so
 * first render and a date change animate nothing.
 */
import { motion, useAnimationControls } from 'framer-motion';
import { MinusIcon } from '@svg-animated-icons/react/minus';
import { PlusIcon } from '@svg-animated-icons/react/plus';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import { useReducedMotion } from '@/lib/motion';
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
  const reduceMotion = useReducedMotion();
  /*
   * The pop, driven imperatively.
   *
   * Not a `key` on the wrapper: a keyed element replays its `initial` animation
   * every time it mounts, and every habit's control mounts when the list first
   * paints — so entering the tab popped the whole list. Starting the keyframes
   * from `onCheckedChange` fires them on the one thing that should cause them,
   * the user's toggle, and on nothing else — not the first render, not a
   * re-render, not a change of the selected day.
   */
  const pop = useAnimationControls();
  const view = habitProgressView(habit, today);
  const done = habitDoneOn(habit, date, today);
  const when = date === today ? 'today' : longDateLabel(date);

  if (!view.counted) {
    return (
      <span
        className={cn('flex shrink-0 items-center', className)}
        data-checked={done ? 'true' : 'false'}
      >
        <motion.span
          className="inline-flex"
          initial={false}
          animate={pop}
        >
          <Checkbox
            checked={done}
            disabled={pending}
            aria-label={
              done
                ? `Uncheck ${habit.name} for ${when}`
                : `Check in ${habit.name} for ${when}`
            }
            // 16px of glyph inside a 32px circle. This is the app's
            // most-tapped control, so the pseudo-element grows the hit area to
            // the 44px HIG minimum without inflating the circle itself. The
            // stepper's two buttons use the same `after:-inset-1.5` (32 + 6 + 6
            // = 44px) so both shapes share one target size.
            className="relative size-8 rounded-full border-2 after:absolute after:-inset-1.5 after:content-[''] [&_svg]:size-4"
            onCheckedChange={(checked) => {
              if (!reduceMotion) {
                void pop.start({ scale: [0.82, 1.12, 1] }, { duration: 0.3, ease: 'easeOut' });
              }
              onCheckIn({ date, count: checked === true ? 1 : null });
            }}
          />
        </motion.span>
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
    <span
      className={cn('flex shrink-0 items-center gap-1', className)}
      data-checked={done ? 'true' : 'false'}
    >
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        // 32px of ink, a 44px target: the pseudo-element grows the hit area to
        // the HIG minimum without making the glyph look heavier.
        className="relative after:absolute after:-inset-1.5 after:content-['']"
        disabled={!canDecrease}
        aria-label={`Remove one from ${habit.name} for ${when}`}
        onClick={() => onCheckIn({ date, delta: -1 })}
      >
        <MinusIcon />
      </Button>

      <span
        role="img"
        aria-label={`${logged} of ${view.target}${unit} for ${when}`}
        className="min-w-9 px-0.5 text-center text-sm font-semibold leading-none tabular-nums"
      >
        {`${logged}/${view.target}`}
      </span>

      <Button
        type="button"
        // The plus is the affirmative half, so it carries a tinted surface the
        // minus does not.
        className="relative bg-secondary text-primary after:absolute after:-inset-1.5 after:content-[''] hover:bg-accent"
        size="icon-sm"
        disabled={pending}
        aria-label={`Add one to ${habit.name} for ${when}`}
        onClick={() => onCheckIn({ date, delta: 1 })}
      >
        <PlusIcon />
      </Button>
    </span>
  );
}
