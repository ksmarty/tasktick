'use client';

/**
 * GodUI — Drawer.
 *
 * Source as published by the `@godui/drawer` registry entry. Kept in
 * `components/godui` rather than imported from a package because that is how
 * the registry ships: the source is copied into the project so it can be
 * edited, which is what makes the local changes possible.
 *
 * Local changes:
 *  1. `cn()` is imported from `@/lib/utils` and used for the panel's class list
 *     instead of string concatenation, so a caller's `className` merges with
 *     correct Tailwind conflict resolution (and can override the panel's own
 *     padding/background).
 *  2. Quote style normalized to the repo's single quotes.
 *  3. `pointer-events-auto` on the portal root — see below. This is a bug fix,
 *     not a style choice.
 *  4. The scrim is `bg-black/50` instead of `bg-foreground/40`. This is a bug
 *     fix. `foreground` is near-black in the light scheme and near-WHITE in the
 *     dark one, so the overlay dimmed the page in light mode and *brightened* it
 *     in dark mode — measured `oklab(0.145 0 0 / 0.4)` light against
 *     `oklab(0.985 0 0 / 0.4)` dark. A scrim has one job, which is to push the
 *     page back, and that is not a job whose colour should follow the text
 *     colour. `bg-black/50` is also what this app's shadcn dialogs use, so the
 *     two overlay families now agree.
 *  4. The bottom safe-area clearance is imported from the shell's own chrome
 *     module (`@/components/app/chrome`) and applied to the bottom panel when
 *     the caller has handed the panel its own bottom padding (the pickers all
 *     pass `pb-[max(0.25rem,env(...))]`). The sheet's content edge is a shell
 *     measurement, not a per-caller one: with a copy of the expression in every
 *     picker the content stopped a safe-area short of the tab bar while the
 *     panel background reached the screen edge, leaving a card-coloured strip
 *     the user read as the page. Reading the same constant as the band makes
 *     the content bottom land on the band's bottom. A caller that pads its own
 *     content instead (the day sheet) is left alone so the two cannot stack.
 *
 * The source's `z-modal` is kept as-is: the z-index tokens are defined in
 * `globals.css` (`--z-index-modal`), so the semantic class resolves. GodUI's
 * published theme does not ship those tokens, which is why they had to be added
 * rather than assumed.
 *
 * ## Why `pointer-events-auto` is load-bearing
 *
 * A drawer is often opened from inside a Radix `Dialog` — every picker in the
 * task editor is. Radix locks the page behind a dialog with `react-remove-scroll`,
 * which sets `pointer-events: none` on `body` so the content underneath cannot be
 * interacted with.
 *
 * This drawer portals to `body` and is not a Radix primitive, so it inherits that
 * lock. The result is an overlay you can see but cannot touch: it renders on top,
 * every tap falls through to the dialog content underneath, and the menu looks
 * broken rather than disabled. Re-enabling pointer events on the portal root
 * undoes the inherited lock for this subtree only, which is exactly the intent —
 * the thing on top is the thing you should be able to press.
 *
 * No `@godui/godui-theme` import exists in the published source — the registry
 * dependency is a stylesheet merge, not a code import — so there was nothing to
 * drop.
 */
import { AnimatePresence, motion, type PanInfo } from 'framer-motion';
import * as React from 'react';
import { createPortal } from 'react-dom';
import { BOTTOM_BAND_CLEARANCE } from '@/components/app/chrome';
import { cn } from '@/lib/utils';

export type DrawerSide = 'bottom' | 'right';

export type DrawerProps = {
  /** Controlled open state. */
  open: boolean;
  /** Called when the drawer requests to open or close. */
  onOpenChange: (open: boolean) => void;
  /** Side the drawer slides in from. */
  side?: DrawerSide;
  /** Optional accessible title rendered at the top. */
  title?: React.ReactNode;
  /** Extra classes for the panel. */
  className?: string;
  children?: React.ReactNode;
  /** Element to portal into. Defaults to the owning document's body. */
  container?: HTMLElement | null;
};

const PANEL_BY_SIDE: Record<DrawerSide, string> = {
  bottom:
    'inset-x-0 bottom-0 max-h-[90vh] rounded-t-2xl border-t border-border',
  right: 'inset-y-0 right-0 w-full max-w-md rounded-l-2xl border-l border-border',
};

const CLOSE_OFFSET = 120;
const CLOSE_VELOCITY = 600;

function useMounted() {
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);
  return mounted;
}

function usePortalTarget(container: HTMLElement | null | undefined) {
  const [ownerDocument, setOwnerDocument] = React.useState<Document | null>(
    null,
  );
  const registerOwnerNode = React.useCallback(
    (node: HTMLSpanElement | null) => {
      if (node) {
        setOwnerDocument((current) =>
          current === node.ownerDocument ? current : node.ownerDocument,
        );
      }
    },
    [],
  );

  return {
    ownerDocument: container?.ownerDocument ?? ownerDocument,
    portalTarget: container ?? ownerDocument?.body ?? null,
    registerOwnerNode,
  };
}

const Drawer = React.forwardRef<HTMLDivElement, DrawerProps>(
  (
    {
      open,
      onOpenChange,
      side = 'bottom',
      title,
      className,
      children,
      container,
    },
    ref,
  ) => {
    const mounted = useMounted();
    const { ownerDocument, portalTarget, registerOwnerNode } =
      usePortalTarget(container);
    const isBottom = side === 'bottom';
    /*
     * A caller that sets the panel's bottom padding is delegating the sheet's
     * bottom edge to the panel; one that sets its own (the day sheet pads an
     * inner element) is not. Only the former is normalised to the shell's
     * clearance, so the two styles cannot double up.
     */
    const callerPadsPanelBottom = /(?:^|\s)pb-/.test(className ?? '');

    React.useEffect(() => {
      if (!open || !ownerDocument) return;
      const onKey = (e: KeyboardEvent) => {
        if (e.key === 'Escape') onOpenChange(false);
      };
      ownerDocument.addEventListener('keydown', onKey);
      const prevOverflow = ownerDocument.body.style.overflow;
      ownerDocument.body.style.overflow = 'hidden';
      return () => {
        ownerDocument.removeEventListener('keydown', onKey);
        ownerDocument.body.style.overflow = prevOverflow;
      };
    }, [open, onOpenChange, ownerDocument]);

    const handleDragEnd = (
      _e: MouseEvent | TouchEvent | PointerEvent,
      info: PanInfo,
    ) => {
      const offset = isBottom ? info.offset.y : info.offset.x;
      const velocity = isBottom ? info.velocity.y : info.velocity.x;
      if (offset > CLOSE_OFFSET || velocity > CLOSE_VELOCITY) {
        onOpenChange(false);
      }
    };

    if (!mounted) return null;

    const hidden = isBottom ? { y: '100%' } : { x: '100%' };
    const shown = isBottom ? { y: 0 } : { x: 0 };

    const portal = portalTarget
      ? createPortal(
          <AnimatePresence>
            {open ? (
              <div className="pointer-events-auto fixed inset-0 z-modal">
                <motion.div
                  aria-hidden
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  onClick={() => onOpenChange(false)}
                  className="absolute inset-0 bg-black/50 backdrop-blur-sm"
                />
                <motion.div
                  ref={ref}
                  role="dialog"
                  aria-modal="true"
                  data-slot="drawer"
                  initial={hidden}
                  animate={shown}
                  exit={hidden}
                  transition={{
                    type: 'spring',
                    damping: 32,
                    stiffness: 320,
                    mass: 0.9,
                  }}
                  drag={isBottom ? 'y' : 'x'}
                  dragConstraints={{ top: 0, bottom: 0, left: 0, right: 0 }}
                  dragElastic={
                    isBottom ? { top: 0, bottom: 0.6 } : { left: 0, right: 0.6 }
                  }
                  onDragEnd={handleDragEnd}
                  className={cn(
                    'absolute flex flex-col bg-card p-5 text-card-foreground shadow-xl',
                    PANEL_BY_SIDE[side],
                    className,
                    /*
                     * Last, so it wins the `pb-*` conflict against the caller's
                     * own bottom padding. The bottom sheet owns its clearance
                     * from the bottom chrome now; the pickers' content lands on
                     * the tab bar instead of a safe-area above it.
                     */
                    isBottom && callerPadsPanelBottom && BOTTOM_BAND_CLEARANCE,
                  )}
                >
                  {isBottom ? (
                    <div className="mx-auto mb-4 h-1.5 w-12 shrink-0 cursor-grab rounded-full bg-muted-foreground/30 active:cursor-grabbing" />
                  ) : null}
                  {title ? (
                    <h2 className="mb-3 text-lg font-semibold text-foreground">
                      {title}
                    </h2>
                  ) : null}
                  <div className="overflow-y-auto">{children}</div>
                </motion.div>
              </div>
            ) : null}
          </AnimatePresence>,
          portalTarget,
        )
      : null;

    return (
      <>
        {!container ? (
          <span ref={registerOwnerNode} hidden aria-hidden="true" />
        ) : null}
        {portal}
      </>
    );
  },
);
Drawer.displayName = 'Drawer';

export { Drawer };
