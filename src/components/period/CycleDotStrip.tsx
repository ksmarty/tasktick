'use client';

/**
 * The dot strip: one dot per day of a cycle.
 *
 * ## The shape, and why it is monochrome
 *
 * The reference app paints period days pink and fertile days teal. This app has
 * one palette — Celestial Sapphire, which is deliberately monochrome — so the two
 * are told apart by *fill* instead of hue: a recorded period day is solid
 * `bg-primary`, a day in the fertile estimate is `bg-primary/40`, and every other
 * day is `bg-muted`. That is a visible difference at 6px, it follows the accent
 * preference like the rest of the app, and it adds no colour token.
 *
 * ## The geometry is fixed, and it fits
 *
 * One dot is {@link STRIP_DOT_PX}px and the gap is {@link STRIP_GAP_PX}px. At
 * 390px the strip's row is 326px wide (390 − 2×16px gutter − 2×16px row padding),
 * which fits `STRIP_MAX_DAYS` (41) dots exactly: `41×6 + 40×2 = 326`. A cycle
 * longer than that draws the first 41 days and states the rest in words rather
 * than wrapping or shrinking every dot to something unreadable. The arithmetic is
 * asserted in `tests/period-insights-math.test.ts` and measured by the probe.
 *
 * Fixed dots also mean a 28-day cycle's strip is visibly shorter than a 37-day
 * one's, which is the length stated twice — once as a number, once as a width.
 *
 * ## The dots are not the accessible content
 *
 * A row of coloured dots says nothing to a screen reader, so the wrapper is
 * `role="img"` with an accessible name that states the cycle, its length and the
 * day ranges (`describeStrip` compresses `1, 2, 3, 4, 5` to `1–5`), and every dot
 * is `aria-hidden`. The key below the strip is the same three marks in words, for
 * anyone who can see the dots but not tell what they mean.
 */
import { InfoCircledIcon } from '@svg-animated-icons/react/info-circled';
import { cn } from '@/lib/utils';
import {
  STRIP_DOT_PX,
  STRIP_GAP_PX,
  STRIP_MAX_DAYS,
  stripAccessibleName,
  type CycleStripDay,
} from '@/lib/period-insights';
import type { DateOnly } from '@/lib/types';

export interface CycleDotStripProps {
  /** The cycle's first day, used in the accessible name. */
  startDate: DateOnly;
  /** Every day of the cycle, oldest first — `cycleStripDays`'s output. */
  days: CycleStripDay[];
  className?: string;
}

export function CycleDotStrip({ startDate, days, className }: CycleDotStripProps) {
  const drawn = days.slice(0, STRIP_MAX_DAYS);
  const hidden = days.length - drawn.length;
  const name =
    stripAccessibleName(startDate, days) +
    (hidden > 0 ? ` The first ${STRIP_MAX_DAYS} days are drawn.` : '');

  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <div
        role="img"
        aria-label={name}
        /*
         * `flex-nowrap` is the contract: the strip must never wrap onto a second
         * line, because a wrapped strip is a strip whose days no longer read as a
         * sequence. The geometry above is what makes that true at 390px.
         */
        className="inline-flex flex-nowrap items-center"
        style={{ gap: `${STRIP_GAP_PX}px` }}
      >
        {drawn.map((day) => (
          <span
            key={day.date}
            aria-hidden
            className={cn(
              'shrink-0 rounded-full',
              day.period ? 'bg-primary' : day.fertile ? 'bg-primary/40' : 'bg-muted',
            )}
            style={{ width: `${STRIP_DOT_PX}px`, height: `${STRIP_DOT_PX}px` }}
          />
        ))}
      </div>
      {hidden > 0 ? (
        <p className="text-xs text-muted-foreground">
          +{hidden} more {hidden === 1 ? 'day' : 'days'} not drawn
        </p>
      ) : null}
    </div>
  );
}

/** One mark in {@link CycleStripKey}, drawn at the strip's own dot size. */
function KeyDot({ className }: { className: string }) {
  return (
    <span
      aria-hidden
      className={cn('shrink-0 rounded-full', className)}
      style={{ width: `${STRIP_DOT_PX}px`, height: `${STRIP_DOT_PX}px` }}
    />
  );
}

/**
 * What the dots mean, in the strip's own marks.
 *
 * Three states have to be told apart and none of them is a colour, so the key is
 * not decoration — without it "a lighter dot" is a guess. It is rendered once per
 * card rather than once per cycle.
 */
export function CycleStripKey({ className }: { className?: string }) {
  return (
    <ul className={cn('flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground', className)}>
      <li className="flex items-center gap-1.5">
        <KeyDot className="bg-primary" />
        Period day
      </li>
      <li className="flex items-center gap-1.5">
        <KeyDot className="bg-primary/40" />
        Fertile estimate
      </li>
      <li className="flex items-center gap-1.5">
        <KeyDot className="bg-muted" />
        Unmarked
      </li>
    </ul>
  );
}

/**
 * The one-line caveat that belongs with the fertile mark.
 *
 * The prediction sends a fertile window for the *current* cycle only, and this
 * module will not derive one for a cycle that has already ended — the client never
 * re-runs cycle maths. So the mark appears on the current cycle's strip and
 * nowhere else, and saying so is what stops "no lighter dots" reading as "no
 * fertile window".
 */
export function CycleStripNote({ className }: { className?: string }) {
  return (
    <p className={cn('flex gap-2 text-xs leading-relaxed text-muted-foreground', className)}>
      <InfoCircledIcon className="mt-0.5 size-4 shrink-0" />
      <span>The fertile estimate is drawn on the current cycle only; it is not stored for a cycle that has ended.</span>
    </p>
  );
}
