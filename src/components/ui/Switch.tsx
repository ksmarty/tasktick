'use client';

import { useId, type ComponentPropsWithoutRef, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface SwitchProps extends Omit<ComponentPropsWithoutRef<'button'>, 'onChange' | 'children' | 'type'> {
  /** Current state. */
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  /** Visible label. A string label also becomes the accessible name. */
  label?: ReactNode;
  /** Accessible name when `label` is missing or is not a plain string. */
  'aria-label'?: string;
  /** `sm` is 44×26 inside dense rows, `md` the standard iOS 51×31 control. */
  size?: 'sm' | 'md';
  className?: string;
}

const TRACK: Record<'sm' | 'md', string> = {
  sm: 'h-[26px] w-11',
  md: 'h-[31px] w-[51px]',
};

const KNOB: Record<'sm' | 'md', string> = {
  sm: 'size-[22px]',
  md: 'size-[27px]',
};

const OFFSET: Record<'sm' | 'md', { off: string; on: string }> = {
  sm: { off: 'translate-x-0.5', on: 'translate-x-[20px]' },
  md: { off: 'translate-x-0.5', on: 'translate-x-[22px]' },
};

/**
 * The iOS switch: a pill track with a white knob that slides across with a
 * spring-ish curve. Rendered as a real `<button role="switch">` with
 * `aria-checked`, so `Space`/`Enter` toggle it exactly like a checkbox.
 */
export function Switch({
  checked,
  onCheckedChange,
  disabled = false,
  label,
  size = 'md',
  className,
  onClick,
  ...rest
}: SwitchProps) {
  const labelId = useId();
  const accessibleName = typeof label === 'string' ? label : undefined;

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-labelledby={typeof label === 'string' ? labelId : undefined}
      aria-label={accessibleName ? undefined : rest['aria-label']}
      disabled={disabled}
      aria-disabled={disabled || undefined}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) onCheckedChange(!checked);
      }}
      className={cn(
        'inline-flex min-h-11 select-none items-center gap-3 disabled:pointer-events-none disabled:opacity-40',
        className,
      )}
      {...rest}
    >
      {label ? (
        <span id={labelId} className="text-body text-label">
          {label}
        </span>
      ) : null}
      <span
        aria-hidden
        className={cn(
          'relative ml-auto inline-block shrink-0 rounded-full transition-colors duration-200 ease-ios',
          TRACK[size],
          checked ? 'bg-success' : 'bg-fill',
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 left-0 rounded-full bg-on-tint shadow-ios-sm',
            'transition-transform duration-250 ease-ios-spring',
            KNOB[size],
            checked ? OFFSET[size].on : OFFSET[size].off,
          )}
        />
      </span>
    </button>
  );
}
