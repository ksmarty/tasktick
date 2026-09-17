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
 * Two rules make it behave like the platform rather than like a scroll spy:
 *
 *   - a direction only counts once it has travelled `thresholdPx`, so the
 *     sub-pixel jitter of a momentum scroll cannot flicker the field in and out;
 *   - frames just after we toggle the field are ignored, because toggling changes
 *     the pane's content height and the browser may then adjust the scroll
 *     position to keep it valid. That correction is not a gesture.
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
/** How long to ignore scroll corrections caused by our own toggle, in ms. */
const QUIET_MS = 320;

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

  /** Previous scroll position: read and written every frame, so a ref not state. */
  const lastTop = useRef(0);
  /** Timestamp until which scroll corrections are ignored. */
  const quietUntil = useRef(0);

  useEffect(() => {
    const node = document.getElementById(containerId);
    if (!node) return;

    lastTop.current = node.scrollTop;
    let frame = 0;

    const update = (next: boolean) => {
      setRevealed((current) => {
        if (current !== next) quietUntil.current = performance.now() + QUIET_MS;
        return next;
      });
    };

    const measure = () => {
      frame = 0;
      const top = node.scrollTop;
      const moved = top - lastTop.current;
      lastTop.current = top;

      if (performance.now() < quietUntil.current) return;
      if (Math.abs(moved) < thresholdPx) return;
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
