'use client';

/**
 * Floating action button.
 *
 * A single primary action that is always within thumb reach, rather than a small
 * target in the top-right corner that a hand cannot get to one-handed. This is
 * the shape every native task app converges on, and it is why the nav bar's own
 * "+" can stay as a secondary affordance.
 *
 * Mobile only: on a desktop there is no thumb-reach problem, the nav bar's
 * actions are already at hand, and a floating circle over a wide window just
 * covers content. The shell hides it at `lg`; see `AppShell`.
 */
import Add from '@mui/icons-material/Add';
import Fab from '@mui/material/Fab';
import { requestPrimaryAction } from '@/lib/events';

export interface QuickAddFabProps {
  /** Accessible name. Defaults to "Add a task". */
  label?: string;
  className?: string;
}

export function QuickAddFab({ label = 'Add a task', className }: QuickAddFabProps) {
  return (
    /*
     * A flex sibling of the bottom navigation, not an absolutely positioned
     * overlay.
     *
     * "Floating" here means the band floats over the content — the button
     * itself is laid out next to the bar so the two can never overlap and the
     * button never needs a reserved row of its own.
     *
     * `requestPrimaryAction` is unchanged: the button is contextual, so it
     * announces an intent and whichever view is mounted acts on it.
     */
    <Fab
      color="primary"
      aria-label={label}
      onClick={requestPrimaryAction}
      className={className}
      sx={{ flexShrink: 0 }}
    >
      <Add fontSize="medium" />
    </Fab>
  );
}
