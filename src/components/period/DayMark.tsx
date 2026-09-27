'use client';

/**
 * The cycle marks the month paints, and their legend.
 *
 * ## The seam
 *
 * `MonthGrid` exposes one hook for a per-day mark — `renderDayMarker(date)`,
 * painted in a 36×36 `pointer-events-none` box centred on the day disc and above
 * it (`z-20`), with `dayMarkerInset` available to shrink the today/selected fill
 * so a mark reads as a mark *around* the number. That is the seam the habits
 * month uses for its ring, and this is the same seam rather than a second month
 * grid: a period month is a month, and two lattices would drift.
 *
 * ## Why these shapes
 *
 * Four states have to be told apart on a monochrome surface, without covering the
 * date — the day number is the control, and a filled mark over it would hide the
 * one thing the grid is for. So every mark is an outline, a halo or a dot in the
 * lane under the digits:
 *
 *  · **period** — a solid ring, the strongest mark, because it is observed data.
 *  · **predicted period** — the same ring, dashed and lighter: the same promise,
 *    without the certainty.
 *  · **fertile window** — a translucent filled disc *behind* the ring (it is the
 *    first child, and the ring paints over it). It reads as a field rather than a
 *    boundary, which is what a window is.
 *  · **ovulation** — a small filled dot in the lane under the number, where the
 *    calendar's item dot lives. Those two can never collide here: this screen
 *    paints no items at all (see `PeriodCalendarScreen`), so the lane is free.
 *
 * The halo is `bg-primary/10` rather than a colour because the palette is
 * monochrome — Celestial Sapphire says "this day is in a window" with contrast
 * and fill, not hue.
 */
import { cn } from '@/lib/utils';
import { hasMarks, MARK_LEGEND, type DayMarks } from './markers';

export interface PeriodDayMarkerProps {
  marks: DayMarks;
}

/**
 * The mark for one day.
 *
 * Renders nothing for a day with no marks — `MonthGrid` calls it for every cell
 * of all three panels, so the empty case is the common one and must cost no DOM.
 */
export function PeriodDayMarker({ marks }: PeriodDayMarkerProps) {
  if (!hasMarks(marks)) return null;

  return (
    <>
      {/* The field first, so the rings above it read as boundaries inside it. */}
      {marks.fertile ? <span className="absolute inset-0 rounded-full bg-primary/10" /> : null}
      {marks.predicted ? (
        <span className="absolute inset-0 rounded-full border-2 border-dashed border-primary/60" />
      ) : null}
      {marks.period ? <span className="absolute inset-0 rounded-full border-2 border-primary" /> : null}
      {marks.ovulation ? (
        <span className="absolute bottom-0 left-1/2 size-1.5 -translate-x-1/2 rounded-full bg-primary" />
      ) : null}
    </>
  );
}

export interface PeriodLegendProps {
  className?: string;
}

/**
 * What the marks mean, in words.
 *
 * Not decoration and not optional: four abstract marks on days that are often
 * months away from the data that produced them are unreadable without a key, and
 * the difference between a ring and a dashed ring carries the entire distinction
 * between "this happened" and "this is expected". It is the same four words the
 * day buttons announce (`markWords`), so the two cannot drift.
 */
export function PeriodLegend({ className }: PeriodLegendProps) {
  return (
    <ul className={cn('flex flex-wrap items-center gap-x-3 gap-y-1', className)}>
      {MARK_LEGEND.map((item) => (
        <li key={item.key} className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span aria-hidden className="relative flex size-4 shrink-0 items-center justify-center">
            <LegendMark kind={item.key} />
          </span>
          <span>{item.label}</span>
        </li>
      ))}
    </ul>
  );
}

/** The miniature of each mark, drawn at 16px so it lines up with the caption. */
function LegendMark({ kind }: { kind: keyof DayMarks }) {
  switch (kind) {
    case 'period':
      return <span className="absolute inset-0 rounded-full border-2 border-primary" />;
    case 'predicted':
      return <span className="absolute inset-0 rounded-full border-2 border-dashed border-primary/60" />;
    case 'fertile':
      return <span className="absolute inset-0 rounded-full bg-primary/10 ring-1 ring-primary/20" />;
    case 'ovulation':
      return <span className="absolute bottom-0 left-1/2 size-1.5 -translate-x-1/2 rounded-full bg-primary" />;
    default:
      return null;
  }
}
