/**
 * The check-in circle's pop, pinned from source.
 *
 * The bug this guards is a remount: the wrapper used to be `key`ed on the state,
 * and a keyed element replays its `initial` animation on every mount — so every
 * habit on the list popped at once when the habits tab was opened, and again on
 * any re-render that changed the key. The animation has to be started by the
 * user's toggle, so the pins here are "there is no key" and "the start lives in
 * `onCheckedChange`". The client component cannot be rendered in node, so the
 * mechanism is pinned structurally, as `calendar-agenda.test.ts` does.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const CONTROL = readFileSync(
  new URL('../src/components/habits/CheckInControl.tsx', import.meta.url),
  'utf8',
);

describe('the check-in pop fires on a toggle, not on mount', () => {
  it('does not remount the wrapper on the flip', () => {
    // The `key` was the whole mechanism: a flip changed it, React remounted the
    // motion element, and the mount replayed `initial`. It went with the fix.
    expect(CONTROL).not.toContain("key={done ? 'checked' : 'open'}");
  });

  it('starts the pop from the check handler', () => {
    // The start is inside `onCheckedChange` — after the handler opens — so only
    // a real toggle can fire it. A `pop.start` before that would be the mount
    // path again.
    expect(CONTROL).toContain('onCheckedChange={(checked) => {');
    expect(CONTROL).toContain('pop.start({ scale: [0.82, 1.12, 1] }');
    expect(CONTROL.indexOf('pop.start(')).toBeGreaterThan(CONTROL.indexOf('onCheckedChange={(checked)'));
  });

  it('mounts the wrapper in its resting state', () => {
    // `initial={false}` keeps the first paint still; the wrapper is driven by
    // the imperative controls and has no declarative mount animation.
    expect(CONTROL).toContain('initial={false}');
    expect(CONTROL).toContain('animate={pop}');
    expect(CONTROL).not.toContain('animate={reduceMotion ? { scale: 1 } : { scale: [0.82, 1.12, 1] }}');
  });

  it('honours the app-level reduced-motion hook, not framer’s', () => {
    // `useReducedMotion` from framer only reads the OS; the app's folds in the
    // in-app preference and the low-power inference.
    expect(CONTROL).toContain("import { useReducedMotion } from '@/lib/motion';");
    expect(CONTROL).not.toContain("import { motion, useReducedMotion } from 'framer-motion';");
    expect(CONTROL).toContain('if (!reduceMotion) {');
  });
});
