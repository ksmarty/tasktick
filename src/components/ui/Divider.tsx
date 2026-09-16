import type { ComponentPropsWithoutRef } from 'react';
import { cn } from '@/lib/cn';

export interface DividerProps extends ComponentPropsWithoutRef<'div'> {
  /** `horizontal` is a full-width hairline, `vertical` a rule between inline items. */
  orientation?: 'horizontal' | 'vertical';
  /** Left inset in px, to line the hairline up with a row's text column. */
  inset?: number;
}

/**
 * A hairline rule. Stays one physical pixel and follows the separator token in
 * both appearances. Rendered with `role="separator"` so it is announced as a
 * structural boundary rather than as content.
 */
export function Divider({ orientation = 'horizontal', inset = 0, className, style, ...rest }: DividerProps) {
  return (
    <div
      role="separator"
      aria-orientation={orientation}
      className={cn(
        'bg-separator',
        orientation === 'horizontal' ? 'h-px w-full' : 'w-px self-stretch',
        className,
      )}
      style={orientation === 'horizontal' && inset > 0 ? { ...style, marginLeft: inset } : style}
      {...rest}
    />
  );
}
