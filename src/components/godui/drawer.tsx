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
 *  5. The bottom safe-area clearance is imported from the shell's own chrome
 *     module (`@/components/app/chrome`) and applied to the bottom panel when
 *     the caller has handed the panel its own bottom padding (the pickers all
 *     pass `pb-[max(0.25rem,env(...))]`). The sheet's content edge is a shell
 *     measurement, not a per-caller one: with a copy of the expression in every
 *     picker the content stopped a safe-area short of the tab bar while the
 *     panel background reached the screen edge, leaving a card-coloured strip
 *     the user read as the page. Reading the same constant as the band makes
 *     the content bottom land on the band's bottom. A caller that pads its own
 *     content instead (the day sheet) is left alone so the two cannot stack.
 *  6. `FocusScope` (`@radix-ui/react-focus-scope`) wraps the panel's content, so
 *     a drawer opened from inside a Radix dialog takes the focus lock from it —
 *     see "Why the drawer owns focus as well as pointer events" below.
 *  7. `autoFocus` (default `true`) is forwarded to that `FocusScope`. Radix's
 *     scope focuses its first focusable element by default, which for a picker
 *     is the filter field — so opening the List picker raised the keyboard
 *     before the user had touched anything. The two pickers that own a text
 *     field pass `autoFocus={false}`.
 *  8. The portal root shrinks to the *visible* viewport while a software
 *     keyboard is up, and the panel is capped to it — see "Why the sheet
 *     follows the visual viewport" below. The measurement is clamped to half
 *     the viewport and dropped while the document is hidden, because iOS hands
 *     back a stale visual-viewport rectangle after an app switch.
 *  9. `titleAction` renders beside the title, at the panel's trailing edge, for
 *     a control that belongs to the sheet rather than to its body — the detail
 *     sheet's edit button.
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
 * ## Why the drawer owns focus as well as pointer events
 *
 * `pointer-events-auto` fixes the pointer half of the dialog-inside-a-dialog
 * problem. Focus is the other half, and it fails more quietly.
 *
 * Radix's modal `DialogContent` is wrapped in a `FocusScope` with `trapped`, so
 * focus leaving the dialog is pulled straight back to it. This drawer portals to
 * `body`, which is outside that scope, so every field inside it is unreachable
 * by keyboard *and by mouse*: pressing the field moves focus to it, the dialog's
 * scope sees the focus leave, and refocuses its own element before the caret
 * lands. The field looks live and silently ignores everything typed into it.
 *
 * Measured, in the task editor, before this change: clicking the List picker's
 * filter field left `document.activeElement` on a button in the dialog behind,
 * and typing produced an empty `value`. Driving the same field through a
 * synthetic `input` event filtered the list from 6 rows to 1 — so the wiring was
 * correct and only the focus was being taken away.
 *
 * `FocusScope` fixes it the way Radix expects nested layers to fix it: mounting
 * a scope pushes it onto the module-level stack, which pauses the scope below,
 * and unmounting resumes it. The drawer therefore keeps portalling to `body`
 * (which it must — the dialog is `translate`d, and a `translate` on an ancestor
 * makes `position: fixed` resolve against *it* rather than the viewport, so
 * portalling inside the dialog would confine the sheet to the dialog's box).
 *
 * `trapped` is what pauses the outer scope; `loop` keeps Tab inside the drawer.
 * Both match what Radix uses for a modal dialog.
 *
 * ## Why the sheet follows the visual viewport
 *
 * A bottom sheet is anchored to the bottom of the *layout* viewport, and a
 * software keyboard does not change the layout viewport: it covers the lower
 * part of it. So tapping the List picker's filter field raised the keyboard over
 * the sheet — the field the user was typing into, and everything below it, was
 * behind the keyboard, which is what "the popup is hidden below the keyboard"
 * reported.
 *
 * `window.visualViewport` is the rectangle the user can actually see, and it is
 * the only thing that shrinks for the keyboard. While the drawer is open and a
 * keyboard covers more than a rounding error of the page, the portal root's
 * bottom edge is moved up to the visible bottom (the panel is anchored to it, so
 * the sheet rises with it) and the panel is capped at the root's own height. The
 * cap matters because `max-h-[70dvh]` and `max-h-[90vh]` are both measured
 * against the layout viewport, so a 70% sheet on a phone whose keyboard takes
 * 40% of the screen would otherwise hang off the top of the display.
 *
 * With no keyboard (or no `visualViewport`, which is only the very old case) the
 * inset is 0, no style is applied, and the drawer is byte-for-byte what it was.
 *
 * ## Why a background switch used to float the sheet
 *
 * Reported: after switching to another app and coming back, a bottom sheet on
 * the tasks page was pinned to the *top* of the screen. That is the same inset,
 * stale in the other direction — a rectangle claiming to cover most of the page,
 * so the root's bottom edge jumped up to just under the top.
 *
 * iOS does not resize the visual viewport while a document is hidden, and it
 * does not reliably fire `resize` on the way back, so the effect could keep the
 * measurement it took before the switch. Two guards: a hidden document reports
 * 0 (there is no keyboard to clear while the app is away, and the sync on the
 * way back re-measures), and a measurement over half the layout viewport is
 * discarded — a phone keyboard does not cross that line, so a rectangle that
 * claims to is stale rather than real. `visibilitychange`, `pageshow`, `focus`,
 * the window's own `resize` and `orientationchange` are listened to as well, so
 * the geometry is re-derived instead of remembered.
 *
 * No `@godui/godui-theme` import exists in the published source — the registry
 * dependency is a stylesheet merge, not a code import — so there was nothing to
 * drop.
 */
import { FocusScope } from '@radix-ui/react-focus-scope';
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
  /**
   * A control rendered beside the title, at the panel's trailing edge — for an
   * action that belongs to the sheet rather than to its body, such as the
   * detail sheet's edit button.
   */
  titleAction?: React.ReactNode;
  /** Extra classes for the panel. */
  className?: string;
  /**
   * Move focus into the drawer when it opens. Radix's focus scope focuses its
   * first focusable element, which in a picker is the filter field — and on a
   * phone that raises the keyboard before the user has touched anything. Pass
   * `false` from a drawer whose first control is a text field.
   */
  autoFocus?: boolean;
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

/**
 * How much of the layout viewport a software keyboard is covering, in CSS px.
 *
 * `visualViewport` is the only rectangle that shrinks for the keyboard; the
 * layout viewport (`innerHeight`) does not. A few pixels of difference are
 * rounding, not a keyboard, so anything under 8px is reported as 0 and the
 * drawer keeps its default geometry.
 *
 * The rectangle is re-derived rather than remembered. iOS keeps reporting the
 * last one it had while the document is hidden and does not always fire
 * `resize` when it comes back, so a background switch can leave a stale
 * measurement behind — and a stale measurement over half the viewport is what
 * pinned a sheet to the top of the screen. Hidden documents therefore report 0,
 * and a value past half the layout viewport is discarded as stale.
 */
function useKeyboardInset(active: boolean, ownerDocument: Document | null): number {
  const [inset, setInset] = React.useState(0);

  React.useEffect(() => {
    const view = ownerDocument?.defaultView;
    const visual = view?.visualViewport;
    if (!active || !view || !visual) {
      setInset(0);
      return;
    }
    const sync = () => {
      if (ownerDocument.visibilityState === 'hidden') {
        setInset(0);
        return;
      }
      const covered = view.innerHeight - (visual.height + visual.offsetTop);
      const limit = Math.round(view.innerHeight * 0.5);
      setInset(covered > 8 ? Math.min(Math.round(covered), limit) : 0);
    };
    sync();
    visual.addEventListener('resize', sync);
    visual.addEventListener('scroll', sync);
    /*
     * The keyboard is not the only thing that changes the geometry, and none of
     * these are guaranteed to arrive after a background switch — so listen to
     * all of them and let the last one win.
     */
    view.addEventListener('resize', sync);
    view.addEventListener('orientationchange', sync);
    view.addEventListener('pageshow', sync);
    view.addEventListener('focus', sync);
    ownerDocument.addEventListener('visibilitychange', sync);
    return () => {
      visual.removeEventListener('resize', sync);
      visual.removeEventListener('scroll', sync);
      view.removeEventListener('resize', sync);
      view.removeEventListener('orientationchange', sync);
      view.removeEventListener('pageshow', sync);
      view.removeEventListener('focus', sync);
      ownerDocument.removeEventListener('visibilitychange', sync);
    };
  }, [active, ownerDocument]);

  return inset;
}

const Drawer = React.forwardRef<HTMLDivElement, DrawerProps>(
  (
    {
      open,
      onOpenChange,
      side = 'bottom',
      title,
      titleAction,
      className,
      autoFocus = true,
      children,
      container,
    },
    ref,
  ) => {
    const mounted = useMounted();
    const { ownerDocument, portalTarget, registerOwnerNode } =
      usePortalTarget(container);
    const isBottom = side === 'bottom';
    const keyboardInset = useKeyboardInset(open && isBottom, ownerDocument);
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
              <div
                className="pointer-events-auto fixed inset-0 z-modal"
                /*
                 * Only the bottom edge moves, and only while a keyboard covers
                 * part of the page: the panel is anchored to it, so the sheet
                 * rises with the keyboard instead of sitting behind it.
                 */
                style={keyboardInset ? { bottom: keyboardInset } : undefined}
              >
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
                  /*
                   * Inline, and only under a keyboard, because it has to beat the
                   * caller's own `max-h-*` — those are measured against the
                   * layout viewport, which the keyboard does not shrink. `100%`
                   * is the portal root, whose bottom edge is the visible one.
                   */
                  style={keyboardInset ? { maxHeight: '100%' } : undefined}
                >
                  {title || titleAction ? (
                    /*
                     * The title and its action share a row so the action sits
                     * against the panel's trailing edge, level with the first
                     * line of the title — the iOS "edit in the corner" shape.
                     */
                    <div className="mb-3 flex items-start justify-between gap-stack">
                      {title ? (
                        <h2 className="min-w-0 flex-1 text-lg font-semibold text-foreground">
                          {title}
                        </h2>
                      ) : (
                        <span className="min-w-0 flex-1" />
                      )}
                      {titleAction ? (
                        <span className="shrink-0">{titleAction}</span>
                      ) : null}
                    </div>
                  ) : null}
                  <FocusScope trapped loop autoFocus={autoFocus} className="overflow-y-auto">
                    {children}
                  </FocusScope>
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
