import type { ComponentPropsWithoutRef } from 'react';
import { cn } from '@/lib/cn';

export interface SkeletonProps extends ComponentPropsWithoutRef<'div'> {
  /** `text` is a one-line block, `rect` a card/surface, `circle` an avatar. */
  variant?: 'text' | 'rect' | 'circle';
  /** Number of stacked lines for `variant="text"`. Ignored for the other variants. */
  lines?: number;
}

const VARIANT_CLASSES = {
  text: 'h-4 rounded-ios-sm',
  rect: 'rounded-ios-md',
  circle: 'rounded-full',
} as const;

/**
 * Shimmering placeholder shown while data is loading. `aria-hidden` by
 * definition — a skeleton is a stand-in for content that is about to be
 * announced properly, and screen readers should not read it.
 */
export function Skeleton({ variant = 'text', lines = 1, className, ...rest }: SkeletonProps) {
  if (variant !== 'text' || lines <= 1) {
    return (
      <div
        aria-hidden
        className={cn('animate-pulse bg-fill', VARIANT_CLASSES[variant], variant === 'circle' && 'size-10', className)}
        {...rest}
      />
    );
  }

  return (
    <div aria-hidden className={cn('space-y-2', className)} {...rest}>
      {Array.from({ length: lines }, (_, index) => (
        <div
          key={index}
          className={cn('animate-pulse bg-fill', VARIANT_CLASSES.text, index === lines - 1 && 'w-2/3')}
        />
      ))}
    </div>
  );
}
