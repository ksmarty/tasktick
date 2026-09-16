'use client';

import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Spinner } from './Spinner';

/**
 * `filled` is the iOS prominent button (tinted fill, white label), `tinted` the
 * soft one, `plain` the text-only one, `gray` the neutral fill used for
 * secondary actions.
 */
export type ButtonVariant = 'filled' | 'tinted' | 'plain' | 'destructive' | 'gray';

/** `md` and `lg` are 44px and 52px tall — safe touch targets on a 390px screen. */
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ComponentPropsWithoutRef<'button'> {
  /** Visual style. Defaults to `filled`. */
  variant?: ButtonVariant;
  /** Height and type size. Defaults to `md` (44px). */
  size?: ButtonSize;
  /** Stretches the button to the width of its container. */
  fullWidth?: boolean;
  /** Swaps the leading icon for a `Spinner`, sets `aria-busy` and disables the button. */
  loading?: boolean;
  /** Leading Lucide icon, rendered decorative. */
  icon?: LucideIcon;
  /** Extra classes for the icon, e.g. `size-5`. */
  iconClassName?: string;
  children?: ReactNode;
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  filled: 'bg-tint text-tint-contrast',
  tinted: 'bg-tint-soft text-tint',
  plain: 'bg-transparent text-tint',
  destructive: 'bg-danger text-on-tint',
  gray: 'bg-fill text-label',
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  // `sm` is the compact toolbar size; `md`/`lg` satisfy the 44px touch minimum.
  sm: 'h-9 min-w-9 rounded-ios px-3 text-subhead',
  md: 'h-11 min-w-11 rounded-ios-md px-4 text-body',
  lg: 'h-13 min-w-13 rounded-ios-lg px-6 text-headline',
};

export function Button({
  variant = 'filled',
  size = 'md',
  fullWidth = false,
  loading = false,
  icon: Icon,
  iconClassName,
  disabled,
  className,
  children,
  type = 'button',
  ...rest
}: ButtonProps) {
  const isDisabled = Boolean(disabled) || loading;

  return (
    <button
      type={type}
      disabled={isDisabled}
      aria-disabled={isDisabled || undefined}
      aria-busy={loading || undefined}
      className={cn(
        'inline-flex shrink-0 select-none items-center justify-center gap-2 font-semibold',
        'pressable disabled:pointer-events-none disabled:opacity-40',
        VARIANT_CLASSES[variant],
        SIZE_CLASSES[size],
        fullWidth && 'w-full',
        className,
      )}
      {...rest}
    >
      {loading ? (
        <Spinner size={size === 'lg' ? 22 : 18} decorative className="shrink-0" />
      ) : Icon ? (
        <Icon className={cn('size-[1.15em] shrink-0', iconClassName)} aria-hidden />
      ) : null}
      {children}
    </button>
  );
}
