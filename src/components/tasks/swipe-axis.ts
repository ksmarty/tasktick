/**
 * The task row's swipe/scroll axis rule, as a free function.
 *
 * It lives in its own module — like `due-label.ts` and `sections.ts` next to it
 * — because the interesting part of the swipe is arithmetic, not rendering: the
 * rule decides whether a finger travelling diagonally moves the row or scrolls
 * the list, and it has to be pinnable with the numbers a real thumb produces. A
 * test that imports a client component cannot run in this suite (no DOM, no
 * JSX), and a test that asserts on the component's source text cannot fail when
 * the constants change.
 *
 * See `resolveSwipeAxis` for the rule itself and the measurements behind it.
 */

/** Movement that cancels a long press and starts deciding the gesture axis. */
export const GESTURE_SLOP_PX = 8;
/**
 * How far the leading axis must travel before the axis decision is final.
 *
 * The axis used to be decided once, on the first move past `GESTURE_SLOP_PX`,
 * and never revisited. That made a thumb drag which opened with a little
 * vertical drift — 9–15px, which is most of them — lock to `'y'`, hand the row
 * back to the scroller and die for the rest of the touch, however far the finger
 * then travelled sideways: neither a swipe nor a scroll. Between the slop and
 * this distance the lead can still be taken over, so a gesture is only given up
 * once it is unambiguous; past it the decision is final.
 */
export const AXIS_COMMIT_PX = 18;
/**
 * How much the trailing axis must beat the leading one to take the lead over,
 * so a near-diagonal drag does not flap between the two axes every frame.
 */
export const AXIS_TAKEOVER_RATIO = 1.2;
/**
 * Vertical travel after which the row hands the touch to the scroller for good.
 *
 * The browser normally does that itself: a vertical drag past its own slop fires
 * `pointercancel` and nothing the page does can take the touch back. Measured,
 * Chromium (153, 390×844, touch) claims the scroll somewhere between 12px and
 * 16px of vertical travel. This constant is the fallback for the cases the
 * browser leaves to the page, so a long vertical drag can never turn into a
 * swipe halfway down the screen.
 */
export const SCROLL_HANDOFF_PX = 24;

/** The gesture's axis: horizontal is a swipe, vertical belongs to the scroller. */
export type SwipeAxis = 'x' | 'y';

/** One `pointermove`'s movement, and the axis state it is resolved against. */
export interface SwipeAxisMove {
  dx: number;
  dy: number;
  /** The axis as it stands, or `null` before the first slop crossing. */
  axis: SwipeAxis | null;
  /** True once the axis is final for the rest of this touch. */
  locked: boolean;
}

export interface SwipeAxisResolution {
  axis: SwipeAxis;
  locked: boolean;
  /** The row must let go: the touch belongs to the scroller from here on. */
  handOff: boolean;
}

/**
 * Resolves the gesture's axis for one `pointermove`, or `null` while neither
 * axis has cleared `GESTURE_SLOP_PX`.
 *
 * The rule, in one sentence: **whichever axis leads keeps the lead until the
 * other one clearly beats it, and the decision is only final once the leading
 * axis has travelled `AXIS_COMMIT_PX`.**
 *
 * - Below the slop nothing is decided, so a wobbly start costs nothing.
 * - The lead is taken over when the trailing axis beats the leader by
 *   `AXIS_TAKEOVER_RATIO` — hysteresis, so a diagonal drag does not flap.
 * - `'x'` is final at `AXIS_COMMIT_PX` of horizontal travel. `'y'` is final at
 *   `SCROLL_HANDOFF_PX` of vertical travel, where `handOff` tells the caller to
 *   stop tracking the pointer entirely.
 *
 * The asymmetry is deliberate. A wrong `'y'` costs the user a swipe they cannot
 * get back for the rest of the touch — the dead band this replaces, measured at
 * 9–15px of opening drift, where the row moved 0px through 80px of horizontal
 * travel — while a wrong `'x'` costs a few pixels of row travel that settle back
 * on release. Letting `'x'` lead from the slop and making `'y'` wait for a
 * clearly vertical gesture therefore fixes the fight without making the list
 * unscrollable over a row: the browser still takes a genuine vertical drag away
 * with `pointercancel`, and `handOff` covers the cases it leaves alone.
 */
export function resolveSwipeAxis({ dx, dy, axis, locked }: SwipeAxisMove): SwipeAxisResolution | null {
  const adx = Math.abs(dx);
  const ady = Math.abs(dy);
  if (!axis && adx < GESTURE_SLOP_PX && ady < GESTURE_SLOP_PX) return null;

  let next: SwipeAxis = axis ?? (adx >= ady ? 'x' : 'y');
  if (!locked) {
    if (next === 'x' && ady > adx * AXIS_TAKEOVER_RATIO) next = 'y';
    else if (next === 'y' && adx > ady * AXIS_TAKEOVER_RATIO) next = 'x';
  }

  if (locked) return { axis: next, locked: true, handOff: false };
  if (next === 'x' && adx >= AXIS_COMMIT_PX) return { axis: 'x', locked: true, handOff: false };
  if (next === 'y' && ady >= SCROLL_HANDOFF_PX) return { axis: 'y', locked: true, handOff: true };
  return { axis: next, locked: false, handOff: false };
}
