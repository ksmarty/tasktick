'use client';

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { cn } from '@/lib/cn';
import { Portal, Z, useBodyScrollLock, useEscapeKey, useFocusTrap } from './internal';

/** Matches the exit half of the `sheet-up` keyframe; keep the two in step. */
const EXIT_MS = 260;
/** Length of the `sheet-up` entry animation (the `--animate-sheet-up` token). */
const ENTER_MS = 340;
/** Drag distance (px) that dismisses a content-sized sheet. */
const DISMISS_DRAG_PX = 96;

export interface SheetProps extends Omit<ComponentPropsWithoutRef<'div'>, 'title'> {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: ReactNode;
  description?: ReactNode;
  /**
   * iOS detents as fractions of the viewport height, e.g. `[0.5, 0.9]`. When
   * given, the sheet opens at the largest detent and dragging snaps between
   * them. When omitted the sheet sizes to its content, capped at 90dvh.
   */
  snapPoints?: readonly number[];
  /** When false, backdrop tap, swipe-down and Escape are all ignored. */
  dismissible?: boolean;
  /** Actionable content pinned below the scrolling body. */
  footer?: ReactNode;
  className?: string;
  children?: ReactNode;
}

/** Drops nonsense detents, sorts them and clamps them into a usable range. */
function normaliseSnapPoints(points: readonly number[] | undefined): number[] {
  if (!points?.length) return [];
  const cleaned = points
    .filter((point) => Number.isFinite(point) && point > 0)
    .map((point) => Math.min(1, Math.max(0.15, point)))
    .sort((a, b) => a - b);
  return [...new Set(cleaned)];
}

/**
 * The iOS bottom sheet.
 *
 * Rendered into a portal with a dimmed backdrop, a grabber, a rounded top and
 * the `sheet-up` entry animation (reversed on the way out). While it is open the
 * document is scroll-locked and Tab is trapped inside the panel; Escape, a
 * backdrop tap and a downward swipe on the grabber all dismiss it, and focus
 * goes back to whatever was focused before it opened.
 */
export function Sheet({
  open,
  onOpenChange,
  title,
  description,
  snapPoints,
  dismissible = true,
  footer,
  className,
  style,
  children,
  ...rest
}: SheetProps) {
  const [rendered, setRendered] = useState(open);
  const [closing, setClosing] = useState(false);
  const [entered, setEntered] = useState(false);
  const [dragY, setDragY] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [detent, setDetent] = useState(0);

  const panelRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef({ startY: 0, height: 0, active: false });
  const titleId = useId();
  const descriptionId = useId();

  const detents = useMemo(() => normaliseSnapPoints(snapPoints), [snapPoints]);

  // Mount on open, stay mounted through the exit animation.
  useEffect(() => {
    if (!open) return;
    setRendered(true);
    setClosing(false);
    setDetent(Math.max(0, detents.length - 1));
  }, [open, detents.length]);

  useEffect(() => {
    if (open || !rendered) return;
    setClosing(true);
    const timer = window.setTimeout(() => {
      setRendered(false);
      setClosing(false);
    }, EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [open, rendered]);

  // The entry animation uses `both` fill, which would keep overriding the drag
  // transform once it finished — so the class is dropped as soon as it is done.
  useEffect(() => {
    if (!open) return;
    setEntered(false);
    const timer = window.setTimeout(() => setEntered(true), ENTER_MS);
    return () => window.clearTimeout(timer);
  }, [open]);

  const dismiss = () => {
    if (dismissible) onOpenChange(false);
  };

  useBodyScrollLock(rendered);
  useEscapeKey(open && dismissible, () => onOpenChange(false));
  useFocusTrap(panelRef, open);

  function onHandlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (!dismissible) return;
    dragRef.current = {
      startY: event.clientY,
      height: panelRef.current?.offsetHeight ?? 0,
      active: true,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
  }

  function onHandlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!dragRef.current.active) return;
    setDragY(Math.max(0, event.clientY - dragRef.current.startY));
  }

  function onHandlePointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    const state = dragRef.current;
    if (!state.active) return;
    state.active = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setDragging(false);
    setDragY(0);

    const travelled = Math.max(0, event.clientY - state.startY);
    if (detents.length === 0) {
      if (travelled > DISMISS_DRAG_PX) dismiss();
      return;
    }

    const viewport = window.innerHeight || 1;
    const remaining = (state.height - travelled) / viewport;
    if (remaining < detents[0] * 0.6) {
      dismiss();
      return;
    }
    let nearest = 0;
    for (let index = 0; index < detents.length; index += 1) {
      if (Math.abs(detents[index] - remaining) < Math.abs(detents[nearest] - remaining)) nearest = index;
    }
    setDetent(nearest);
  }

  if (!rendered) return null;

  const panelStyle: CSSProperties = {
    zIndex: Z.sheet,
    ...(detents.length > 0 ? { height: `${detents[detent] * 100}dvh` } : { maxHeight: '90dvh' }),
    // Reversed keyframe for the exit, so the sheet leaves exactly the way it arrived.
    ...(closing ? { animation: `sheet-up ${EXIT_MS}ms var(--ease-ios) reverse both` } : null),
    ...(dragging && dragY > 0 ? { transition: 'none', transform: `translateY(${dragY}px)` } : null),
    ...style,
  };

  const bottomInset = 'max(1rem, env(safe-area-inset-bottom, 0px))';

  return (
    <Portal>
      <div className="fixed inset-0" style={{ zIndex: Z.sheet }}>
        <div
          aria-hidden
          onClick={dismiss}
          className={cn(
            'absolute inset-0 bg-overlay transition-opacity duration-200 ease-ios',
            closing ? 'opacity-0' : 'opacity-100',
          )}
        />

        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={title ? titleId : undefined}
          aria-describedby={description ? descriptionId : undefined}
          tabIndex={-1}
          style={panelStyle}
          className={cn(
            'absolute inset-x-0 bottom-0 flex flex-col overflow-hidden rounded-t-ios-xl bg-sheet shadow-ios-lg',
            !closing && !entered && 'animate-sheet-up',
            className,
          )}
          {...rest}
        >
          {/* Grabber + header double as the swipe-down target. */}
          <div
            className="shrink-0 touch-none select-none"
            onPointerDown={onHandlePointerDown}
            onPointerMove={onHandlePointerMove}
            onPointerUp={onHandlePointerUp}
            onPointerCancel={onHandlePointerUp}
          >
            <div className="flex justify-center pt-2 pb-1">
              <span aria-hidden className="h-[5px] w-9 rounded-full bg-fill" />
            </div>
            {title || description ? (
              <header className="px-4 pb-3 text-center">
                {title ? (
                  <h2 id={titleId} className="text-headline font-semibold text-label">
                    {title}
                  </h2>
                ) : null}
                {description ? (
                  <p id={descriptionId} className="mt-1 text-footnote text-secondary">
                    {description}
                  </p>
                ) : null}
              </header>
            ) : null}
          </div>

          <div className="scroll-ios min-h-0 flex-1 overflow-y-auto px-4" style={{ paddingBottom: footer ? '0.5rem' : bottomInset }}>
            {children}
          </div>

          {footer ? (
            <div className="hairline-t shrink-0 px-4 pt-3" style={{ paddingBottom: bottomInset }}>
              {footer}
            </div>
          ) : null}
        </div>
      </div>
    </Portal>
  );
}
