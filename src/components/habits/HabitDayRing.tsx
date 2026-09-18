'use client';

/**
 * The habits month's completion ring: one arc per habit completed that day.
 *
 * ## What it says
 *
 * A day with nothing completed has **no ring at all** — absence is the quiet
 * state, not an empty circle, because an empty circle is a mark and a day the
 * user did nothing is not worth a mark. A day with one completion is a plain
 * closed ring; two or more completions divide that ring into one section per
 * habit, so "how many" is readable without a number (`ringArcs`).
 *
 * ## Why it is quiet
 *
 * Celestial Sapphire has no hue to spend. The ring is `text-muted-foreground` —
 * the same token the month's dots were toned down to — and carries no colour of
 * its own, so it can sit on the selected day's filled disc (near-black in light
 * appearance, near-white in dark) in both appearances without a second variant.
 * The colour is a `className` default, so a caller that ever needs a different
 * one can pass it.
 *
 * ## Decoration, so it takes no taps
 *
 * The ring is `aria-hidden` and `pointer-events-none`: the day's own button
 * carries the accessible name and keeps every pixel of its hit area, exactly as
 * the dot lane it replaces did. It also sits *around* the number rather than
 * over it — a 36px box with the glyph in the middle — so the digit is never
 * covered.
 *
 * ## Wired through the grid's day-marker seam
 *
 * The ring is painted inside `MonthGrid`'s day cell through its one per-day seam:
 * the habits month passes `renderDayMarker` (this node) and `dayMarkerLabel` (the
 * ring in words) to the grid, which threads both into the live month *and* the
 * two neighbours — so a neighbouring month sliding in under a paging drag
 * arrives already ringed. The grid lays the returned node in an
 * absolutely-positioned 36px box over the day disc; this component just draws
 * the arcs. See `./HabitMonthGrid` for the counts and the selected-day colour,
 * `./ring` for the geometry, and `MonthGrid` for the seam itself.
 */
import { cn } from '@/lib/utils';
import { RING_BOX_PX, RING_CENTRE_PX, RING_RADIUS_PX, RING_STROKE_PX, ringArcPath, ringArcs } from './ring';

export interface HabitDayRingProps {
  /** How many habits were completed on the day. `0` draws nothing at all. */
  segments: number;
  className?: string;
}

export function HabitDayRing({ segments, className }: HabitDayRingProps) {
  const arcs = ringArcs(segments);
  if (arcs.length === 0) return null;

  return (
    <svg
      viewBox={`0 0 ${RING_BOX_PX} ${RING_BOX_PX}`}
      // Decoration: the day's own control carries the accessible name, and the
      // ring must never take the tap that belongs to the day it circles.
      aria-hidden
      fill="none"
      stroke="currentColor"
      strokeWidth={RING_STROKE_PX}
      strokeLinecap="round"
      className={cn('pointer-events-none size-9 shrink-0 text-muted-foreground', className)}
    >
      {arcs.length === 1 ? (
        // One habit completed is a closed ring; an arc whose ends meet would
        // paint nothing at all.
        <circle cx={RING_CENTRE_PX} cy={RING_CENTRE_PX} r={RING_RADIUS_PX} />
      ) : (
        arcs.map((arc) => {
          const path = ringArcPath(arc);
          return path ? <path key={arc.fromDeg} d={path} /> : null;
        })
      )}
    </svg>
  );
}
