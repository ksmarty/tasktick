/**
 * Priority presentation, in one place so the row, the bulk bar and the picker
 * cannot disagree about which weight means "high".
 *
 * ## A hue per weight, worn by the checkbox
 *
 * GodUI's Celestial Sapphire is deliberately achromatic: `primary` is near-black
 * in light mode and near-white in dark, so emphasis comes from contrast, weight
 * and elevation. Priority used to follow that rule — a monochrome ramp from full
 * foreground down through opacity — and the app's one hue was spent on an
 * overdue date. It read as an absence: a list scanned for "what is urgent"
 * showed nothing until you read the flag's own sr-only label.
 *
 * Priority now carries a colour, and the row's **checkbox** is what wears it
 * (`priorityCheckbox`), because that is the control the eye lands on when it
 * scans the leading edge of a list. The tokens are `--priority-*` in
 * `globals.css`: Apple's system colours, tuned per scheme, the same family
 * `lib/colors.ts` resolves for a list or a tag. `none` has no token and no
 * class — a task with no priority keeps the primitive's neutral border, so the
 * colour only ever appears where the user set it.
 *
 * The lightning bolt that used to mark a prioritised row is gone with the
 * monochrome ramp: the checkbox already says it, in colour, and a second glyph
 * on the same row was the thing the user asked to remove. Nothing is lost to a
 * screen reader — the row announces the priority in words
 * (`TaskRow`'s `sr-only` span) and the flag keeps its own label here.
 */
import type { Priority } from '@/lib/types';

export interface PriorityItem {
  value: Priority;
  label: string;
  /** Tailwind text-colour utility for the flag and for the priority's label. */
  color: string;
  /**
   * The classes the row's checkbox wears: the priority's hue on its border, and
   * as its fill once it is ticked. Empty for `none`.
   */
  checkbox: string;
}

const LABELS: Record<Priority, string> = { none: 'None', low: 'Low', medium: 'Medium', high: 'High' };

const COLORS: Record<Priority, string> = {
  none: 'text-muted-foreground/50',
  low: 'text-priority-low',
  medium: 'text-priority-medium',
  high: 'text-priority-high',
};

/*
 * Written out rather than built from the hue's name: Tailwind scans source text
 * for the classes it emits, so a concatenated `bg-priority-${hue}` would compile
 * to nothing. The `dark:` twins are here because the checkbox primitive carries
 * its own `dark:data-[state=checked]:bg-primary`, which `tailwind-merge` cannot
 * cancel against a class in a different variant group — without them the tick
 * would fill near-white in the dark scheme and the hue would vanish.
 */
const CHECKBOX: Record<Priority, string> = {
  none: '',
  low:
    'border-priority-low/60 data-[state=checked]:border-priority-low data-[state=checked]:bg-priority-low dark:data-[state=checked]:bg-priority-low data-[state=checked]:text-white',
  medium:
    'border-priority-medium/60 data-[state=checked]:border-priority-medium data-[state=checked]:bg-priority-medium dark:data-[state=checked]:bg-priority-medium data-[state=checked]:text-white',
  high:
    'border-priority-high/60 data-[state=checked]:border-priority-high data-[state=checked]:bg-priority-high dark:data-[state=checked]:bg-priority-high data-[state=checked]:text-white',
};

export const PRIORITY_ITEMS: readonly PriorityItem[] = [
  { value: 'none', label: 'None', color: COLORS.none, checkbox: CHECKBOX.none },
  { value: 'low', label: 'Low', color: COLORS.low, checkbox: CHECKBOX.low },
  { value: 'medium', label: 'Medium', color: COLORS.medium, checkbox: CHECKBOX.medium },
  { value: 'high', label: 'High', color: COLORS.high, checkbox: CHECKBOX.high },
];

export function priorityLabel(priority: Priority): string {
  return LABELS[priority] ?? 'None';
}

/** Tailwind colour class for a priority's flag and text. */
export function priorityColor(priority: Priority): string {
  return COLORS[priority] ?? COLORS.none;
}

/**
 * The class list for a priority's checkbox, or an empty string for `none` —
 * which leaves the primitive's own neutral border in place.
 */
export function priorityCheckbox(priority: Priority): string {
  return CHECKBOX[priority] ?? '';
}
