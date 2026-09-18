'use client';

/**
 * Publishing a screen's header into the shell.
 *
 * The shell owns the single `AppBar` (see `./AppShell`): one header for the app
 * rather than one per screen, which is what keeps the safe-area inset, the
 * elevation and the title position identical everywhere. A screen that needs a
 * title, a leading control or a set of actions drops this component at the top
 * of its tree:
 *
 * ```tsx
 * <PageHeader
 *   title="Tasks"
 *   actions={<IconButton aria-label="Add a task" onClick={openQuickAdd}><Add /></IconButton>}
 * />
 * ```
 *
 * It renders nothing itself — the content appears in the shell's bar. Screens
 * that publish nothing get the shell's route-derived title instead, so a route
 * is never headless.
 *
 * Outside the shell (the chrome-less auth layout) there is nothing to publish
 * into, and this component renders nothing — pass the header to the page itself
 * in that case.
 */
import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';

export interface PageHeaderContent {
  /** Replaces the route-derived title. */
  title?: ReactNode;
  /** Leading slot. Replaces the shell's back control when given. */
  leading?: ReactNode;
  /** Trailing slot: an `IconButton`, a `Button`, anything. */
  actions?: ReactNode;
  /**
   * A row rendered under the title row, inside the bar — how the task lists
   * attach their scroll-revealed search field to the header.
   */
  children?: ReactNode;
}

type PublishPageHeader = (content: PageHeaderContent | null) => void;

export const PageHeaderContext = createContext<PublishPageHeader | null>(null);

export function PageHeader({ title, leading, actions, children }: PageHeaderContent) {
  const publish = useContext(PageHeaderContext);

  // Memoised on the parts, so the effect below only re-runs when the header
  // actually changes rather than on every render of the screen.
  const content = useMemo<PageHeaderContent>(
    () => ({ title, leading, actions, children }),
    [title, leading, actions, children],
  );

  useEffect(() => {
    if (!publish) return;
    publish(content);
    // Navigating away clears it, so the next route falls back to its own title
    // instead of inheriting this screen's header.
    return () => publish(null);
  }, [publish, content]);

  return null;
}
