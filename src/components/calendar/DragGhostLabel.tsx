'use client';

import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import type { DragGhost } from './use-item-drag';

/**
 * The floating label that follows the finger during a drag.
 *
 * It shows the *snapped* landing time (not the raw pointer position), which is
 * what makes a 15-minute grid feel predictable: the user sees the value that
 * will be committed before they let go.
 *
 * It is a `Paper` at the top of the surface scale, positioned against the
 * viewport so the matrix the drag applies to the lifted row never carries it
 * along.
 */
export function DragGhostLabel({ ghost }: { ghost: DragGhost }) {
  return (
    <Paper
      aria-hidden
      elevation={4}
      sx={{
        pointerEvents: 'none',
        position: 'fixed',
        zIndex: 50,
        left: ghost.clientX,
        top: ghost.clientY,
        transform: 'translate(14px, -50%)',
        borderRadius: 1,
        px: 1,
        py: 0.5,
      }}
    >
      <Typography variant="caption" sx={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
        {ghost.label}
      </Typography>
    </Paper>
  );
}
