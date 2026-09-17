'use client';

/**
 * The iOS search-field reveal.
 *
 * A list screen hides its search field while the user reads down it and brings it
 * back the moment they scroll back up. This hook owns only the gesture half of
 * that: it reports whether the pane is in a "reveal" state, and the caller decides
 * what to do with it (see `TasksView`, which collapses the row to zero height so a
 * hidden field occupies no space and cannot be focused).
 *
 * Three rules make it behave like the platform rather than like a scroll spy:
 *
 *   - a direction only counts once it has travelled `thresholdPx`, so the
 *     sub-pixel jitter of a momentum scroll cannot flicker the field in and out.
 *     The reference position only moves when a gesture is *acted on*, so a slow
 *     drag — 5px a frame, never 8px in one frame — still adds up and still
 *     counts. Re-anchoring every frame dropped that movement instead, so a gentle
 *     swipe back down could never hide the field again;
 *   - frames just after we toggle the field are ignored, because toggling changes
 *     the pane's content height (the field is a row of the sticky header, and the
 *     header is inside the scrolling pane) and the browser may then adjust the
 *     scroll position to keep it valid. That correction is not a gesture;
 *   - that quiet window swallows movement in the direction *opposite* to the one
 *     we just switched on, because that is the way a correction runs. Revealing
 *     the field grows the sticky header, so the pane's content is pushed down and
 *     the browser's scroll anchoring compensates by moving the offset *down* with
 *     it — frame by frame, for the whole length of the transition. Read as a
 *     gesture that correction is a flick in the opposite direction, and it threw
 *     the field in and out; swallowed, the position stays where the user left it.
 *     Carrying on the way they were already going is never a correction, so that
 *     is never swallowed — scroll down and the field hides, and stays hidden.
 *
 * The window therefore has to outlast the field's own transition
 * (`duration-300` in `TasksView`), not just a frame: a correction that trickles
 * in for 300ms is still a correction at 299ms.
 *
 * The listener is on the shell's own scroll pane (`#main`) rather than on
 * `window`: the document never scrolls in this shell, so a window listener would
 * never fire. Events are throttled to one measurement per animation frame, which
 * is also what keeps a fast flick from queueing dozens of state updates.
 *
 * ## Why there is no "is it scrollable?" fallback
 *
 * There used to be one: if the pane fitted its content, the field was shown
 * unconditionally, so a short list could not hide a control that no gesture could
 * bring back. That was solving the problem in the wrong place — it made the field
 * depend on how many tasks the user happened to have, and it fought with the
 * shell once the shell started guaranteeing scroll range.
 *
 * The shell now gives every route a small guaranteed overscroll
 * (`min-h-[calc(100%+3rem)]` in `AppShell`), so the gesture exists on every
 * screen at every content length. One mechanism, in the place that can actually
 * guarantee it.
 */
import { useEffect, useRef, useState } from 'react';

/** Movement, in px, before a scroll counts as a deliberate change of direction. */
const DEFAULT_THRESHOLD_PX = 8;
/**
 * How long to ignore scroll corrections caused by our own toggle, in ms.
 *
 * Slightly longer than the field's own transition (`duration-300` in
 * `TasksView`, kept in step by hand): the correction the toggle provokes is
 * spread across that whole transition, because the header grows a little on
 * every frame of it.
 */
const QUIET_MS = 380;

export interface ScrollRevealOptions {
  /** Id of the scroll container. Defaults to the app shell's pane. */
  containerId?: string;
  /** Direction threshold in px. */
  thresholdPx?: number;
}

/**
 * True while the search field should be shown — that is, after a deliberate
 * upward scroll. Hidden to begin with, which is the point of the convention.
 */
export function useScrollReveal({
  containerId = 'main',
  thresholdPx = DEFAULT_THRESHOLD_PX,
}: ScrollRevealOptions = {}): boolean {
  const [revealed, setRevealed] = useState(false);

  /**
   * The position the current gesture is measured from. A ref, not state: it is
   * read and written every frame, and none of those writes is worth a render.
   */
  const lastTop = useRef(0);
  /** Timestamp until which scroll corrections are ignored. */
  const quietUntil = useRef(0);
  /** The value we last switched to, so reporting the same one again costs nothing. */
  const settled = useRef(false);
  /** Direction of the last switch: `-1` up (revealed), `1` down (hidden), `0` none. */
  const switchDirection = useRef(0);

  useEffect(() => {
    const node = document.getElementById(containerId);
    if (!node) return;

    lastTop.current = node.scrollTop;
    let frame = 0;

    const update = (next: boolean) => {
      if (settled.current === next) return;
      settled.current = next;
      // Remembered so the correction the toggle provokes can be told apart from
      // the user carrying on in the direction they were already going.
      switchDirection.current = next ? -1 : 1;
      quietUntil.current = performance.now() + QUIET_MS;
      setRevealed(next);
    };

    const measure = () => {
      frame = 0;
      const top = node.scrollTop;
      const moved = top - lastTop.current;

      // Under the threshold no direction has been committed to yet, so the
      // reference stays put and the next frame's movement is added to this one.
      if (Math.abs(moved) < thresholdPx) return;
      lastTop.current = top;

      if (performance.now() < quietUntil.current && Math.sign(moved) !== switchDirection.current) return;
      update(moved < 0);
    };

    const onScroll = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(measure);
    };

    node.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      node.removeEventListener('scroll', onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [containerId, thresholdPx]);

  return revealed;
}
