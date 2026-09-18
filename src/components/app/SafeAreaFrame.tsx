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
 * `min-h-dvh` rather than `min-h-screen`: on iOS `100vh` is the height the
 * viewport would have with the browser chrome collapsed, so a `100vh` box is
 * always taller than the screen and the page scrolls a few pixels for no reason.
 * `dvh` is the height it actually has.
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
        'min-h-dvh pt-[env(safe-area-inset-top,0px)] pr-[env(safe-area-inset-right,0px)] pb-[env(safe-area-inset-bottom,0px)] pl-[env(safe-area-inset-left,0px)]',
        className,
      )}
    >
      {children}
    </div>
  );
}
