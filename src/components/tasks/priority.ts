/**
 * Priority presentation, in one place so the row, the bulk bar and the picker
 * cannot disagree about which colour means "high".
 *
 * The colours are MUI palette paths, never hex values and never Tailwind
 * classes: `error.main` for high, `warning.main` for medium, `primary.main` for
 * low and the disabled text colour for none — the same mapping iOS Reminders
 * uses for flags. `sx={{ color: priorityColor(priority) }}` resolves the path
 * against the active colour scheme, so light and dark are both correct for free.
 */
import type { Priority } from '@/lib/types';

export interface PriorityItem {
  value: Priority;
  label: string;
  /** Palette path usable directly as an `sx` colour, e.g. `'error.main'`. */
  color: string;
}

export const PRIORITY_ITEMS: readonly PriorityItem[] = [
  { value: 'none', label: 'None', color: 'text.disabled' },
  { value: 'low', label: 'Low', color: 'primary.main' },
  { value: 'medium', label: 'Medium', color: 'warning.main' },
  { value: 'high', label: 'High', color: 'error.main' },
];

const LABELS: Record<Priority, string> = { none: 'None', low: 'Low', medium: 'Medium', high: 'High' };
const COLORS: Record<Priority, string> = {
  none: 'text.disabled',
  low: 'primary.main',
  medium: 'warning.main',
  high: 'error.main',
};

export function priorityLabel(priority: Priority): string {
  return LABELS[priority] ?? 'None';
}

/** Palette path for a priority's flag and text. */
export function priorityColor(priority: Priority): string {
  return COLORS[priority] ?? COLORS.none;
}
