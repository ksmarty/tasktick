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

/** Raised when the user asks for a new task from the shell. */
export const QUICK_ADD_EVENT = 'tasktick:quick-add';

/** Asks the mounted view to open its quick-add sheet. */
export function requestQuickAdd(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(QUICK_ADD_EVENT));
}

/**
 * Runs `open` when the shell's action button is pressed.
 *
 * `open` is held in a ref so the listener does not have to be re-attached on
 * every render — the caller passes an inline arrow, which would otherwise
 * resubscribe constantly.
 */
export function useQuickAddRequest(open: () => void): void {
  useEffect(() => {
    const handler = () => open();
    window.addEventListener(QUICK_ADD_EVENT, handler);
    return () => window.removeEventListener(QUICK_ADD_EVENT, handler);
  }, [open]);
}
