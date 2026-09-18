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
 * covers content. The shell's bottom band is hidden at `lg`; see `AppShell`.
 *
 * It is a shadcn `Button` rather than GodUI's `GooeyFab`: this is one action, not
 * a gooey cluster, and the button has to keep the shell's geometry — a flex
 * sibling of the tab bar, not an absolutely positioned overlay.
 */
import { PlusIcon } from '@svg-animated-icons/react/plus';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
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
     * "Floating" here means the band floats over the content — the button itself
     * is laid out next to the bar so the two can never overlap and the button
     * never needs a reserved row of its own.
     *
     * `requestPrimaryAction` is unchanged: the button is contextual, so it
     * announces an intent and whichever view is mounted acts on it.
     *
     * The glyph carries both `size-6` and `text-2xl`: the animated icons paint at
     * `1em` from an inline `<style>`, so the font-size is the lever that
     * actually sizes it, while the utility keeps the button's own
     * `[&_svg]:size-4` default from applying. Both name 1.5rem.
     */
    <Button
      type="button"
      aria-label={label}
      onClick={requestPrimaryAction}
      className={cn('size-14 shrink-0 rounded-full shadow-lg', className)}
    >
      <PlusIcon className="size-6 text-2xl" />
    </Button>
  );
}
