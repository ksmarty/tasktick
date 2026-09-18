'use client';

/**
 * Letting a screen own its own scrolling.
 *
 * The shell normally owns the scroll: `main` is the single scrolling pane, which
 * is what keeps one scrollbar, one overscroll behaviour and one "where am I" on
 * every screen. That is right for a list of tasks or a settings page.
 *
 * It is wrong for a screen whose top half is a control and whose bottom half is
 * a list — the month calendar and the habits screen. There, the grid should stay
 * put while the list beneath it scrolls, and the shell's pane would carry the
 * grid off the top of the screen with everything else.
 *
 * So those screens declare it:
 *
 * ```tsx
 * useShellPane({ fullHeight: true });
 * ```
 *
 * which swaps the pane from "scrolls, and always has a little extra to scroll"
 * to "fills the screen exactly, and the screen scrolls its own list". The screen
 * is then responsible for `flex min-h-0 flex-1 flex-col`, with `shrink-0` on the
 * part that stays and `min-h-0 flex-1 overflow-y-auto` on the part that moves.
 *
 * The declaration is cleared on unmount, so navigating away restores the normal
 * pane without the next screen having to opt back in.
 */
import { createContext, useContext, useEffect } from 'react';

type SetFullHeight = (full: boolean) => void;

export const ShellPaneContext = createContext<SetFullHeight | null>(null);

export function useShellPane({ fullHeight = false }: { fullHeight?: boolean } = {}): void {
  const setFullHeight = useContext(ShellPaneContext);

  useEffect(() => {
    if (!setFullHeight) return;
    setFullHeight(fullHeight);
    return () => setFullHeight(false);
  }, [setFullHeight, fullHeight]);
}
