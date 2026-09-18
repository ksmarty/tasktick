/**
 * Priority presentation, in one place so the row, the bulk bar and the picker
 * cannot disagree about which weight means "high".
 *
 * ## Monochrome, by contrast rather than hue
 *
 * GodUI's Celestial Sapphire is deliberately achromatic: `primary` is near-black
 * in light mode and near-white in dark, so emphasis comes from contrast, weight
 * and elevation. The old mapping spent hue on priority (`destructive` red for
 * high, `chart-4` amber for medium), which fought the palette and competed with
 * the one colour that does carry urgency — an overdue date. Priority is now a
 * monochrome ramp: high is full foreground, medium and low step down through
 * foreground/opacity, and `none` is muted. The flag keeps its `sr-only` label, so
 * nothing the colour used to say is lost to a screen reader.
 */
import type { Priority } from '@/lib/types';

export interface PriorityItem {
  value: Priority;
  label: string;
  /** Tailwind text-colour utility for the flag and for the priority's label. */
  color: string;
}

export const PRIORITY_ITEMS: readonly PriorityItem[] = [
  { value: 'none', label: 'None', color: 'text-muted-foreground/50' },
  { value: 'low', label: 'Low', color: 'text-muted-foreground' },
  { value: 'medium', label: 'Medium', color: 'text-foreground/60' },
  { value: 'high', label: 'High', color: 'text-foreground' },
];

const LABELS: Record<Priority, string> = { none: 'None', low: 'Low', medium: 'Medium', high: 'High' };
const COLORS: Record<Priority, string> = {
  none: 'text-muted-foreground/50',
  low: 'text-muted-foreground',
  medium: 'text-foreground/60',
  high: 'text-foreground',
};

export function priorityLabel(priority: Priority): string {
  return LABELS[priority] ?? 'None';
}

/** Tailwind colour class for a priority's flag and text. */
export function priorityColor(priority: Priority): string {
  return COLORS[priority] ?? COLORS.none;
}
