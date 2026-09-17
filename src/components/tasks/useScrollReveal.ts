'use client';

/**
 * The iOS search-field reveal.
 *
 * A list screen hides its search field while the user reads down it and brings
 * it back the moment they scroll back up — the field stops being permanent
 * chrome and becomes an answer to a gesture. This hook owns only the gesture
 * half of that: it reports whether the pane is in a "reveal" state, and the
 * caller decides what to do with it (see `TasksView`, which collapses the row to
 * zero height so a hidden field occupies no space and cannot be focused).
 *
 * Two rules make it behave like the platform rather than like a scroll spy:
 *
 *   - the pane at its top always counts as revealed, because "scroll up" has no
 *     direction left to report once the user has arrived;
 *   - a direction only counts once it has travelled `thresholdPx`, so the
 *     sub-pixel jitter of a momentum scroll cannot flicker the field in and out.
 *
 * The listener is on the shell's own scroll pane (`#main`) rather than on
 * `window`: the document never scrolls in this shell, so a window listener would
 * never fire. Events are throttled to one measurement per animation frame, which
 * is also what keeps a fast flick from queueing dozens of state updates.
 */
import { useEffect, useRef, useState } from 'react';

/** Movement, in px, before a scroll counts as a deliberate change of direction. */
const DEFAULT_THRESHOLD_PX = 8;
/**
 * How close to the top still counts as being at the top. A couple of pixels,
 * because a restored scroll position or a rubber-band can land on 1 or 2 rather
 * than exactly 0.
 */
const TOP_BAND_PX = 2;

export interface ScrollRevealOptions {
  /** Id of the scroll container. Defaults to the app shell's pane. */
  containerId?: string;
  /** Direction threshold in px. */
  thresholdPx?: number;
}

/**
 * True while the search field should be shown: at the top of the pane, or after
 * a deliberate upward scroll.
 *
 * Measured once on mount, so the field is present at rest and the convention
 * applies to the gesture rather than to a blank first paint.
 */
export function useScrollReveal({
  containerId = 'main',
  thresholdPx = DEFAULT_THRESHOLD_PX,
}: ScrollRevealOptions = {}): boolean {
  const [revealed, setRevealed] = useState(false);

  /** Previous scroll position, read and written every frame, so a ref not state. */
  const lastTop = useRef(0);
  /**
   * Frames to ignore.
   *
   * Toggling the field changes the pane's content height, and a pane scrolled to
   * its foot then has its position pulled back to keep the scroll valid. That is
   * the browser, not a gesture.
   *
   * This used to be detected by comparing the scroll delta against the change in
   * content height — which is fragile, because the stored height goes stale
   * whenever content changes without a scroll (data arriving, a section
   * collapsing) and the next comparison is then meaningless. In practice the
   * first scroll after load was misread as a correction and the field stayed put.
   *
   * Suppressing briefly around our OWN change is unambiguous: it covers the
   * transition, and any real gesture after it still registers.
   */
  const quietUntil = useRef(0);
  const QUIET_MS = 320;

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

      if (top <= TOP_BAND_PX) {
        update(true);
        return;
      }
      if (performance.now() < quietUntil.current) return;
      if (Math.abs(moved) < thresholdPx) return;
      update(moved < 0);
    };

    const onScroll = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(measure);
    };

    node.addEventListener('scroll', onScroll, { passive: true });

    /*
     * Measure once on mount as well as on every scroll.
     *
     * Without this the field is hidden on load and the user is at the top of the
     * pane, where there is no direction left to scroll — so the reveal can never
     * fire and the field is unreachable until they scroll down and back up. That
     * is a trap, not a convention. A first measurement applies the TOP_BAND rule
     * above, which shows the field at rest and hides it only once the user has
     * deliberately scrolled away from the top.
     */
    measure();

    return () => {
      node.removeEventListener('scroll', onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [containerId, thresholdPx]);

  return revealed;
}
