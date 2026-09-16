'use client';

import { useEffect, useRef, useState, type ComponentPropsWithoutRef, type KeyboardEvent, type ReactNode } from 'react';
import { Calendar, Check, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Sheet } from './Sheet';
import {
  clampDateOnly,
  compareDateOnly,
  formatDateLong,
  formatMonthLabel,
  monthGrid,
  moveGridFocus,
  parseDateOnly,
  quickDateOptions,
  shiftMonth,
  todayDateOnly,
  type GridMoveKey,
} from './date-field';
import type { DateOnly } from '@/lib/types';

/** Weekday initials, rotated to the user's `weekStartsOn`. */
const WEEKDAY_INITIALS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'] as const;

const GRID_KEYS: readonly GridMoveKey[] = [
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'Home',
  'End',
  'PageUp',
  'PageDown',
];

export interface DateFieldProps extends Omit<ComponentPropsWithoutRef<'div'>, 'onChange'> {
  /** Current floating day, or `null` when unset. */
  value: DateOnly | null;
  onChange: (value: DateOnly) => void;
  /** Caption on the row and heading of the picker. */
  label?: ReactNode;
  /** Shown when `value` is null. */
  placeholder?: string;
  /** Earliest selectable day, inclusive. */
  min?: DateOnly;
  /** Latest selectable day, inclusive. */
  max?: DateOnly;
  /** First day of the week, 0 = Sunday. Default 1 (Monday). */
  weekStartsOn?: number;
  disabled?: boolean;
  /** Adds a "Clear" action to the picker. */
  clearable?: boolean;
  onClear?: () => void;
  /** Overrides "today" — injectable so the picker is testable and reviewable. */
  today?: DateOnly;
  id?: string;
}

/**
 * iOS-style inline date picker driving a floating `YYYY-MM-DD` string.
 *
 * The value never leaves the calendar-day domain: the quick choices are plain
 * day arithmetic and the grid is string-based (see `./date-field`), so a
 * timezone can never shift a date by one. Keyboard: arrows move a day/week,
 * Home/End jump to the week's ends, PageUp/PageDown change month, Enter/Space
 * selects, Escape closes — and focus returns to the field afterwards, which the
 * `Sheet` handles.
 */
export function DateField({
  value,
  onChange,
  label,
  placeholder = 'No date',
  min,
  max,
  weekStartsOn = 1,
  disabled = false,
  clearable = false,
  onClear,
  today,
  className,
  id,
  ...rest
}: DateFieldProps) {
  const anchorToday = today ?? todayDateOnly();
  const initial = clampDateOnly(value ?? anchorToday, min, max);
  const [open, setOpen] = useState(false);
  const [focusDate, setFocusDate] = useState<DateOnly>(initial);
  const [visibleMonth, setVisibleMonth] = useState(() => monthOf(initial));
  const dayRefs = useRef(new Map<DateOnly, HTMLButtonElement>());

  // Re-centre the grid on every open (not on every value change, which would
  // fight the user while they navigate).
  useEffect(() => {
    if (!open) return;
    const start = clampDateOnly(value ?? anchorToday, min, max);
    setFocusDate(start);
    setVisibleMonth(monthOf(start));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- open is the trigger that matters.
  }, [open]);

  // Keep the roving focus on whichever day the keyboard is pointing at.
  useEffect(() => {
    if (!open) return;
    dayRefs.current.get(focusDate)?.focus({ preventScroll: true });
  }, [open, focusDate, visibleMonth]);

  const cells = monthGrid(visibleMonth.year, visibleMonth.month, weekStartsOn);
  const weekdayLabels = Array.from(
    { length: 7 },
    (_, index) => WEEKDAY_INITIALS[(index + weekStartsOn) % 7],
  );
  const quickOptions = quickDateOptions(anchorToday);

  function isDisabled(date: DateOnly): boolean {
    if (min && compareDateOnly(date, min) < 0) return true;
    if (max && compareDateOnly(date, max) > 0) return true;
    return false;
  }

  function commit(date: DateOnly) {
    if (isDisabled(date)) return;
    onChange(date);
    setOpen(false);
  }

  function moveFocusBy(key: GridMoveKey, date: DateOnly) {
    const next = clampDateOnly(moveGridFocus(date, key, weekStartsOn), min, max);
    setFocusDate(next);
    const parts = parseDateOnly(next);
    if (parts) setVisibleMonth({ year: parts.year, month: parts.month });
  }

  function onGridKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const key = event.key as GridMoveKey;
    if (!GRID_KEYS.includes(key)) return;
    event.preventDefault();
    moveFocusBy(key, focusDate);
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
        <Calendar className="size-5 shrink-0 text-tint" aria-hidden />
        <span className={cn('min-w-0 flex-1 truncate', value ? 'text-label' : 'text-tertiary')}>
          {value ? formatDateLong(value) : placeholder}
        </span>
        <ChevronRight className="size-4 shrink-0 text-tertiary" aria-hidden />
      </button>

      <Sheet open={open} onOpenChange={setOpen} title={label ?? 'Choose a date'} dismissible>
        <div className="pb-2" onKeyDown={onGridKeyDown}>
          <div className="grouped mb-4">
            {quickOptions.map((option, index) => {
              const selected = value === option.date;
              const disabledQuick = isDisabled(option.date);
              return (
                <button
                  key={option.choice}
                  type="button"
                  disabled={disabledQuick}
                  aria-disabled={disabledQuick || undefined}
                  onClick={() => commit(option.date)}
                  className={cn(
                    'flex min-h-11 w-full items-center gap-3 px-4 text-left text-body',
                    'disabled:opacity-40',
                    !disabledQuick && 'pressable-row',
                    index > 0 && 'hairline-t',
                    selected ? 'font-semibold text-tint' : 'text-label',
                  )}
                >
                  <span className="min-w-0 flex-1 truncate">{option.label}</span>
                  <span className="shrink-0 text-footnote text-tertiary">{formatDateLong(option.date)}</span>
                  {selected ? <Check className="size-5 shrink-0 text-tint" aria-hidden /> : null}
                </button>
              );
            })}
          </div>

          <div className="mb-2 flex items-center justify-between gap-2">
            <button
              type="button"
              aria-label="Previous month"
              onClick={() => setVisibleMonth((current) => shiftMonth(current.year, current.month, -1))}
              className="flex size-11 items-center justify-center rounded-ios text-tint pressable"
            >
              <ChevronLeft className="size-5" aria-hidden />
            </button>
            <h3 aria-live="polite" className="text-headline font-semibold text-label">
              {formatMonthLabel(visibleMonth.year, visibleMonth.month)}
            </h3>
            <button
              type="button"
              aria-label="Next month"
              onClick={() => setVisibleMonth((current) => shiftMonth(current.year, current.month, 1))}
              className="flex size-11 items-center justify-center rounded-ios text-tint pressable"
            >
              <ChevronRight className="size-5" aria-hidden />
            </button>
          </div>

          <div className="grid grid-cols-7 gap-y-1" role="group" aria-label="Calendar days">
            {weekdayLabels.map((weekday, index) => (
              <span
                key={`${weekday}-${index}`}
                aria-hidden
                className="flex h-6 items-center justify-center text-caption-1 text-tertiary"
              >
                {weekday}
              </span>
            ))}

            {cells.map((cell) => {
              const selected = cell.date === value;
              const isToday = cell.date === anchorToday;
              const cellDisabled = isDisabled(cell.date);

              return (
                <button
                  key={cell.date}
                  ref={(node) => {
                    if (node) dayRefs.current.set(cell.date, node);
                    else dayRefs.current.delete(cell.date);
                  }}
                  type="button"
                  tabIndex={cell.date === focusDate ? 0 : -1}
                  disabled={cellDisabled}
                  aria-disabled={cellDisabled || undefined}
                  aria-pressed={selected}
                  aria-current={isToday ? 'date' : undefined}
                  aria-label={formatDateLong(cell.date)}
                  onClick={() => commit(cell.date)}
                  className={cn(
                    'tnum mx-auto flex size-9 items-center justify-center rounded-full text-body',
                    cellDisabled && 'opacity-40',
                    !cellDisabled && 'pressable',
                    !cell.inMonth && 'text-tertiary',
                    cell.inMonth && !selected && 'text-label',
                    selected && 'bg-tint font-semibold text-tint-contrast',
                    isToday && !selected && 'font-semibold text-tint',
                  )}
                >
                  {parseDateOnly(cell.date)?.day}
                </button>
              );
            })}
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

function monthOf(date: DateOnly): { year: number; month: number } {
  const parts = parseDateOnly(date);
  return parts ? { year: parts.year, month: parts.month } : { year: 1970, month: 1 };
}
