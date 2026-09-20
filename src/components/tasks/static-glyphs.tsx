'use client';

/**
 * Static glyphs for the list rows.
 *
 * ## Why these are not `@svg-animated-icons/react`
 *
 * The animated set is the default here (see `GODUI-CONVENTIONS.md`), and the
 * interactive glyphs still use it: the checkbox tick, the priority bolt, the
 * recurrence loop, the pin on the "Pinned" header, the header's own buttons.
 * This file is only for the glyphs that *never animate at rest*, because the
 * animated set pays for its animation in a way that multiplies by row count:
 * every instance renders its own `<style>` element as a sibling of the `<svg>`
 * (the library has no shared stylesheet — see its `dist/icons/*.js`), so a list
 * of N rows inserts N copies of the same ~1.2KB of CSS and N stylesheets for
 * the engine to match against the whole document.
 *
 * Measured on `/tasks` (demo data, 390×844, 6× CPU throttle) before this file
 * existed: 89 `<style>` elements on the page, 71,942 bytes of injected CSS, and
 * 672 of the page's 1,681 DOM nodes were the 56 event rows' calendar glyphs
 * alone — 12 nodes each (`<style>` + `<svg>` + 10 primitives).
 *
 * The event row's calendar glyph was already passing `disableHover`: it is a
 * label for "this row is an event, not a task", not a control, so nothing about
 * it animates even today. Drawing it as one plain `<svg>` therefore removes the
 * per-instance stylesheet and most of its nodes without giving up an animation
 * the row ever had.
 *
 * ## The geometry is the library's, not a redraw
 *
 * The paths below are the same drawing the animated `calendar` icon renders —
 * `rect x=1.5 y=2.5 w=12 h=11 rx=0.75`, the `M1.5 5.5H13.5` rule, the two
 * rounded tabs, and the six `r=0.55` day dots — only consolidated: the frame
 * and the rule become subpaths of one stroked path (both use butt caps), the two
 * tabs stay their own path (they are the only round-capped strokes), and the six
 * dots become six subpaths of one filled path. Nothing moved.
 */
import { cn } from '@/lib/utils';

export interface GlyphProps {
  /** Sizing and colour. The row passes the same `size-5 text-xl` the icon took. */
  className?: string;
}

/**
 * The event row's leading glyph: a calendar in the checkbox's slot.
 *
 * The `<svg>` is `aria-hidden`: the row's button already names itself as an
 * "event" (see `EventRow`), so the glyph is decoration.
 */
export function CalendarGlyph({ className }: GlyphProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 15 15"
      fill="none"
      aria-hidden
      // `cursor-pointer` keeps the cursor the animated icon's injected
      // `cursor: pointer` gave this glyph; `overflow-visible` matches its
      // `overflow: visible`. The rest is sizing, from the caller.
      className={cn('cursor-pointer overflow-visible', className)}
    >
      {/* The frame and the rule under the header, in one stroked path. */}
      <path
        d="M2.25 2.5H12.75A0.75 0.75 0 0 1 13.5 3.25V12.75A0.75 0.75 0 0 1 12.75 13.5H2.25A0.75 0.75 0 0 1 1.5 12.75V3.25A0.75 0.75 0 0 1 2.25 2.5ZM1.5 5.5H13.5"
        stroke="currentColor"
        strokeWidth="1"
      />
      {/* The two binding tabs: the only round-capped strokes in the drawing. */}
      <path
        d="M4.5 1.25V3M10.5 1.25V3"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinecap="round"
      />
      {/* The six day dots, as one filled path of six circular subpaths. */}
      <path
        d="M3.95 8A0.55 0.55 0 1 0 5.05 8A0.55 0.55 0 1 0 3.95 8ZM6.95 8A0.55 0.55 0 1 0 8.05 8A0.55 0.55 0 1 0 6.95 8ZM9.95 8A0.55 0.55 0 1 0 11.05 8A0.55 0.55 0 1 0 9.95 8ZM3.95 11A0.55 0.55 0 1 0 5.05 11A0.55 0.55 0 1 0 3.95 11ZM6.95 11A0.55 0.55 0 1 0 8.05 11A0.55 0.55 0 1 0 6.95 11ZM9.95 11A0.55 0.55 0 1 0 11.05 11A0.55 0.55 0 1 0 9.95 11Z"
        fill="currentColor"
      />
    </svg>
  );
}
