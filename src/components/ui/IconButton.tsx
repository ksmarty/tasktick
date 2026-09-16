'use client';

import type { ComponentPropsWithoutRef } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Spinner } from './Spinner';

export type IconButtonSize = 'sm' | 'md';
export type IconButtonVariant = 'plain' | 'tinted' | 'filled' | 'destructive';

export interface IconButtonProps extends Omit<ComponentPropsWithoutRef<'button'>, 'aria-label' | 'children'> {
  /** Required by the type: an icon-only control must have an accessible name. */
  'aria-label': string;
  /** The glyph to render; always marked decorative. */
  icon: LucideIcon;
  /** `sm` is 36px (compact toolbars), `md` is the full 44×44 touch target. */
  size?: IconButtonSize;
  /** Visual style. Defaults to `plain`. */
  variant?: IconButtonVariant;
  /** Shows a `Spinner` in place of the glyph and disables the button. */
  loading?: boolean;
  /** Extra classes for the glyph, e.g. `size-5`. */
  iconClassName?: string;
}

const VARIANT_CLASSES: Record<IconButtonVariant, string> = {
  plain: 'bg-transparent text-tint',
  tinted: 'bg-tint-soft text-tint',
  filled: 'bg-tint text-tint-contrast',
  destructive: 'bg-danger text-on-tint',
};

const SIZE_CLASSES: Record<IconButtonSize, string> = {
  sm: 'size-9 rounded-ios',
  md: 'size-11 rounded-ios-md',
};

export function IconButton({
  icon: Icon,
  size = 'md',
  variant = 'plain',
  loading = false,
  iconClassName,
  disabled,
  className,
  type = 'button',
  ...rest
}: IconButtonProps) {
  const isDisabled = Boolean(disabled) || loading;

  return (
    <button
      type={type}
      disabled={isDisabled}
      aria-disabled={isDisabled || undefined}
      aria-busy={loading || undefined}
      className={cn(
        'inline-flex shrink-0 select-none items-center justify-center',
        'pressable disabled:pointer-events-none disabled:opacity-40',
        VARIANT_CLASSES[variant],
        SIZE_CLASSES[size],
        className,
      )}
      {...rest}
    >
      {loading ? (
        <Spinner size={size === 'md' ? 20 : 16} decorative />
      ) : (
        <Icon className={cn('size-[1.35em] shrink-0', iconClassName)} aria-hidden />
      )}
    </button>
  );
}
