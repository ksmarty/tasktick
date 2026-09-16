'use client';

/**
 * Cross-component UI intents.
 *
 * The floating action button lives in the app shell but the quick-add sheet it
 * opens belongs to whichever view is on screen. Rather than lift every view's
 * state into the shell — which would re-render the whole tree on a keystroke —
 * the button announces an intent and the mounted view acts on it.
 *
 * A DOM event is the right shape here because the relationship is genuinely
 * one-to-many and time-scoped: whichever view is mounted should respond, and no
 * view should care whether a button exists.
 */
import { useEffect } from 'react';

/**
 * Raised when the user presses the shell's action button.
 *
 * Deliberately not "quick add a task": the button is contextual. On the task
 * lists it opens the quick-add sheet, on /habits it opens the habit editor, and
 * on /calendar it starts a new event. A single global event keeps the button in
 * the shell while each mounted view decides what it means.
 */
export const PRIMARY_ACTION_EVENT = 'tasktick:quick-add';

/** Asks the mounted view to perform its primary "create" action. */
export function requestPrimaryAction(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(PRIMARY_ACTION_EVENT));
}

/**
 * Runs `open` when the shell's action button is pressed.
 *
 * `open` is held in a ref so the listener does not have to be re-attached on
 * every render — the caller passes an inline arrow, which would otherwise
 * resubscribe constantly.
 */
export function usePrimaryAction(open: () => void): void {
  useEffect(() => {
    const handler = () => open();
    window.addEventListener(PRIMARY_ACTION_EVENT, handler);
    return () => window.removeEventListener(PRIMARY_ACTION_EVENT, handler);
  }, [open]);
}
