'use client';

import * as React from 'react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { TIME_INPUT_STEP_SECONDS } from '@/lib/dates';

/**
 * A clock time: **one** field, and it is the browser's own time control.
 *
 * This replaced a pair of `Select`s (an hour and a minute). The pair existed for
 * one reason — Safari on iOS does not implement `min`/`max`/`step` on a time
 * input, so the native minute wheel lists all sixty minutes — but the cure cost
 * more than the disease: two controls per time, on every screen that has one,
 * and a picker that stopped being the platform picker. The user's call (it is
 * quoted in the request that produced this): one field, the built-in picker,
 * five-minute steps where the browser honours `step`, and the platform's own
 * sixty-minute wheel where it does not.
 *
 * So the value contract is unchanged — `HH:mm`, 24-hour, `''` for "no time yet"
 * — and `step={TIME_INPUT_STEP_SECONDS}` is still the correct HTML for a
 * granularity limit. Chrome, Edge, Firefox and Android honour it in the picker
 * and in arrow-key stepping; Safari on iOS shows every minute, which is the
 * behaviour the request accepted rather than the two-field workaround.
 */
export function TimeField({
  id,
  value,
  onChange,
  disabled = false,
  ariaLabel,
  placeholder = '',
  className,
}: {
  /** Ties the field to a `<Label htmlFor>`, when the caller has one. */
  id?: string;
  /** `HH:mm`, or `''` when no time has been chosen yet. */
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  /** The field's accessible name, when no `<label>` points at it. */
  ariaLabel?: string;
  /** Kept for the callers that pass it; the native field shows its own hint. */
  placeholder?: string;
  className?: string;
}) {
  /*
   * A time input's value is `HH:mm` while `step` is a whole minute or more, so
   * the string travels unchanged in both directions. A value the browser cannot
   * parse would blank the field, so anything unexpected is passed through
   * untouched and left for the user to correct rather than silently rewritten.
   */
  return (
    <Input
      id={id}
      type="time"
      step={TIME_INPUT_STEP_SECONDS}
      value={value}
      disabled={disabled}
      aria-label={ariaLabel}
      placeholder={placeholder || undefined}
      onChange={(event: React.ChangeEvent<HTMLInputElement>) => onChange(event.target.value)}
      className={cn('min-h-11 w-[7.5rem] tabular-nums', className)}
    />
  );
}
