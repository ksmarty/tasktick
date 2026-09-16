import type { ComponentPropsWithoutRef } from 'react';
import { cn } from '@/lib/cn';

export interface KbdProps extends ComponentPropsWithoutRef<'kbd'> {
  /** `md` is 24px tall, `sm` the 20px variant for dense hints. */
  size?: 'sm' | 'md';
}

/**
 * A keyboard-shortcut glyph, e.g. `<Kbd>⌘K</Kbd>`. Uses `<kbd>` so screen
 * readers announce it as user input rather than as prose.
 */
export function Kbd({ size = 'md', className, children, ...rest }: KbdProps) {
  return (
    <kbd
      className={cn(
        'inline-flex items-center justify-center rounded-ios-sm border border-separator bg-fill-tertiary',
        'px-1.5 font-sans text-caption-1 text-secondary',
        size === 'md' ? 'h-6 min-w-6' : 'h-5 min-w-5 text-caption-2',
        className,
      )}
      {...rest}
    >
      {children}
    </kbd>
  );
}
