/**
 * Priority presentation, in one place so the row, the bulk bar and the picker
 * cannot disagree about which colour means "high".
 *
 * ## Why these are class names and not palette paths
 *
 * On MUI this module returned palette paths (`'error.main'`) because `sx` resolved
 * them against the active scheme. There is no `sx` any more — Tailwind classes are
 * the only styling channel — so the mapping is to **class names** now.
 *
 * GodUI's Celestial Sapphire is monochrome: `primary` is near-black in light mode
 * and near-white in dark, so it cannot express "warning". The tokens that can are
 * the theme's own `destructive` (red) and `chart-4` (amber in both appearances,
 * `oklch(0.828 0.189 84.429)` light / `oklch(0.769 0.188 70.08)` dark) — so high
 * is destructive, medium is chart-4, low is primary and none is muted. No hex
 * value is introduced and the palette is untouched.
 */
import type { Priority } from '@/lib/types';

export interface PriorityItem {
  value: Priority;
  label: string;
  /** Tailwind text-colour utility for the flag and for the priority's label. */
  color: string;
}

export const PRIORITY_ITEMS: readonly PriorityItem[] = [
  { value: 'none', label: 'None', color: 'text-muted-foreground' },
  { value: 'low', label: 'Low', color: 'text-primary' },
  { value: 'medium', label: 'Medium', color: 'text-chart-4' },
  { value: 'high', label: 'High', color: 'text-destructive' },
];

const LABELS: Record<Priority, string> = { none: 'None', low: 'Low', medium: 'Medium', high: 'High' };
const COLORS: Record<Priority, string> = {
  none: 'text-muted-foreground',
  low: 'text-primary',
  medium: 'text-chart-4',
  high: 'text-destructive',
};

export function priorityLabel(priority: Priority): string {
  return LABELS[priority] ?? 'None';
}

/** Tailwind colour class for a priority's flag and text. */
export function priorityColor(priority: Priority): string {
  return COLORS[priority] ?? COLORS.none;
}
