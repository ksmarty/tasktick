'use client';

/**
 * The way out of period mode.
 *
 * ## The decision
 *
 * Period mode replaces the navigation (see `AppShell`), so the task lists,
 * calendar and habits are not tabs while it is on. The user was explicit that
 * the navbar is replaced rather than extended, and a mode that keeps a "Tasks"
 * tab is not a mode. But "their tasks still exist" has to be true *in the
 * interface*, not only in the database, so the exit is not a link buried in
 * period Settings:
 *
 *  1. This control is the **leading item of the app bar on every period screen**.
 *     The shell renders it itself (not a screen), so no period screen can exist
 *     without it — a screen that forgets to publish a header would otherwise
 *     strand the user in the mode, which is exactly the failure to avoid.
 *  2. The desktop rail carries the same control at its foot, so the exit is in
 *     the same place the rail's own "Settings" row was.
 *  3. Period Settings also carries a full-width "Back to tasks" row and the
 *     "Turn off period tracking" switch, so there are two named ways back and a
 *     way to reverse the choice entirely.
 *
 * Leaving the mode this way **does not turn it off**: the period data, the
 * predictions and the preference all stay, and the user can step back in from
 * Settings. Turning it off is a deliberate, separate action on the settings
 * screen, because "I want to look at my tasks" and "I no longer track my cycle"
 * are different intents and conflating them destroys data the user did not ask
 * to lose.
 *
 * It is a real `Link` to `/tasks` — not a `router.push` — so it can be copied,
 * opened in a new tab and read out as a link, exactly like the app's other
 * navigation. Its label is the destination's own name, "Tasks": the control says
 * where it goes rather than what it leaves, which is the rule every other link in
 * the app follows.
 */
import Link from 'next/link';
import { ArrowLeftIcon } from '@svg-animated-icons/react/arrow-left';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/** Where the exit lands. `/tasks` is the app's own home. */
export const PERIOD_EXIT_HREF = '/tasks';

export interface PeriodExitButtonProps {
  /** Extra classes for the shell's header row. */
  className?: string;
}

export function PeriodExitButton({ className }: PeriodExitButtonProps) {
  return (
    <Button
      asChild
      variant="ghost"
      size="sm"
      className={cn('-ml-2 shrink-0 gap-1 px-2 text-muted-foreground hover:text-foreground', className)}
    >
      <Link href={PERIOD_EXIT_HREF} aria-label="Back to tasks and the rest of the app">
        <ArrowLeftIcon className="size-4 text-base" />
        <span className="text-sm font-medium">Tasks</span>
      </Link>
    </Button>
  );
}
