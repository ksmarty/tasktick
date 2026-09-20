'use client';

/**
 * The settings area's own scroll pane.
 *
 * Every other section in settings used to scroll in the shell's `main`, which is
 * the shell's single shared pane. A scroll-edge fade has to live on the element
 * that actually scrolls, so settings declares `fullHeight` here — the same
 * arrangement the task list and the calendar already use — and this component
 * becomes the one scroller for the area.
 *
 * It restates the mobile tab-bar clearance the shell's pane carries
 * (`pb-[calc(env(safe-area-inset-bottom)_+_5.375rem)]`, dropped at `lg` where the
 * band is hidden), so the last card still clears the band. The `min-h-0 flex-1`
 * pair is what makes it the flex child that moves while the published header
 * above stays put. Nothing else about the area changes: the layout still
 * publishes the one "Settings" title, and the section navigation still lives
 * above this pane, pinned, so it stays put while the panel scrolls.
 *
 * `fade-y` is the `tw-fade` utility (see the import in `globals.css`): it masks
 * this element's top and bottom edges, gated on its own scroll position, so the
 * fade is absent when the list is short enough to fit.
 */
import { useShellPane } from '@/components/app/ShellPane';

export function SettingsScroll({ children }: { children: React.ReactNode }) {
  useShellPane({ fullHeight: true });

  return (
    <div className="fade-y min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[calc(env(safe-area-inset-bottom)_+_5.375rem)] lg:pb-0">
      {children}
    </div>
  );
}
