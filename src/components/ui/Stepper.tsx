'use client';

import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import { Minus, Plus } from 'lucide-react';
import { cn } from '@/lib/cn';

export interface StepperProps extends Omit<ComponentPropsWithoutRef<'div'>, 'onChange'> {
  value: number;
  onChange: (value: number) => void;
  /** Lower bound, inclusive. Default 0. */
  min?: number;
  /** Upper bound, inclusive. Default 99. */
  max?: number;
  /** Increment per press. Default 1. */
  step?: number;
  /** Accessible name for the group, e.g. "Estimate". */
  label?: string;
  disabled?: boolean;
  /** `md` is the 44px control, `sm` the 36px one for dense rows. */
  size?: 'sm' | 'md';
  /** Renders the value; defaults to the clamped number. */
  formatValue?: (value: number) => ReactNode;
}

/** Rounds away float drift (`0.1 + 0.2`), then clamps into `[min, max]`. */
function quantise(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value * 1e6) / 1e6));
}

/**
 * The iOS stepper: `−`, the value, `+`. The two buttons are separate real
 * buttons with their own accessible names, and each disables and dims itself
 * when the value is already at its bound, so the user can see which way is
 * still available.
 */
export function Stepper({
  value,
  onChange,
  min = 0,
  max = 99,
  step = 1,
  label,
  disabled = false,
  size = 'md',
  formatValue,
  className,
  ...rest
}: StepperProps) {
  const current = quantise(value, min, max);
  const canDecrease = !disabled && current > min;
  const canIncrease = !disabled && current < max;

  const buttonClasses = cn(
    'flex items-center justify-center bg-fill text-tint',
    'pressable disabled:pointer-events-none disabled:opacity-40',
    size === 'md' ? 'size-11 rounded-ios-md' : 'size-9 rounded-ios',
  );

  return (
    <div role="group" aria-label={label} className={cn('inline-flex items-center gap-2', className)} {...rest}>
      <button
        type="button"
        aria-label={label ? `Decrease ${label}` : 'Decrease'}
        disabled={!canDecrease}
        aria-disabled={!canDecrease || undefined}
        onClick={() => onChange(quantise(current - step, min, max))}
        className={buttonClasses}
      >
        <Minus className="size-[1.35em]" aria-hidden />
      </button>

      <output
        aria-live="polite"
        className={cn('tnum text-center text-body text-label', size === 'md' ? 'min-w-8' : 'min-w-6')}
      >
        {formatValue ? formatValue(current) : current}
      </output>

      <button
        type="button"
        aria-label={label ? `Increase ${label}` : 'Increase'}
        disabled={!canIncrease}
        aria-disabled={!canIncrease || undefined}
        onClick={() => onChange(quantise(current + step, min, max))}
        className={buttonClasses}
      >
        <Plus className="size-[1.35em]" aria-hidden />
      </button>
    </div>
  );
}
