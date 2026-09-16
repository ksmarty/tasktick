'use client';

import { useRef, type ComponentPropsWithoutRef, type KeyboardEvent } from 'react';
import { Check } from 'lucide-react';
import { ACCENT_LABEL, accentVar } from '@/lib/colors';
import { cn } from '@/lib/cn';
import { ACCENT_COLORS, type AccentColor } from '@/lib/types';

export interface ColorPickerProps extends Omit<ComponentPropsWithoutRef<'div'>, 'onChange'> {
  value: AccentColor;
  onChange: (color: AccentColor) => void;
  /** Accessible name for the group. Defaults to "Accent colour". */
  label?: string;
  /** Swatches to offer. Defaults to all twelve accents. */
  colors?: readonly AccentColor[];
  /** `md` is the 44px swatch, `sm` the 32px one. */
  size?: 'sm' | 'md';
}

const SIZE_CLASSES = {
  sm: 'size-8',
  md: 'size-11',
} as const;

/**
 * The twelve accent swatches in a grid, with the current one check-marked and
 * labelled from `ACCENT_LABEL`. A radiogroup: arrows move between swatches and
 * `aria-checked` carries the state.
 */
export function ColorPicker({
  value,
  onChange,
  label = 'Accent colour',
  colors = ACCENT_COLORS,
  size = 'md',
  className,
  ...rest
}: ColorPickerProps) {
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const selectedIndex = Math.max(
    colors.findIndex((color) => color === value),
    0,
  );

  function move(delta: number) {
    if (colors.length === 0) return;
    const next = (selectedIndex + delta + colors.length) % colors.length;
    onChange(colors[next]);
    itemRefs.current[next]?.focus();
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
      className={cn('grid grid-cols-6 gap-2', className)}
      {...rest}
    >
      {colors.map((color, index) => {
        const selected = color === value;
        return (
          <button
            key={color}
            ref={(node) => {
              itemRefs.current[index] = node;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={ACCENT_LABEL[color]}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(color)}
            style={{ backgroundColor: accentVar(color) }}
            className={cn(
              'flex items-center justify-center rounded-full text-on-tint',
              'ring-offset-2 ring-offset-bg pressable',
              SIZE_CLASSES[size],
              selected ? 'ring-2 ring-label' : 'ring-0',
            )}
          >
            {selected ? <Check className="size-5" aria-hidden /> : null}
          </button>
        );
      })}
    </div>
  );
}
