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
import { requestQuickAdd } from '@/lib/events';

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
      onClick={requestQuickAdd}
      className={cn(
        /*
         * Sits above the floating tab bar, not beside it: the bar is centred and
         * the button is on the trailing edge, so they only collide on the
         * narrowest phones. `--tabbar-total` plus a gap keeps it clear of both
         * the bar and the home indicator.
         */
        'fixed right-4 z-40 flex size-14 items-center justify-center rounded-full',
        'bottom-[calc(env(safe-area-inset-bottom,0px)+5.5rem)]',
        'bg-tint text-tint-contrast shadow-ios-lg pressable',
        'lg:hidden',
        className,
      )}
    >
      <Plus className="size-7" strokeWidth={2.5} aria-hidden />
    </button>
  );
}
