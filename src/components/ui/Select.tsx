'use client';

import { useEffect, useRef, useState, type ComponentPropsWithoutRef, type KeyboardEvent, type ReactNode } from 'react';
import { Check, ChevronsUpDown, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Sheet } from './Sheet';
import { useIsTouch } from './internal';

export interface SelectOption {
  value: string;
  label: string;
  icon?: LucideIcon;
  disabled?: boolean;
}

export interface SelectProps extends Omit<ComponentPropsWithoutRef<'div'>, 'onChange'> {
  /** Current value, or `null` when nothing is chosen yet. */
  value: string | null;
  onChange: (value: string) => void;
  options: readonly SelectOption[];
  /** Shown when `value` is null. */
  placeholder?: string;
  /** Accessible name for the control. */
  label?: string;
  /** Heading of the touch picker sheet. Defaults to `label`. */
  sheetTitle?: ReactNode;
  disabled?: boolean;
  id?: string;
}

/**
 * A picker that feels native on both input types.
 *
 * On a touch device (`hover: none` and a coarse pointer) it opens a bottom sheet
 * listing the options with the current one check-marked, which is what iOS does
 * and what a finger expects. Everywhere else — desktop, keyboard-only, screen
 * readers — it renders a real `<select>`, so type-ahead, the platform menu and
 * the accessibility tree all behave the way the user already knows. Both paths
 * are operable by keyboard: the sheet listbox supports arrows, Home/End,
 * Enter/Space and Escape.
 */
export function Select({
  value,
  onChange,
  options,
  placeholder = 'Choose…',
  label,
  sheetTitle,
  disabled = false,
  className,
  id,
  ...rest
}: SelectProps) {
  const isTouch = useIsTouch();
  const [open, setOpen] = useState(false);
  const selectedIndex = options.findIndex((option) => option.value === value);
  const [activeIndex, setActiveIndex] = useState(Math.max(selectedIndex, 0));
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const selected = selectedIndex >= 0 ? options[selectedIndex] : null;

  useEffect(() => {
    if (!open) return;
    setActiveIndex(Math.max(selectedIndex, 0));
  }, [open, selectedIndex]);

  useEffect(() => {
    if (!open) return;
    optionRefs.current[activeIndex]?.focus();
  }, [open, activeIndex]);

  function choose(option: SelectOption) {
    if (option.disabled) return;
    onChange(option.value);
    setOpen(false);
  }

  function move(delta: number) {
    if (options.length === 0) return;
    let next = activeIndex;
    for (let step = 0; step < options.length; step += 1) {
      next = (next + delta + options.length) % options.length;
      if (!options[next].disabled) break;
    }
    setActiveIndex(next);
  }

  function onListKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        move(1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        move(-1);
        break;
      case 'Home':
        event.preventDefault();
        setActiveIndex(0);
        break;
      case 'End':
        event.preventDefault();
        setActiveIndex(options.length - 1);
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        if (options[activeIndex]) choose(options[activeIndex]);
        break;
      default:
        break;
    }
  }

  if (!isTouch) {
    return (
      <div className={cn('relative w-full', className)} {...rest}>
        <select
          id={id}
          value={value ?? ''}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled}
          aria-label={label}
          className={cn(
            'min-h-11 w-full appearance-none rounded-ios-md bg-elevated px-3 pr-9 text-body text-label',
            'outline-none focus-visible:ring-2 focus-visible:ring-tint disabled:opacity-40',
          )}
        >
          {placeholder ? (
            <option value="" disabled>
              {placeholder}
            </option>
          ) : null}
          {options.map((option) => (
            <option key={option.value} value={option.value} disabled={option.disabled}>
              {option.label}
            </option>
          ))}
        </select>
        <ChevronsUpDown
          className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-tertiary"
          aria-hidden
        />
      </div>
    );
  }

  return (
    <div className={cn('w-full', className)} {...rest}>
      <button
        id={id}
        type="button"
        disabled={disabled}
        aria-disabled={disabled || undefined}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label}
        onClick={() => setOpen(true)}
        className={cn(
          'flex min-h-11 w-full items-center gap-2 rounded-ios-md bg-elevated px-3 text-left text-body',
          'pressable-row outline-none focus-visible:ring-2 focus-visible:ring-tint disabled:opacity-40',
        )}
      >
        {selected?.icon ? <selected.icon className="size-5 shrink-0 text-tint" aria-hidden /> : null}
        <span className={cn('min-w-0 flex-1 truncate', selected ? 'text-label' : 'text-tertiary')}>
          {selected?.label ?? placeholder}
        </span>
        <ChevronsUpDown className="size-4 shrink-0 text-tertiary" aria-hidden />
      </button>

      <Sheet open={open} onOpenChange={setOpen} title={sheetTitle ?? label} dismissible>
        <div role="listbox" aria-label={label} onKeyDown={onListKeyDown} className="pb-2">
          {options.map((option, index) => {
            const Icon = option.icon;
            const isSelected = option.value === value;
            return (
              <button
                key={option.value}
                ref={(node) => {
                  optionRefs.current[index] = node;
                }}
                type="button"
                role="option"
                aria-selected={isSelected}
                disabled={option.disabled}
                tabIndex={index === activeIndex ? 0 : -1}
                onClick={() => choose(option)}
                className={cn(
                  'flex min-h-11 w-full items-center gap-3 rounded-ios px-3 text-left text-body',
                  isSelected ? 'font-semibold text-tint' : 'text-label',
                  option.disabled ? 'opacity-40' : 'pressable-row',
                )}
              >
                {Icon ? <Icon className="size-5 shrink-0 text-tint" aria-hidden /> : null}
                <span className="min-w-0 flex-1 truncate">{option.label}</span>
                {isSelected ? <Check className="size-5 shrink-0 text-tint" aria-hidden /> : null}
              </button>
            );
          })}
        </div>
      </Sheet>
    </div>
  );
}
