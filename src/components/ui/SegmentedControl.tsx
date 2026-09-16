'use client';

import { useRef, type ComponentPropsWithoutRef, type KeyboardEvent, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';

export interface SegmentedOption<T extends string = string> {
  value: T;
  label: ReactNode;
  /** Optional glyph shown before the label. */
  icon?: LucideIcon;
  /** Accessible name for segments whose `label` is not a plain string. */
  ariaLabel?: string;
  disabled?: boolean;
}

export interface SegmentedControlProps<T extends string = string>
  extends Omit<ComponentPropsWithoutRef<'div'>, 'onChange'> {  options: readonly SegmentedOption<T>[];
  /** Currently selected value. Must match one of `options`. */
  value: T;
  onChange: (value: T) => void;
  /** `md` is 44px tall (full touch target), `sm` is the 36px compact variant. */
  size?: 'sm' | 'md';
  /** Accessible name for the whole group. */
  label?: string;
  className?: string;
}

const TRACK_SIZE: Record<'sm' | 'md', string> = {
  sm: 'h-9 p-0.5 text-footnote',
  md: 'h-11 p-0.5 text-subhead',
};

/**
 * The iOS segmented control: a grey track with a white thumb that slides under
 * the selected segment. Implemented as a `radiogroup` of buttons — arrow keys
 * move the selection, and `aria-checked` carries the state, which is what a
 * "choose one of these" control actually is (no tab panel exists).
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  size = 'md',
  label,
  className,
  style,
  ...rest
}: SegmentedControlProps<T>) {
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const selectedIndex = options.findIndex((option) => option.value === value);

  function move(delta: number) {
    if (options.length === 0) return;
    const enabled = options
      .map((option, index) => ({ option, index }))
      .filter(({ option }) => !option.disabled);
    if (enabled.length === 0) return;

    const current = enabled.findIndex(({ index }) => index === selectedIndex);
    const next = enabled[(((current < 0 ? 0 : current) + delta) % enabled.length + enabled.length) % enabled.length];
    onChange(next.option.value);
    itemRefs.current[next.index]?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        event.preventDefault();
        move(1);
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        event.preventDefault();
        move(-1);
        break;
      default:
        break;
    }
  }

  return (
    <div
      role="radiogroup"
      aria-label={label}
      onKeyDown={onKeyDown}
      {...rest}
      className={cn('relative grid items-stretch rounded-ios bg-fill-tertiary', TRACK_SIZE[size], className)}
      style={{ gridTemplateColumns: `repeat(${Math.max(options.length, 1)}, minmax(0, 1fr))`, ...style }}
    >
      {/* The sliding thumb. */}
      <span
        aria-hidden
        className={cn(
          'pointer-events-none absolute top-0.5 bottom-0.5 left-0 rounded-ios-sm bg-elevated shadow-ios-sm',
          'transition-transform duration-200 ease-ios-out',
        )}
        style={{
          width: `calc((100% - 0.25rem) / ${Math.max(options.length, 1)})`,
          transform: `translateX(${Math.max(selectedIndex, 0) * 100}%)`,
        }}
      />

      {options.map((option, index) => {
        const selected = option.value === value;
        const Icon = option.icon;

        return (
          <button
            key={option.value}
            ref={(node) => {
              itemRefs.current[index] = node;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={typeof option.label === 'string' ? undefined : option.ariaLabel}
            disabled={option.disabled}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(option.value)}
            className={cn(
              'relative z-10 flex min-w-0 items-center justify-center gap-1.5 rounded-ios-sm px-2',
              'select-none transition-colors duration-150 ease-ios',
              selected ? 'font-semibold text-label' : 'text-label',
              option.disabled ? 'opacity-40' : 'pressable',
            )}
          >
            {Icon ? <Icon className="size-4 shrink-0" aria-hidden /> : null}
            <span className="truncate">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
