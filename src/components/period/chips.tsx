'use client';

/**
 * The chips the period screens are made of.
 *
 * Every field on a day log is one of a small closed set — five flow levels, four
 * LH results, five mucus types, a mood, a symptom — and the whole point of the
 * log screen is that recording one takes a tap and no scrolling. So the control
 * for each is a row of pill chips rather than a `Select`: a native picker on iOS
 * costs a modal, a wheel and a Done, which is three interactions for one ordinal
 * value.
 *
 * ## Why buttons and not a radio group
 *
 * These are push buttons with `aria-pressed`, not radios. A radio group implies
 * an exclusive, required choice made once; most of these fields are optional and
 * the user must be able to *un-set* one (tapping the selected chip clears it), and
 * "none" for flow is a real recorded value rather than the absence of one. The
 * `role="group"` plus an accessible name on the row is what tells a screen reader
 * these belong together.
 *
 * ## The 44px target
 *
 * The pills are `h-9` (36px) — small enough that five fit one line at 390px — and
 * carry a 2px `after:` overlay, which takes the touch target to 40px without
 * changing the painted size. This is the same trick `HeaderActionButton` uses in
 * the task lists, for the same reason.
 */
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface ChoiceChipProps {
  label: string;
  selected: boolean;
  onClick: () => void;
  /** Optional fuller name for assistive tech when the chip's own text is short. */
  ariaLabel?: string;
}

/** One pill. `outline` when off, `default` (the filled primary) when on. */
export function ChoiceChip({ label, selected, onClick, ariaLabel }: ChoiceChipProps) {
  return (
    <Button
      type="button"
      size="sm"
      variant={selected ? 'default' : 'outline'}
      aria-pressed={selected}
      aria-label={ariaLabel}
      onClick={onClick}
      className={cn('relative h-9 rounded-full px-3 after:absolute after:-inset-0.5')}
    >
      {label}
    </Button>
  );
}

export interface ChipRowProps {
  /** The group's accessible name, e.g. "Flow". */
  label: string;
  options: readonly string[];
  labels: Record<string, string>;
  /** The selected value, or null for "not logged". */
  value: string | null;
  /** Called with the tapped value, or null when the selected chip is tapped again. */
  onChange: (next: string | null) => void;
  /** Set false when the field always has a value and cannot be cleared. */
  clearable?: boolean;
  className?: string;
}

/**
 * One exclusive row: flow, mood, LH test, mucus, a contraception day's status.
 *
 * Tapping the selected chip clears the field, which is the one gesture that makes
 * an optional single-select usable on a phone — the alternative is a separate
 * "clear" control nobody finds.
 */
export function ChipRow({ label, options, labels, value, onChange, clearable = true, className }: ChipRowProps) {
  return (
    <div role="group" aria-label={label} className={cn('flex flex-wrap gap-2', className)}>
      {options.map((option) => {
        const selected = value === option;
        return (
          <ChoiceChip
            key={option}
            label={labels[option] ?? option}
            selected={selected}
            onClick={() => onChange(selected && clearable ? null : option)}
          />
        );
      })}
    </div>
  );
}

export interface ChipMultiRowProps {
  /** The group's accessible name, e.g. "Symptoms". */
  label: string;
  options: readonly string[];
  /** Display names; a value with no entry falls back to `humanise`-style text. */
  labels?: Record<string, string>;
  values: string[];
  onToggle: (value: string) => void;
  className?: string;
}

/**
 * One multi-select row: symptoms and mood.
 *
 * Tapping toggles, so the chip's own state is the record — no separate "save",
 * and no ordering rule for the user to learn.
 */
export function ChipMultiRow({ label, options, labels, values, onToggle, className }: ChipMultiRowProps) {
  return (
    <div role="group" aria-label={label} className={cn('flex flex-wrap gap-2', className)}>
      {options.map((option) => (
        <ChoiceChip
          key={option}
          label={labels?.[option] ?? option}
          selected={values.includes(option)}
          onClick={() => onToggle(option)}
        />
      ))}
    </div>
  );
}
