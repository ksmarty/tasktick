/**
 * The month ring's sweep, pinned from source.
 *
 * The bug this guards is the same class as the check-in pop's: the arcs animate
 * on **mount** (`initial={{ pathLength: 0 }}`), and the grid mounts one ring per
 * day — so a month with completed days drew itself arc by arc when the habits
 * tab opened. The fix is a per-ring "already painted" flag, so the sweep is for
 * a day whose colours *change* (the user's toggle), never for the first paint.
 *
 * There is no jsdom in this repo, so the mechanism is pinned structurally, as
 * `habits-checkin-animation.test.ts` does for the check-in control.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const RING = readFileSync(
  new URL('../src/components/habits/HabitDayRing.tsx', import.meta.url),
  'utf8',
);

describe('the ring sweep fires on a change, not on the first paint', () => {
  it('keeps the skip flag per ring instance, not per module or screen', () => {
    // A `useRef` inside the component: the grid mounts one ring per day, so
    // "first paint" is that day's. A module-level flag would let a ring that
    // mounts later (paging to another month) inherit "already seen" and lose
    // its own skip.
    expect(RING).toContain('const paintedRef = useRef(false);');
    expect(RING).toContain('paintedRef.current = true;');
    // And it must not be hoisted out of the component to a module constant.
    expect(RING).not.toMatch(/^const paintedRef/m);
  });

  it('takes the finished state on that first paint and sweeps afterwards', () => {
    // `initial` is the whole animation: for the first paint it is 1 (no sweep),
    // and only once the ref has flipped does an arc that mounts later sweep from
    // 0. The exit is untouched, so taking a completion back still retracts.
    expect(RING).toMatch(
      /initial:\s*\{\s*pathLength:\s*reduceMotion\s*\|\|\s*!paintedRef\.current\s*\?\s*1\s*:\s*0\s*\}/,
    );
    expect(RING).toMatch(/exit:\s*\{\s*pathLength:\s*reduceMotion\s*\?\s*1\s*:\s*0\s*\}/);
  });

  it('does not use AnimatePresence initial={false}, which would block the toggle too', () => {
    // `initial={false}` on the presence wrapper suppresses the entrance of
    // children that mount *later* as well — exactly the check-in this animation
    // exists for. The per-instance ref is the narrower tool.
    expect(RING).not.toMatch(/<AnimatePresence[^>]*initial=\{false\}/);
  });

  it('honours the app-level reduced-motion hook, not framer’s', () => {
    expect(RING).toContain("import { useReducedMotion } from '@/lib/motion';");
    expect(RING).toContain("from 'framer-motion';");
    expect(RING).not.toMatch(/import\s*\{[^}]*useReducedMotion[^}]*\}\s*from\s*'framer-motion'/);
  });
});
