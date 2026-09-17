'use client';

/**
 * The iOS search-field reveal.
 *
 * A list screen hides its search field while the user reads down it and brings
 * it back the moment they scroll back up — the field stops being permanent
 * chrome and becomes an answer to a gesture. This hook owns only the gesture
 * half of that: it reports whether the field should be on screen, and the caller
 * decides what to do with it (see `TasksView`, which collapses the row to zero
 * height so a hidden field occupies no space and cannot be focused).
 *
 * Three rules make it behave like the platform rather than like a scroll spy:
 *
 *   - the field starts hidden, and only an *upward* scroll brings it back;
 *   - a direction only counts once it has travelled `thresholdPx`, so the
 *     sub-pixel jitter of a momentum scroll cannot flicker the field in and out;
 *   - a pane that cannot scroll is always revealed. With nothing to scroll there
 *     is no gesture that could bring the field back, so hiding it would make
 *     search unreachable on a short list — the field simply has to be there.
 *
 * The top of the pane used to count as revealed, which is what iOS does; that is
 * also why the field sat on screen at rest. The user asked for hidden-until-scroll
 * twice, so the top is now an ordinary position with no gesture in it.
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
 * Slack, in px, for the "cannot scroll" test: fractional layout can leave a pane
 * that fits its content measuring a scrollHeight a hair above its clientHeight.
 */
const OVERFLOW_SLACK_PX = 1;
/**
 * How long "this pane cannot scroll" has to hold before it is believed.
 *
 * While a list is loading, its placeholder is short — believing that measurement
 * would flash the field on screen at rest, which is the very thing hiding it is
 * for. A short list settles within one debounce; a list that arrives long never
 * reports short once its data is in.
 */
const OVERFLOW_SETTLE_MS = 200;

export interface ScrollRevealOptions {
  /** Id of the scroll container. Defaults to the app shell's pane. */
  containerId?: string;
  /** Direction threshold in px. */
  thresholdPx?: number;
}

/**
 * True while the search field should be shown: after a deliberate upward scroll,
 * or whenever the pane has nothing to scroll.
 */
export function useScrollReveal({
  containerId = 'main',
  thresholdPx = DEFAULT_THRESHOLD_PX,
}: ScrollRevealOptions = {}): boolean {
  const [revealed, setRevealed] = useState(false);
  /**
   * Whether the pane has anything to scroll. Optimistic in the "yes" direction,
   * so the first paint hides the field and only a settled measurement of a pane
   * that fits its content brings it back.
   */
  const [scrollable, setScrollable] = useState(true);

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
    let settle = 0;

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

    /** Re-reads whether the pane has anything to scroll; see `OVERFLOW_SETTLE_MS`. */
    const measureOverflow = () => {
      if (node.scrollHeight - node.clientHeight > OVERFLOW_SLACK_PX) {
        if (settle) {
          window.clearTimeout(settle);
          settle = 0;
        }
        setScrollable(true);
        return;
      }
      if (settle) return;
      settle = window.setTimeout(() => {
        settle = 0;
        // Re-check on settle: the content may have grown while we waited. A pane
        // that stayed short has no gesture in it, so the field stays out.
        setScrollable(node.scrollHeight - node.clientHeight > OVERFLOW_SLACK_PX);
      }, OVERFLOW_SETTLE_MS);
    };

    node.addEventListener('scroll', onScroll, { passive: true });

    /*
     * Content that changes without a scroll: data arriving, a section
     * collapsing, a filter landing. A `ResizeObserver` on the pane's content is
     * what notices — the pane's own box does not move when its content grows —
     * and the pane itself is observed too, because resizing the window changes
     * what fits without changing the content.
     */
    const observer = new ResizeObserver(measureOverflow);
    observer.observe(node);
    for (const child of Array.from(node.children)) observer.observe(child);
    measureOverflow();

    return () => {
      node.removeEventListener('scroll', onScroll);
      observer.disconnect();
      if (frame) window.cancelAnimationFrame(frame);
      if (settle) window.clearTimeout(settle);
    };
  }, [containerId, thresholdPx]);

  return revealed || !scrollable;
}
