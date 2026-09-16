/**
 * Priority presentation, in one place so the row, the bulk bar and the picker
 * cannot disagree about which colour means "high".
 *
 * Colours are Tailwind token classes, never hex values: `text-danger` for high
 * (red), `text-warning` for medium (orange), the user's accent for low, and the
 * tertiary label for none — the same mapping iOS Reminders uses for flags.
 */
import type { Priority } from '@/lib/types';

export interface PriorityItem {
  value: Priority;
  label: string;
  /** Text/icon colour. */
  text: string;
  /** Filled background for the selected state of a swatch. */
  selected: string;
}

export const PRIORITY_ITEMS: readonly PriorityItem[] = [
  { value: 'none', label: 'None', text: 'text-tertiary', selected: 'bg-fill text-label' },
  { value: 'low', label: 'Low', text: 'text-tint', selected: 'bg-tint-soft text-tint' },
  { value: 'medium', label: 'Medium', text: 'text-warning', selected: 'bg-warning/15 text-warning' },
  { value: 'high', label: 'High', text: 'text-danger', selected: 'bg-danger/15 text-danger' },
];

const LABELS: Record<Priority, string> = { none: 'None', low: 'Low', medium: 'Medium', high: 'High' };
const TEXT: Record<Priority, string> = {
  none: 'text-tertiary',
  low: 'text-tint',
  medium: 'text-warning',
  high: 'text-danger',
};

export function priorityLabel(priority: Priority): string {
  return LABELS[priority] ?? 'None';
}

export function priorityTextClass(priority: Priority): string {
  return TEXT[priority] ?? TEXT.none;
}
