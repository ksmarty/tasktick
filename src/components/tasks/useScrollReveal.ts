'use client';

/**
 * The iOS search-field reveal.
 *
 * A list screen hides its search field while the user reads down it and brings it
 * back the moment they scroll back up. This hook owns only the gesture half of
 * that: it reports whether the pane is in a "reveal" state, and the caller decides
 * what to do with it (see `TasksView`, which hangs the field out of the scrolling
 * flow so a hidden field occupies no space and cannot be focused).
 *
 * Two rules make it behave like the platform rather than like a scroll spy:
 *
 *   - a direction only counts once it has travelled `showThresholdPx` (up) or
 *     `hideThresholdPx` (down). Movement is accumulated since the last direction
 *     change, so a slow drag — 5px a frame, never 8px in one frame — still adds
 *     up and still counts. The accumulator resets whenever the sign of the
 *     movement flips, so a flick's overshoot cannot be spent as movement on the
 *     way back;
 *
 *   - the two thresholds are different: it takes less travel to reveal the field
 *     than to hide it again. That is the hysteresis, and it is what stops the
 *     stutter. A finger that has just flicked up to expose the field almost
 *     always settles back a few pixels; with one threshold that settle read as a
 *     fresh "scroll down" and folded the field away again, frame after frame,
 *     which is exactly the flicker this used to show. Absorbing a small reversal
 *     while still taking the field away on a real scroll-down is the whole point.
 *
 * The listener is on the shell's own scroll pane (`#main`) rather than on
 * `window`: the document never scrolls in this shell, so a window listener would
 * never fire. Events are throttled to one measurement per animation frame, which
 * is also what keeps a fast flick from queueing dozens of state updates.
 *
 * There is deliberately no quiet window that ignores the scroll corrections a
 * reveal used to provoke. That correction existed because the field was animated
 * *inside* the scrolling pane's flow: growing it changed the pane's content
 * height, the browser re-anchored the scroll to keep the content still, and the
 * hook mistook that re-anchor for a gesture. The fix belongs at the source — the
 * field now animates out of flow (see `TasksView`), so a reveal cannot change the
 * scroll height and no correction is produced to ignore.
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

/** Upward travel, in px, before a downward-resting list reveals the field. */
const DEFAULT_SHOW_PX = 6;
/**
 * Downward travel, in px, before the field hides again.
 *
 * Larger than `DEFAULT_SHOW_PX` on purpose: that gap is the hysteresis that
 * absorbs the small settle after a reveal. It is still small enough that a
 * deliberate scroll-down hides the field immediately.
 */
const DEFAULT_HIDE_PX = 14;

export interface ScrollRevealOptions {
  /** Id of the scroll container. Defaults to the app shell's pane. */
  containerId?: string;
  /** Upward travel required to reveal. */
  showThresholdPx?: number;
  /** Downward travel required to hide. Keep above `showThresholdPx`. */
  hideThresholdPx?: number;
}

/**
 * True while the search field should be shown — that is, after a deliberate
 * upward scroll. Hidden to begin with, which is the point of the convention.
 */
export function useScrollReveal({
  containerId = 'main',
  showThresholdPx = DEFAULT_SHOW_PX,
  hideThresholdPx = DEFAULT_HIDE_PX,
}: ScrollRevealOptions = {}): boolean {
  const [revealed, setRevealed] = useState(false);

  /**
   * Mirror of `revealed` for the listener. A ref, not state: the listener reads
   * it on every frame and none of those writes is worth a render, and it keeps
   * the effect from having to re-subscribe whenever the field toggles.
   */
  const shown = useRef(false);
  /** Signed travel since the last state change or change of direction. */
  const travel = useRef(0);

  useEffect(() => {
    const node = document.getElementById(containerId);
    if (!node) return;

    let last = node.scrollTop;
    let frame = 0;

    const measure = () => {
      frame = 0;
      const top = node.scrollTop;
      const delta = top - last;
      last = top;
      if (delta === 0) return;

      // A change of direction resets the travel: only movement since the user
      // actually turned around counts.
      if (Math.sign(delta) !== Math.sign(travel.current)) travel.current = 0;
      travel.current += delta;

      if (!shown.current && travel.current <= -showThresholdPx) {
        shown.current = true;
        travel.current = 0;
        setRevealed(true);
      } else if (shown.current && travel.current >= hideThresholdPx) {
        shown.current = false;
        travel.current = 0;
        setRevealed(false);
      }
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
  }, [containerId, showThresholdPx, hideThresholdPx]);

  return revealed;
}
