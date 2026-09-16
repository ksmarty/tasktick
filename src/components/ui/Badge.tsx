import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import { cn } from '@/lib/cn';

export type BadgeVariant = 'default' | 'tint' | 'danger';

export interface BadgeProps extends ComponentPropsWithoutRef<'span'> {
  /** `default` is the grey counter, `tint` the accent one, `danger` the red one. */
  variant?: BadgeVariant;
  /** Count to show. Values above `max` collapse to `${max}+`. */
  value?: number;
  /** Overflow ceiling. Default 99, i.e. `99+`. */
  max?: number;
  /** Fallback content when no numeric `value` is given (e.g. "New"). */
  children?: ReactNode;
  /** Context for assistive tech, e.g. `"5 due tasks"`. */
  label?: string;
}

const VARIANT_CLASSES: Record<BadgeVariant, string> = {
  default: 'bg-fill text-secondary',
  tint: 'bg-tint text-tint-contrast',
  danger: 'bg-danger text-on-tint',
};

/** Small count pill. Purely presentational — no state, no handlers. */
export function Badge({ variant = 'default', value, max = 99, children, label, className, ...rest }: BadgeProps) {
  const text = value === undefined ? children : value > max ? `${max}+` : String(Math.max(0, value));

  return (
    <span
      aria-label={label}
      className={cn(
        'tnum inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full px-1.5',
        'text-caption-1 font-semibold leading-none',
        VARIANT_CLASSES[variant],
        className,
      )}
      {...rest}
    >
      {text}
    </span>
  );
}
