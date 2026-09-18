'use client';

/**
 * Publishing a screen's header into the shell.
 *
 * The shell owns the single top app bar (see `./AppShell`): one header for the
 * app rather than one per screen, which is what keeps the safe-area inset, the
 * border and the title position identical everywhere. A screen that needs a
 * title, a leading control or a set of actions drops this component at the top
 * of its tree:
 *
 * ```tsx
 * <PageHeader
 *   title="Tasks"
 *   actions={<Button aria-label="Add a task" onClick={openQuickAdd}><PlusIcon /></Button>}
 * />
 * ```
 *
 * It renders nothing itself — the content appears in the shell's bar. When no
 * screen publishes, the shell renders no bar at all: several screens carry a
 * header of their own (the task lists, the focus timer), and a route-derived
 * fallback up there would stack a second title on top of theirs. A screen does
 * one or the other.
 *
 * Outside the shell (the chrome-less auth layout) there is nothing to publish
 * into, and this component renders nothing — pass the header to the page itself
 * in that case.
 *
 * The implementation is unchanged across the GodUI migration and deliberately
 * so: `CalendarToolbar` and the settings pages are rendered by screens that are
 * being converted in parallel, and the contract they depend on is the exported
 * `PageHeader` / `PageHeaderContext` / `PageHeaderContent` triple plus the
 * publish-on-mount, clear-on-unmount behaviour below.
 */
import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';

export interface PageHeaderContent {
  /** The heading the shell renders in its top app bar. */
  title?: ReactNode;
  /** Leading slot, before the title. */
  leading?: ReactNode;
  /** Trailing slot: an icon `Button`, a `Button`, anything. */
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
