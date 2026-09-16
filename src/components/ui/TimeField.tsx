'use client';

import { useEffect, useRef, useState, type ComponentPropsWithoutRef, type KeyboardEvent, type ReactNode } from 'react';
import { Check, ChevronRight, Clock } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Divider } from './Divider';
import { Sheet } from './Sheet';
import { dayPartOptions, formatTimeLong, listHours, listMinutes, parseTimeOnly, snapTimeToStep } from './time-field';
import type { TimeOnly } from '@/lib/types';

/** Height of one wheel row; the columns scroll-centre on multiples of it. */
const ITEM_HEIGHT = 44;
/** Where the picker starts when the field is empty. */
const DEFAULT_TIME: TimeOnly = '09:00';

export interface TimeFieldProps extends Omit<ComponentPropsWithoutRef<'div'>, 'onChange'> {
  /** Current floating clock time, or `null` when unset. */
  value: TimeOnly | null;
  onChange: (value: TimeOnly) => void;
  /** Caption on the row and heading of the picker. */
  label?: ReactNode;
  /** Shown when `value` is null. */
  placeholder?: string;
  /** Minute granularity of the wheel. Default 5. */
  minuteStep?: number;
  /** How the row renders the value. Default `24h`. */
  format?: '12h' | '24h';
  disabled?: boolean;
  /** Adds a "Clear" action to the picker. */
  clearable?: boolean;
  onClear?: () => void;
  id?: string;
}

/**
 * iOS-style time picker driving a floating `HH:mm` string.
 *
 * Two scroll-snap wheels (hours, minutes) plus the day-part shortcuts. Like
 * `DateField` this is a wall-clock value, never an instant: minutes are snapped
 * to the configured step and nothing is converted to or from a timezone.
 * Keyboard: arrows change the highlighted item, Enter selects, Escape closes.
 */
export function TimeField({
  value,
  onChange,
  label,
  placeholder = 'No time',
  minuteStep = 5,
  format = '24h',
  disabled = false,
  clearable = false,
  onClear,
  className,
  id,
  ...rest
}: TimeFieldProps) {
  const [open, setOpen] = useState(false);
  const hourColumnRef = useRef<HTMLDivElement>(null);
  const minuteColumnRef = useRef<HTMLDivElement>(null);
  const hourRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const minuteRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const pendingFocus = useRef<'hour' | 'minute' | null>(null);

  const hours = listHours();
  const minutes = listMinutes(minuteStep);
  const snapped = value ? snapTimeToStep(value, minuteStep) : null;
  const parts = parseTimeOnly(snapped) ?? parseTimeOnly(DEFAULT_TIME) ?? { hour: 9, minute: 0 };
  const minuteIndex = Math.max(
    minutes.findIndex((minute) => minute >= parts.minute),
    0,
  );

  // Centre the wheels on the current value each time the sheet opens.
  useEffect(() => {
    if (!open) return;
    for (const [column, index] of [
      [hourColumnRef.current, parts.hour],
      [minuteColumnRef.current, minuteIndex],
    ] as const) {
      if (!column) continue;
      column.scrollTop = Math.max(0, index * ITEM_HEIGHT - (column.clientHeight - ITEM_HEIGHT) / 2);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-centre on open only.
  }, [open]);

  // Move DOM focus with the highlighted item after a keyboard change.
  useEffect(() => {
    if (pendingFocus.current === 'hour') hourRefs.current[parts.hour]?.focus({ preventScroll: true });
    if (pendingFocus.current === 'minute') minuteRefs.current[minuteIndex]?.focus({ preventScroll: true });
    pendingFocus.current = null;
  });

  function commit(hour: number, minute: number) {
    const hh = String(hour).padStart(2, '0');
    const mm = String(minute).padStart(2, '0');
    onChange(`${hh}:${mm}`);
  }

  function onWheelKeyDown(event: KeyboardEvent<HTMLDivElement>, column: 'hour' | 'minute') {
    const delta = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0;
    if (delta === 0) return;

    event.preventDefault();
    pendingFocus.current = column;
    if (column === 'hour') {
      const next = (parts.hour + delta + hours.length) % hours.length;
      commit(next, minutes[minuteIndex]);
    } else {
      const next = (minuteIndex + delta + minutes.length) % minutes.length;
      commit(parts.hour, minutes[next]);
    }
  }

  return (
    <div className={cn('w-full', className)} {...rest}>
      {label ? (
        <span className="mb-1.5 block px-1 text-footnote text-secondary" id={id ? `${id}-label` : undefined}>
          {label}
        </span>
      ) : null}

      <button
        id={id}
        type="button"
        disabled={disabled}
        aria-disabled={disabled || undefined}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-labelledby={label && id ? `${id}-label` : undefined}
        onClick={() => setOpen(true)}
        className={cn(
          'flex min-h-11 w-full items-center gap-2 rounded-ios-md bg-elevated px-3 text-left text-body',
          'pressable-row disabled:opacity-40',
        )}
      >
        <Clock className="size-5 shrink-0 text-tint" aria-hidden />
        <span className={cn('tnum min-w-0 flex-1 truncate', value ? 'text-label' : 'text-tertiary')}>
          {value ? formatTimeLong(value, format) : placeholder}
        </span>
        <ChevronRight className="size-4 shrink-0 text-tertiary" aria-hidden />
      </button>

      <Sheet open={open} onOpenChange={setOpen} title={label ?? 'Choose a time'} dismissible>
        <div className="pb-2">
          <div className="mb-4 flex flex-wrap gap-2">
            {dayPartOptions().map((option) => {
              const selected = snapped === option.time;
              return (
                <button
                  key={option.label}
                  type="button"
                  onClick={() => onChange(option.time)}
                  className={cn(
                    'flex h-9 items-center gap-1 rounded-full px-3 text-subhead pressable',
                    selected ? 'bg-tint text-tint-contrast' : 'bg-fill-tertiary text-label',
                  )}
                >
                  {selected ? <Check className="size-4" aria-hidden /> : null}
                  {option.label}
                </button>
              );
            })}
          </div>

          <div className="grouped flex h-56">
            <div
              ref={hourColumnRef}
              role="listbox"
              aria-label="Hour"
              onKeyDown={(event) => onWheelKeyDown(event, 'hour')}
              className="scroll-ios flex-1 snap-y snap-mandatory overflow-y-auto py-[calc(50%-1.375rem)]"
            >
              {hours.map((hour, index) => {
                const selected = hour === parts.hour;
                return (
                  <button
                    key={hour}
                    ref={(node) => {
                      hourRefs.current[index] = node;
                    }}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    tabIndex={selected ? 0 : -1}
                    onClick={() => commit(hour, minutes[minuteIndex])}
                    style={{ height: ITEM_HEIGHT }}
                    className={cn(
                      'tnum flex w-full snap-center items-center justify-center text-title-3',
                      selected ? 'font-semibold text-label' : 'text-tertiary',
                    )}
                  >
                    {String(hour).padStart(2, '0')}
                  </button>
                );
              })}
            </div>

            <Divider orientation="vertical" />

            <div
              ref={minuteColumnRef}
              role="listbox"
              aria-label="Minute"
              onKeyDown={(event) => onWheelKeyDown(event, 'minute')}
              className="scroll-ios flex-1 snap-y snap-mandatory overflow-y-auto py-[calc(50%-1.375rem)]"
            >
              {minutes.map((minute, index) => {
                const selected = index === minuteIndex;
                return (
                  <button
                    key={minute}
                    ref={(node) => {
                      minuteRefs.current[index] = node;
                    }}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    tabIndex={selected ? 0 : -1}
                    onClick={() => commit(parts.hour, minute)}
                    style={{ height: ITEM_HEIGHT }}
                    className={cn(
                      'tnum flex w-full snap-center items-center justify-center text-title-3',
                      selected ? 'font-semibold text-label' : 'text-tertiary',
                    )}
                  >
                    {String(minute).padStart(2, '0')}
                  </button>
                );
              })}
            </div>
          </div>

          {clearable && value ? (
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onClear?.();
              }}
              className="mt-4 flex min-h-11 w-full items-center justify-center rounded-ios-lg bg-elevated text-body text-danger pressable"
            >
              Clear
            </button>
          ) : null}
        </div>
      </Sheet>
    </div>
  );
}
