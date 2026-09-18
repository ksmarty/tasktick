'use client';

/**
 * The habits month's completion ring: one arc per habit completed that day, in
 * that habit's own colour.
 *
 * ## What it says
 *
 * A day with nothing completed has **no ring at all** — absence is the quiet
 * state, not an empty circle, because an empty circle is a mark and a day the
 * user did nothing is not worth a mark. A day with one completion is a plain
 * closed ring; two or more completions divide that ring into one section per
 * habit, so "how many" is readable without a number (`ringArcs`).
 *
 * ## Why it is coloured, and how
 *
 * The ring answers *which* habits were kept, so a day with three habits has to
 * read as three identifiable segments rather than one grey circle cut into
 * pieces — the count alone would not say which one is missing. Each arc is
 * therefore stroked in the colour stored on the habit it represents, resolved
 * through `accentHex` exactly as the list's own chips and the confetti burst
 * are. The light/dark pair comes from the app's single appearance source
 * (`useAppearance`), never from a second reading of the `dark` class.
 *
 * The arcs are painted with an explicit `stroke`, not `currentColor`, so a
 * caller cannot accidentally tint them: colour is the ring's information now.
 * The `className` still carries the box geometry (`size-9`) and any layout the
 * caller wants.
 *
 * ## It draws itself on, and off
 *
 * A ring appearing and vanishing between two renders of the month reads as a
 * flicker, so each arc sweeps on — a `pathLength` draw from nothing to the full
 * arc, which is the SVG equivalent of the stroke being laid down — and sweeps
 * back off when the day's last completion is taken back. The exit is why this
 * component is **kept mounted on every day**, with an empty colour list on the
 * days that have no ring (see `HabitMonthGrid`): an element that the parent has
 * already removed from the tree has nothing left to animate, so the day the
 * user unchecks would otherwise pop out. `memo` is what keeps that affordable —
 * the colours are a stable array per day, so a re-render of the grid (a paging
 * drag, a selection) skips every ring whose day did not change.
 *
 * It is deliberately small: a background indicator on a calendar cell must not
 * pull the eye off the numbers. The sweep is under half a second, the arcs are
 * staggered by a few tens of milliseconds so a three-habit day reads as three
 * strokes rather than one pulse, and `prefers-reduced-motion` turns both the
 * entrance and the exit off entirely (the global clamp in `globals.css` would
 * only shorten them, and a 0.01ms `pathLength` animation is not the same as no
 * animation at all).
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
 * the arcs. See `./HabitMonthGrid` for the colours and `./ring` for the geometry,
 * and `MonthGrid` for the seam itself.
 */
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { memo } from 'react';

import { useAppearance } from '@/app/providers';
import { accentHex } from '@/lib/colors';
import { cn } from '@/lib/utils';
import type { AccentColor } from '@/lib/types';
import { RING_BOX_PX, RING_CENTRE_PX, RING_RADIUS_PX, RING_STROKE_PX, ringArcPath, ringArcs } from './ring';

/** How long one arc takes to sweep on (or off). Short: it is a background mark. */
const SWEEP_SECONDS = 0.4;
/** The head start each further arc gets, so a multi-habit day reads as strokes. */
const SWEEP_STAGGER_SECONDS = 0.05;
/** The stagger is capped: a twelve-habit day must not take a second to draw. */
const SWEEP_STAGGER_MAX_SECONDS = 0.2;

export interface HabitDayRingProps {
  /**
   * One accent per habit completed on the day, in the habit list's own order —
   * the ring's arcs, one for one. An empty list draws nothing at all, but is not
   * the same as not rendering this component: the empty list is what lets the
   * last arc retract rather than disappear.
   */
  colours: readonly AccentColor[];
  className?: string;
}

function HabitDayRingBase({ colours, className }: HabitDayRingProps) {
  const reduceMotion = useReducedMotion();
  const { resolvedTheme } = useAppearance();
  const dark = resolvedTheme === 'dark';

  const arcs = ringArcs(colours.length);

  /*
   * The draw-on, as four props both arc shapes share.
   *
   * Under `prefers-reduced-motion` the arc is simply *there*: `initial` and
   * `exit` are the finished state and the duration is zero, so nothing animates
   * in or out and the ring costs the user nothing — the global clamp in
   * `globals.css` would only shorten a `pathLength` sweep, which still reads as
   * an animation. Otherwise the arc sweeps from zero length to full (and back),
   * staggered so a multi-habit day draws as strokes rather than one pulse, with
   * the stagger capped so a long ring is not still drawing a second later.
   */
  const sweep = (index: number) => ({
    initial: { pathLength: reduceMotion ? 1 : 0 },
    animate: { pathLength: 1 },
    exit: { pathLength: reduceMotion ? 1 : 0 },
    transition: reduceMotion
      ? { duration: 0 }
      : {
          duration: SWEEP_SECONDS,
          ease: 'easeOut' as const,
          delay: Math.min(index * SWEEP_STAGGER_SECONDS, SWEEP_STAGGER_MAX_SECONDS),
        },
  });

  return (
    /*
     * `AnimatePresence` is what makes the exit possible. The ring is its keyed
     * child, so when the day's colours empty it is kept in the tree while its
     * arcs — descendants carrying their own `exit` — sweep off, and is removed
     * only once they have. It renders no DOM of its own, so an empty ring (most
     * of the 126 cells the grid keeps mounted) contributes nothing to the page.
     */
    <AnimatePresence>
      {arcs.length > 0 ? (
        <motion.svg
          key="ring"
          viewBox={`0 0 ${RING_BOX_PX} ${RING_BOX_PX}`}
          // Decoration: the day's own control carries the accessible name, and the
          // ring must never take the tap that belongs to the day it circles.
          aria-hidden
          fill="none"
          strokeWidth={RING_STROKE_PX}
          strokeLinecap="round"
          className={cn('pointer-events-none size-9 shrink-0', className)}
        >
          {arcs.length === 1 ? (
            // One habit completed is a closed ring; an arc whose ends meet would
            // paint nothing at all.
            <motion.circle
              cx={RING_CENTRE_PX}
              cy={RING_CENTRE_PX}
              r={RING_RADIUS_PX}
              stroke={accentHex(colours[0], dark)}
              {...sweep(0)}
            />
          ) : (
            arcs.map((arc, index) => {
              const path = ringArcPath(arc);
              return path ? (
                <motion.path
                  key={arc.fromDeg}
                  d={path}
                  // Each arc carries the colour of the habit it stands for, so the
                  // ring names which habits were kept, not merely how many.
                  stroke={accentHex(colours[index], dark)}
                  {...sweep(index)}
                />
              ) : null;
            })
          )}
        </motion.svg>
      ) : null}
    </AnimatePresence>
  );
}

/**
 * Memoised on `colours` (the day's list, a stable reference from the grid's ring
 * map) and `className`: a grid re-render that does not change this day's ring
 * skips the whole sweep setup. See "It draws itself on, and off".
 */
export const HabitDayRing = memo(HabitDayRingBase);
HabitDayRing.displayName = 'HabitDayRing';
