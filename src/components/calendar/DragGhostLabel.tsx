'use client';

import type { DragGhost } from './use-item-drag';

/**
 * The floating label that follows the finger during a drag.
 *
 * It shows the *snapped* landing time (not the raw pointer position), which is
 * what makes a 15-minute grid feel predictable: the user sees the value that
 * will be committed before they let go.
 *
 * It is a `fixed` box at the top of the surface scale, positioned against the
 * viewport so the matrix the drag applies to the lifted row never carries it
 * along. `pointer-events-none` is load-bearing: the label sits under the finger
 * and must never intercept the pointer that is driving the drag.
 *
 * Only `left`/`top` are inline — they are the pointer's own coordinates, which
 * no class can express. The 14px/-50% offset the old `sx` carried is a class
 * (`translate-x-3.5 -translate-y-1/2`), so the only inline values here are the
 * dynamic ones.
 */
export function DragGhostLabel({ ghost }: { ghost: DragGhost }) {
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed z-modal translate-x-3.5 -translate-y-1/2 rounded-md border border-border bg-popover px-1 py-0.5 text-xs font-semibold text-popover-foreground tabular-nums shadow-lg"
      style={{ left: ghost.clientX, top: ghost.clientY }}
    >
      {ghost.label}
    </div>
  );
}
