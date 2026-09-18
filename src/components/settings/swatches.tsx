'use client';

/**
 * The round colour swatch grid, shared by the accent picker and the calendar
 * colour picker.
 *
 * Both pickers offer the same twelve accents and have to look identical, so the
 * selected ring, the check mark and the disabled treatment live in one place
 * rather than being re-derived per picker and drifting. The previous version
 * existed because MUI's `ToggleButtonGroup` squares off the corners of the first
 * and last button to read as one track; here the swatches are ordinary buttons
 * in a `role="group"`, so there is nothing to undo — which is why the MUI `sx`
 * helpers this file used to export are gone.
 *
 * A swatch is not a segmented control: it carries no label and no text, so the
 * GodUI segmented control (which renders labelled `role="tab"` buttons) is not
 * the right primitive. `aria-pressed` on a labelled button inside a group is.
 */
import { CheckIcon } from '@svg-animated-icons/react/check';
import { ACCENT_LABEL, accentHex } from '@/lib/colors';
import { ACCENT_COLORS, type AccentColor } from '@/lib/types';
import { cn } from '@/lib/utils';

export interface AccentSwatchesProps {
  value: AccentColor;
  onChange?: (color: AccentColor) => void;
  /** Renders every swatch inert — used by the fixed-palette accent row. */
  disabled?: boolean;
  /** Use the dark-appearance value of each accent. */
  dark?: boolean;
  /** `id` of the element that labels the group, for `aria-labelledby`. */
  labelledBy?: string;
  className?: string;
}

export function AccentSwatches({
  value,
  onChange,
  disabled = false,
  dark = false,
  labelledBy,
  className,
}: AccentSwatchesProps) {
  return (
    <div role="group" aria-labelledby={labelledBy} className={cn('flex flex-wrap gap-2', className)}>
      {ACCENT_COLORS.map((color) => {
        const selected = color === value;
        return (
          <button
            key={color}
            type="button"
            aria-label={ACCENT_LABEL[color]}
            aria-pressed={selected}
            disabled={disabled}
            onClick={() => onChange?.(color)}
            className={cn(
              'inline-flex size-10 shrink-0 items-center justify-center rounded-full text-white shadow-xs outline-none transition focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
              selected
                ? 'ring-2 ring-foreground ring-offset-2 ring-offset-background'
                : 'ring-1 ring-inset ring-black/10',
              disabled ? 'cursor-not-allowed opacity-40' : 'cursor-pointer',
            )}
            /*
             * The colour is the one thing a class cannot carry: these are the
             * twelve palette values resolved at runtime by `accentHex`, not theme
             * tokens. Size, ring and spacing above are all classes.
             */
            style={{ backgroundColor: accentHex(color, dark) }}
          >
            {selected ? <CheckIcon /> : null}
          </button>
        );
      })}
    </div>
  );
}
