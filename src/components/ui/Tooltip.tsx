'use client';

import { cloneElement, isValidElement, useId, useRef, useState, type ReactElement } from 'react';
import { cn } from '@/lib/cn';
import { Z } from './internal';

export interface TooltipProps {
  /** Bubble text. Supplementary only — nothing required should live here. */
  label: string;
  /**
   * The single element the tooltip describes. It receives `aria-describedby`
   * so the text is announced on focus, not just on hover.
   */
  children: ReactElement<{ 'aria-describedby'?: string }>;
  side?: 'top' | 'bottom';
  /** Hover delay before the bubble appears, in ms. */
  delayMs?: number;
  className?: string;
}

/**
 * A short hover/focus hint. It never carries actions: on a touch screen there
 * is no hover, so it is shown on focus and on long-press-free tap of the
 * anchor, and the label is attached with `aria-describedby` for screen readers.
 * Escape hides it.
 */
export function Tooltip({ label, children, side = 'bottom', delayMs = 300, className }: TooltipProps) {
  const [visible, setVisible] = useState(false);
  const timer = useRef<number | null>(null);
  const id = useId();

  function cancelTimer() {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  }

  function show(delay: number) {
    cancelTimer();
    timer.current = window.setTimeout(() => setVisible(true), delay);
  }

  function hide() {
    cancelTimer();
    setVisible(false);
  }

  const anchor = isValidElement<{ 'aria-describedby'?: string }>(children)
    ? cloneElement(children, { 'aria-describedby': id })
    : children;

  return (
    <span
      className="relative inline-flex"
      onPointerEnter={() => show(delayMs)}
      onPointerLeave={hide}
      onFocus={() => show(0)}
      onBlur={hide}
      onKeyDown={(event) => {
        if (event.key === 'Escape') hide();
      }}
    >
      {anchor}
      {visible ? (
        <span
          role="tooltip"
          id={id}
          style={{ zIndex: Z.popover }}
          className={cn(
            'pointer-events-none absolute left-1/2 -translate-x-1/2 whitespace-nowrap rounded-ios-sm',
            'bg-elevated px-2 py-1 text-caption-1 text-label shadow-ios animate-fade-in',
            side === 'top' ? 'bottom-full mb-1.5' : 'top-full mt-1.5',
            className,
          )}
        >
          {label}
        </span>
      ) : null}
    </span>
  );
}
