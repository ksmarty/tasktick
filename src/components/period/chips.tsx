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
 *
 * ## The one exception: flow is a slider
 *
 * Flow is the single ordinal field here, so it is the one control that is not a
 * chip row — see `FlowSlider` for why and how the discrete levels map to its
 * positions. Everything else stays a chip because a tap is the fastest thing on
 * a phone and the value is a name, not a rung on a ladder.
 */
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { flowAtPosition, flowPosition } from './chip-options';

/* Re-exported so the slider and its callers keep one import site. */
export { flowAtPosition, flowPosition, valuesOutsideOptions } from './chip-options';

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

export interface FlowSliderProps {
  /** The group's accessible name, e.g. "Flow intensity". */
  label: string;
  /** The ordered levels, least to most. Position maps straight to the index. */
  options: readonly string[];
  labels: Record<string, string>;
  /** The selected level, or null for "not logged". */
  value: string | null;
  onChange: (next: string | null) => void;
  className?: string;
}

/**
 * The flow picker as a slider over the discrete levels.
 *
 * ## Why a slider and not chips
 *
 * Flow is ordinal — spotting, light, medium, heavy are a ladder, not four
 * unrelated options — and the user asked for it as a slider. There is no GodUI
 * slider in the catalog (its `stepper` is a *read-only progress indicator*, see
 * `GODUI-CONVENTIONS.md`), so this is the one control here built by hand.
 *
 * ## The discrete levels and the positions
 *
 * `options` is `PERIOD_FLOW_LEVELS`, position *i* is `options[i]`: 0 none,
 * 1 spotting, 2 light, 3 medium, 4 heavy. `step={1}` means the thumb can only
 * land on a level, so the slider never produces a value the contract does not
 * have. The labels under the track are the same words the chips used, so the
 * mapping is visible rather than remembered.
 *
 * ## Mouse, touch and keyboard are the same input
 *
 * The visible track and thumb are `<span>`s and the real control is a native
 * `<input type="range">` laid over them, transparent. That is deliberate: a
 * native range is draggable with a mouse, tappable on touch, and walks with the
 * arrow keys, with no hand-rolled pointer maths to get wrong. The trade is that
 * the focus ring has to live on the wrapper (`has-[:focus-visible]:…`), since
 * the input itself is invisible.
 *
 * ## The accessible value is the level, not the number
 *
 * A range announces its numeric value, so `aria-valuetext` is set to the level's
 * word — or "Not logged" when the field is empty. `null` (nothing recorded) is
 * distinct from `none` (recorded as no bleeding), which is why position 0 exists
 * and why the thumb is muted while no level is recorded.
 */
export function FlowSlider({ label, options, labels, value, onChange, className }: FlowSliderProps) {
  const max = Math.max(0, options.length - 1);
  const selectedIndex = value === null ? -1 : options.indexOf(value);
  const index = flowPosition(options, value);
  const pct = max === 0 ? 0 : (index / max) * 100;
  const currentText = selectedIndex < 0 ? 'Not logged' : (labels[options[index]] ?? options[index]);

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <div className="relative flex h-9 items-center rounded-lg has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring/50">
        <span aria-hidden className="absolute inset-x-0 h-2 rounded-full bg-muted" />
        <span aria-hidden className="absolute h-2 rounded-full bg-primary" style={{ width: `${pct}%` }} />
        <span
          aria-hidden
          className={cn(
            'absolute size-5 -translate-x-1/2 rounded-full border-2 shadow-sm [transition:border-color_150ms_ease]',
            selectedIndex < 0 ? 'border-muted-foreground/40 bg-background' : 'border-primary bg-background',
          )}
          style={{ left: `${pct}%` }}
        />
        <input
          type="range"
          min={0}
          max={max}
          step={1}
          value={index}
          aria-label={label}
          aria-valuetext={currentText}
          onChange={(event) => {
            onChange(flowAtPosition(options, Number(event.target.value)));
          }}
          className="relative h-full w-full cursor-pointer appearance-none bg-transparent opacity-0"
        />
      </div>
      <div aria-hidden className="flex justify-between px-1 text-xs text-muted-foreground">
        {options.map((option) => (
          <span key={option} className={cn(option === value && 'font-medium text-foreground')}>
            {labels[option] ?? option}
          </span>
        ))}
      </div>
    </div>
  );
}
