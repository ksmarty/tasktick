'use client';

import {
  cloneElement,
  isValidElement,
  useId,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type MouseEventHandler,
  type ReactElement,
  type ReactNode,
  type Ref,
} from 'react';
import { cn } from '@/lib/cn';
import { Z, useEscapeKey, useOutsidePointerDown } from './internal';

interface PopoverTriggerProps {
  ref?: Ref<HTMLElement>;
  onClick?: MouseEventHandler<HTMLElement>;
  'aria-expanded'?: boolean;
  'aria-haspopup'?: boolean | 'menu' | 'dialog' | 'listbox' | 'tree' | 'grid';
  'aria-controls'?: string;
}

export interface PopoverProps extends Omit<ComponentPropsWithoutRef<'div'>, 'content'> {
  /** The element that opens the panel; it gets `aria-expanded`/`aria-haspopup`. */
  trigger: ReactElement<PopoverTriggerProps>;
  /** Panel content. Pass a `role` (e.g. `menu`) when the content warrants one. */
  children: ReactNode;
  /** Controlled open state. Omit for the built-in uncontrolled behaviour. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Horizontal alignment relative to the trigger. */
  align?: 'start' | 'center' | 'end';
  /** Which side of the trigger the panel appears on. */
  side?: 'top' | 'bottom';
  className?: string;
}

const ALIGN_CLASSES = {
  start: 'left-0',
  center: 'left-1/2 -translate-x-1/2',
  end: 'right-0',
} as const;

/**
 * A panel anchored to a trigger, dismissed by clicking outside or pressing
 * Escape — at which point focus goes back to the trigger, so a keyboard user is
 * never dropped at the top of the page.
 */
export function Popover({
  trigger,
  children,
  open,
  onOpenChange,
  align = 'start',
  side = 'bottom',
  className,
  ...rest
}: PopoverProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const isControlled = open !== undefined;
  const isOpen = isControlled ? open : uncontrolledOpen;

  const wrapperRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const panelId = useId();

  function setOpen(next: boolean) {
    if (!isControlled) setUncontrolledOpen(next);
    onOpenChange?.(next);
  }

  useOutsidePointerDown(wrapperRef, isOpen, () => setOpen(false));
  useEscapeKey(isOpen, () => {
    setOpen(false);
    triggerRef.current?.focus({ preventScroll: true });
  });

  const anchor = isValidElement<PopoverTriggerProps>(trigger)
    ? cloneElement(trigger, {
        ref: triggerRef,
        'aria-expanded': isOpen,
        'aria-haspopup': true,
        'aria-controls': isOpen ? panelId : undefined,
        onClick: (event) => {
          trigger.props.onClick?.(event);
          if (!event.defaultPrevented) setOpen(!isOpen);
        },
      })
    : trigger;

  return (
    <div ref={wrapperRef} className="relative inline-flex">
      {anchor}
      {isOpen ? (
        <div
          id={panelId}
          style={{ zIndex: Z.popover }}
          className={cn(
            'absolute min-w-40 rounded-ios-md bg-elevated p-1 shadow-ios-lg animate-ios-in',
            side === 'top' ? 'bottom-full mb-1.5' : 'top-full mt-1.5',
            ALIGN_CLASSES[align],
            className,
          )}
          {...rest}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}
