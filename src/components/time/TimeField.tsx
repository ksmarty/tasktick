'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { TIME_INPUT_STEP_SECONDS } from '@/lib/dates';

/**
 * A clock time in five-minute steps.
 *
 * It exists because of one platform gap. Every editor used to hold a native
 * `<input type="time">` carrying `step={TIME_INPUT_STEP_SECONDS}`, which is the
 * correct HTML for a granularity limit — but **Safari on iOS does not implement
 * `min`, `max` or `step` on a time input**. The native minute wheel always lists
 * all sixty minutes, so on the one device this app is mostly used from, the
 * step attribute did nothing at all. The choices have to come from the control
 * itself, so the two halves of the time are two `Select`s — the app's own
 * primitive, which renders the same list everywhere and is already used inside
 * these sheets.
 *
 * The value is `HH:mm` in 24-hour form, the same string the native input
 * produced, so every caller keeps the conversion it already had. Only the hour
 * is labelled: the labels come from the device's own clock convention
 * (`Intl` with `hour: 'numeric'` gives `9 AM` in en-US and `09` in en-GB),
 * which is what the native control showed too, so the app's `timeFormat`
 * setting still has nothing to do with this field.
 *
 * An empty value renders both halves as placeholders; picking an hour completes
 * the time as `HH:00` — on the grid, and the predictable default — after which
 * the minutes can be refined. A value that is *not* on the grid (an event made
 * before this control existed, or one synced from another calendar) keeps its
 * minute as an extra option rather than being silently rounded.
 */
export function TimeField({
  id,
  value,
  onChange,
  disabled = false,
  ariaLabel,
  placeholder = 'Hour',
  className,
}: {
  /** Ties the hour trigger to a `<Label htmlFor>`, when the caller has one. */
  id?: string;
  /** `HH:mm`, or `''` when no time has been chosen yet. */
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  /** Names both halves for assistive tech: `<label> hour`, `<label> minutes`. */
  ariaLabel?: string;
  /** What the hour half reads before anything is chosen. */
  placeholder?: string;
  className?: string;
}) {
  const [hour = '', minute = ''] = value ? value.split(':') : [];

  const minuteOptions = React.useMemo(() => {
    const current = minute === '' ? Number.NaN : Number(minute);
    // Off-grid minutes are appended so an existing time is never rewritten
    // just by opening the editor.
    return Number.isFinite(current) && !GRID_MINUTES.includes(current)
      ? [...GRID_MINUTES, current].sort((a, b) => a - b)
      : GRID_MINUTES;
  }, [minute]);

  return (
    <div className={cn('flex items-center gap-1', className)}>
      <Select
        value={hour}
        onValueChange={(next) => onChange(`${next}:${minute === '' ? '00' : minute}`)}
        disabled={disabled}
      >
        <SelectTrigger
          id={id}
          aria-label={ariaLabel ? `${ariaLabel} hour` : undefined}
          className="w-16"
        >
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {HOUR_LABELS.map((label, index) => (
            <SelectItem key={label} value={pad(index)}>
              {label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={minute}
        onValueChange={(next) => onChange(`${hour}:${next}`)}
        disabled={disabled || hour === ''}
      >
        <SelectTrigger
          aria-label={ariaLabel ? `${ariaLabel} minutes` : undefined}
          className="w-12"
        >
          <SelectValue placeholder="Min" />
        </SelectTrigger>
        <SelectContent>
          {minuteOptions.map((option) => (
            <SelectItem key={option} value={pad(option)}>
              {pad(option)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/** `5` -> `05`, so every value in and out of the field is `HH:mm`. */
function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** The step is a duration in seconds; the field thinks in minutes. */
const STEP_MINUTES = TIME_INPUT_STEP_SECONDS / 60;

/** `00`, `05`, `10` … `55` — the only minutes this field can produce. */
const GRID_MINUTES = Array.from({ length: 60 / STEP_MINUTES }, (_, index) => index * STEP_MINUTES);

/**
 * `12 AM`, `1 AM`, … in a 12-hour locale; `00`, `01`, … in a 24-hour one.
 * Built once: the locale does not change under a running page.
 */
const HOUR_LABELS = Array.from({ length: 24 }, (_, hour) =>
  new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).format(new Date(2020, 0, 1, hour)),
);
