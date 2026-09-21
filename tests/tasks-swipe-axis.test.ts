/**
 * The task row's swipe/scroll axis rule, pinned with numbers rather than prose.
 *
 * These assertions exist because the rule was wrong in a way that neither `tsc`
 * nor a source-text pin could see, and the probe that "verified" the swipe was
 * wrong in a way that looked like a pass: it drove the gesture with a single
 * synthetic move per step, so the drift that kills a real thumb drag never
 * appeared in it.
 *
 * What the probe measured on device (Chromium 153, 390×844, `hasTouch`, touch
 * events through CDP), with the old first-past-the-post lock: a drag whose
 * opening move is vertical-by-9-to-15px locks to `'y'` and dies. All 6 of the
 * following `pointermove`s were delivered — the browser had *not* claimed a
 * scroll — and the row stayed at 0px through 80px of horizontal travel. Neither
 * a swipe nor a scroll. The numbers below are that sequence.
 *
 * Every expectation here is a resolved axis, so changing a constant has to be
 * reflected in the rule's behaviour rather than in a string.
 */
import { describe, expect, it } from 'vitest';
import {
  AXIS_COMMIT_PX,
  AXIS_TAKEOVER_RATIO,
  GESTURE_SLOP_PX,
  SCROLL_HANDOFF_PX,
  resolveSwipeAxis,
  type SwipeAxis,
} from '@/components/tasks/swipe-axis';

/** Feed a sequence of moves through the rule, carrying the state forward. */
function run(moves: Array<[number, number]>, from: { axis: SwipeAxis | null; locked: boolean } = { axis: null, locked: false }) {
  const out: Array<{ dx: number; dy: number; axis: SwipeAxis | null; locked: boolean; handOff: boolean }> = [];
  let axis: SwipeAxis | null = from.axis;
  let locked = from.locked;
  for (const [dx, dy] of moves) {
    const resolved = resolveSwipeAxis({ dx, dy, axis, locked });
    if (!resolved) {
      out.push({ dx, dy, axis, locked, handOff: false });
      continue;
    }
    axis = resolved.axis;
    locked = resolved.locked;
    out.push({ dx, dy, axis, locked, handOff: resolved.handOff });
  }
  return out;
}

describe('the swipe axis is not decided once and forgotten', () => {
  it('moves the row after a thumb drag that opens with 12px of vertical drift', () => {
    /*
     * The reported case. The old rule locked `'y'` at the second move (|dy| = 12
     * beat |dx| = 3) and the row never moved again for the rest of the touch.
     */
    const frames = run([
      [-2, 5],
      [-3, 11],
      [-12, 13],
      [-22, 13],
      [-32, 13],
      [-52, 13],
      [-72, 13],
    ]);

    // Before the finger moves sideways nothing is committed.
    expect(frames[1]).toMatchObject({ dx: -3, dy: 11, axis: 'y', locked: false, handOff: false });
    // The lead is taken over as soon as the horizontal clearly beats the drift…
    expect(frames[2]).toMatchObject({ dx: -12, dy: 13, axis: 'y' });
    expect(frames[3]).toMatchObject({ dx: -22, dy: 13, axis: 'x', locked: true });
    // …and every move after it keeps the row, so it rides the finger 1:1.
    for (const frame of frames.slice(3)) expect(frame.axis).toBe('x');
  });

  it('still holds a genuinely vertical drag back for the scroller', () => {
    /*
     * The other half of the trade: a vertical gesture must not turn into a swipe.
     * At 24px of vertical travel with no horizontal component the rule hands off
     * for good, and nothing after that can take the row back.
     */
    const frames = run([
      [0, 10],
      [0, 20],
      [0, 24],
      [30, 24],
      [60, 24],
    ]);
    expect(frames[0]).toMatchObject({ axis: 'y', locked: false, handOff: false });
    expect(frames[1]).toMatchObject({ axis: 'y', locked: false, handOff: false });
    expect(frames[2]).toMatchObject({ axis: 'y', locked: true, handOff: true });
    // The caller stops tracking after a hand-off, so the later moves never reach
    // the rule; if they did, the committed axis is what keeps them out.
    expect(run([[30, 24]], { axis: 'y', locked: true })[0]).toMatchObject({ axis: 'y', locked: true });
  });

  it('lets a gesture that starts horizontal go vertical before it is committed', () => {
    // The mirror image, and the reason the row is not captured for the whole
    // touch at the first slop crossing: a scroll that opens with a little
    // sideways wobble must still be able to become a scroll.
    const frames = run([
      [-10, 2],
      [-10, 20],
      [-10, 30],
    ]);
    expect(frames[0]).toMatchObject({ axis: 'x', locked: false });
    expect(frames[1]).toMatchObject({ axis: 'y', locked: false, handOff: false });
    // Once it is that vertical, the row lets go even though it was moving a
    // moment ago — the takeover does not leave it holding a half-swiped row.
    expect(frames[2]).toMatchObject({ axis: 'y', locked: true, handOff: true });
  });

  it('does not flap on a diagonal', () => {
    // Hysteresis: the trailing axis has to beat the leader by
    // `AXIS_TAKEOVER_RATIO`, so a 45° drag keeps whichever axis led.
    const frames = run([
      [10, 10],
      [-20, 20],
      [-30, 30],
      [-40, 40],
    ]);
    expect(frames.map((f) => f.axis)).toEqual(['x', 'x', 'x', 'x']);
    expect(frames.at(-1)).toMatchObject({ locked: true });
    // A constant that made the takeover eager would flip these back and forth.
    expect(AXIS_TAKEOVER_RATIO).toBeGreaterThan(1);
  });

  it('commits the horizontal axis at AXIS_COMMIT_PX, not at the slop', () => {
    expect(GESTURE_SLOP_PX).toBe(8);
    expect(resolveSwipeAxis({ dx: -(AXIS_COMMIT_PX - 1), dy: 0, axis: 'x', locked: false })).toMatchObject({
      axis: 'x',
      locked: false,
    });
    expect(resolveSwipeAxis({ dx: -AXIS_COMMIT_PX, dy: 0, axis: 'x', locked: false })).toMatchObject({
      axis: 'x',
      locked: true,
    });
    expect(SCROLL_HANDOFF_PX).toBeGreaterThan(AXIS_COMMIT_PX);
  });

  it('says nothing at all until one axis clears the slop', () => {
    expect(resolveSwipeAxis({ dx: 7, dy: -7, axis: null, locked: false })).toBeNull();
    expect(resolveSwipeAxis({ dx: 0, dy: 0, axis: null, locked: false })).toBeNull();
    expect(resolveSwipeAxis({ dx: GESTURE_SLOP_PX, dy: 0, axis: null, locked: false })).toMatchObject({ axis: 'x' });
    expect(resolveSwipeAxis({ dx: 0, dy: -GESTURE_SLOP_PX, axis: null, locked: false })).toMatchObject({ axis: 'y' });
  });

  it('never revises an axis that is already final', () => {
    expect(resolveSwipeAxis({ dx: -30, dy: 200, axis: 'x', locked: true })).toMatchObject({ axis: 'x', locked: true });
    expect(resolveSwipeAxis({ dx: 200, dy: 30, axis: 'y', locked: true })).toMatchObject({ axis: 'y', locked: true, handOff: false });
  });
});
