'use client';

import type { DragGhost } from './use-item-drag';

/**
 * The floating label that follows the finger during a drag.
 *
 * It shows the *snapped* landing time (not the raw pointer position), which is
 * what makes a 15-minute grid feel predictable: the user sees the value that
 * will be committed before they let go.
 */
export function DragGhostLabel({ ghost }: { ghost: DragGhost }) {
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed z-50"
      style={{ left: ghost.clientX, top: ghost.clientY, transform: 'translate(14px, -50%)' }}
    >
      <span className="material tnum rounded-ios-sm px-2 py-1 text-caption-1 font-semibold text-label shadow-ios-lg">
        {ghost.label}
      </span>
    </div>
  );
}
