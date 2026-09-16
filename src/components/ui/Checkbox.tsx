'use client';

import { useId, type ComponentPropsWithoutRef, type ReactNode } from 'react';
import { Check, Minus } from 'lucide-react';
import { cn } from '@/lib/cn';

export interface CheckboxProps extends Omit<ComponentPropsWithoutRef<'button'>, 'onChange' | 'children' | 'type'> {
  /** Checked state. This control is boolean by design — the tri-state task
   * checkbox (`wont_do`) is a feature-level `StatusCheckbox` built on top. */
  checked: boolean;
  onCheckedChange?: (checked: boolean) => void;
  /** Renders the mixed state: `aria-checked="mixed"` plus a dash glyph. */
  indeterminate?: boolean;
  disabled?: boolean;
  /** Visible label. A string label also becomes the accessible name. */
  label?: ReactNode;
  /** Accessible name when `label` is missing or is not a plain string. */
  'aria-label'?: string;
  /** `sm` is 20px (dense rows), `md` the standard 22px task circle. */
  size?: 'sm' | 'md';
  className?: string;
}

const CIRCLE: Record<'sm' | 'md', string> = {
  sm: 'size-5',
  md: 'size-[22px]',
};

const GLYPH: Record<'sm' | 'md', string> = {
  sm: 'size-3',
  md: 'size-3.5',
};

/**
 * The circular iOS task checkbox: an empty grey ring when off, a tinted disc
 * with a white tick when on. The circle itself is 22px, but the button around
 * it is at least 44px tall so it stays finger-sized when used bare.
 */
export function Checkbox({
  checked,
  onCheckedChange,
  indeterminate = false,
  disabled = false,
  label,
  size = 'md',
  className,
  onClick,
  ...rest
}: CheckboxProps) {
  const labelId = useId();
  const accessibleName = typeof label === 'string' ? label : undefined;
  const filled = checked || indeterminate;

  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={indeterminate ? 'mixed' : checked}
      aria-labelledby={typeof label === 'string' ? labelId : undefined}
      aria-label={accessibleName ? undefined : rest['aria-label']}
      disabled={disabled}
      aria-disabled={disabled || undefined}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) onCheckedChange?.(!checked);
      }}
      className={cn(
        'inline-flex min-h-11 select-none items-center gap-3 disabled:pointer-events-none disabled:opacity-40',
        className,
      )}
      {...rest}
    >
      <span
        aria-hidden
        className={cn(
          'flex shrink-0 items-center justify-center rounded-full border-[1.5px] transition-colors duration-150 ease-ios',
          CIRCLE[size],
          filled ? 'border-tint bg-tint text-on-tint' : 'border-separator-opaque bg-transparent',
        )}
      >
        {indeterminate ? (
          <Minus className={cn(GLYPH[size], 'stroke-[3]')} />
        ) : checked ? (
          <Check className={cn(GLYPH[size], 'stroke-[3]')} />
        ) : null}
      </span>
      {label ? (
        <span id={labelId} className="text-body text-label">
          {label}
        </span>
      ) : null}
    </button>
  );
}
