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
 * covers content.
 */
import { Plus } from 'lucide-react';
import { cn } from '@/lib/cn';
import { requestPrimaryAction } from '@/lib/events';

export interface QuickAddFabProps {
  /** Accessible name. Defaults to "Add a task". */
  label?: string;
  className?: string;
}

export function QuickAddFab({ label = 'Add a task', className }: QuickAddFabProps) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={requestPrimaryAction}
      className={cn(
        /*
         * A flex sibling of the tab bar, not an absolutely positioned overlay.
         *
         * "Floating" here means the band floats over the content — the button
         * itself is laid out next to the pill so the two can never overlap and
         * the button never needs a reserved row of its own.
         */
        'glass flex size-13 shrink-0 items-center justify-center rounded-full',
        'text-tint pressable',
        className,
      )}
    >
      <Plus className="size-6" strokeWidth={2.5} aria-hidden />
    </button>
  );
}
