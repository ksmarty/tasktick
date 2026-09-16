'use client';

import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import { X } from 'lucide-react';
import { accentVar } from '@/lib/colors';
import { cn } from '@/lib/cn';
import type { AccentColor } from '@/lib/types';

export interface ChipProps extends Omit<ComponentPropsWithoutRef<'span'>, 'color'> {
  /** Accent that tints the pill; falls back to the user's accent via the `tint` class. */
  color?: AccentColor;
  /** Adds the remove affordance. */
  onRemove?: () => void;
  /** Accessible name of the remove button. Defaults to `Remove <label>`. */
  removeLabel?: string;
  /** Accessible name of the chip itself, when `children` is not a plain string. */
  label?: string;
  icon?: ReactNode;
  /** `md` is 28px (still finger-sized next to a 44px row), `sm` is the 24px tag. */
  size?: 'sm' | 'md';
  children?: ReactNode;
}

/**
 * Rounded tag pill. The tint is expressed as a `color-mix` over the accent
 * token, so it follows light/dark and the user's chosen accent instead of
 * freezing one hex value into the markup.
 */
export function Chip({
  color,
  onRemove,
  removeLabel,
  label,
  icon,
  size = 'md',
  className,
  style,
  children,
  ...rest
}: ChipProps) {
  const accessibleName = typeof children === 'string' ? children : label;

  return (
    <span
      aria-label={label}
      style={{
        ...(color
          ? {
              backgroundColor: `color-mix(in oklab, ${accentVar(color)} 16%, transparent)`,
              color: accentVar(color),
            }
          : null),
        ...style,
      }}
      className={cn(
        'inline-flex max-w-full items-center gap-1 rounded-full font-medium',
        size === 'md' ? 'h-7 pl-2.5 text-footnote' : 'h-6 pl-2 text-caption-1',
        !color && 'bg-tint-soft text-tint',
        onRemove ? (size === 'md' ? 'pr-1' : 'pr-0.5') : size === 'md' ? 'pr-2.5' : 'pr-2',
        className,
      )}
      {...rest}
    >
      {icon ? (
        <span className="flex shrink-0 items-center" aria-hidden>
          {icon}
        </span>
      ) : null}
      <span className="truncate">{children}</span>
      {onRemove ? (
        <button
          type="button"
          aria-label={removeLabel ?? (accessibleName ? `Remove ${accessibleName}` : 'Remove')}
          onClick={onRemove}
          className="flex size-5 shrink-0 items-center justify-center rounded-full pressable"
        >
          <X className="size-3.5" aria-hidden />
        </button>
      ) : null}
    </span>
  );
}
