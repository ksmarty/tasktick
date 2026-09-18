/**
 * Full-height page frame that respects every safe-area inset.
 *
 * The chrome-less layouts (sign in, register) render before the app shell
 * exists, so they cannot inherit the shell's insets — this is their single
 * wrapper, and it insets on all four edges. On a notched phone in landscape the
 * left and right insets are not zero, which is the case a `pt`-only frame gets
 * wrong.
 *
 * The insets are read straight from `env(safe-area-inset-*)` with a `0px`
 * fallback, so they resolve to zero off-device and the frame is safe to use
 * unconditionally. `env()` cannot be a theme token — it is a device value, not a
 * design one — which is why it appears as a utility rather than in the layout
 * scale.
 *
 * `h-full` + `overflow-y-auto` rather than `min-h-dvh`: the document is no
 * longer a scroller (see `globals.css`), so a layout that can outgrow the screen
 * has to own its own scrolling or its content becomes unreachable. The frame is
 * the scroller here, which also means the safe-area insets stay outside it and
 * the content never slides under the notch.
 *
 * `overscroll-contain` so a drag past the end of this pane stops at the pane
 * instead of being handed to the (locked) root — the same wall every other
 * scroll container in the app presents.
 *
 * `className` is merged with `cn()`, so a caller that wants to override the
 * height or the inset on one edge can.
 */
import { cn } from '@/lib/utils';

export function SafeAreaFrame({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'h-full overflow-y-auto overscroll-contain pt-[env(safe-area-inset-top,0px)] pr-[env(safe-area-inset-right,0px)] pb-[env(safe-area-inset-bottom,0px)] pl-[env(safe-area-inset-left,0px)]',
        className,
      )}
    >
      {children}
    </div>
  );
}
