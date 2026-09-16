import type { ComponentPropsWithoutRef } from 'react';
import { cn } from '@/lib/cn';

/**
 * iOS activity indicator: a thin, partially drawn ring that spins. Inherits its
 * colour from `currentColor`, so a Button's loading spinner automatically
 * matches that button's label colour.
 */
export interface SpinnerProps extends ComponentPropsWithoutRef<'svg'> {
  /** Rendered size in px. */
  size?: number;
  /**
   * Marks the spinner purely decorative (`aria-hidden`), for the cases where an
   * adjacent label already announces the busy state — e.g. inside `Button`.
   */
  decorative?: boolean;
  /** Accessible name when the spinner stands alone. */
  label?: string;
}

export function Spinner({ size = 20, decorative = false, label = 'Loading', className, ...rest }: SpinnerProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden={decorative || undefined}
      role={decorative ? undefined : 'status'}
      aria-label={decorative ? undefined : label}
      className={cn('animate-spin', className)}
      {...rest}
    >
      <circle cx="12" cy="12" r="9.5" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2.5" />
      <path d="M21.5 12A9.5 9.5 0 0 0 12 2.5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}
