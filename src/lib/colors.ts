/**
 * Accent colour resolution.
 *
 * Colours are named tokens rather than hex values so that light and dark each
 * get Apple's separately-tuned system colour (`#007AFF` vs `#0A84FF`, not an
 * inversion) and so a user can retheme the app without touching the database.
 *
 * Components should prefer the Tailwind utilities (`bg-ios-blue`, `text-tint`).
 * These maps exist for the places CSS classes cannot reach: canvas rendering,
 * inline `style` for dynamic chart colours, and `<meta name="theme-color">`.
 */
import type { AccentColor } from './types';

/** Light-appearance values, matching `globals.css`. */
export const ACCENT_HEX_LIGHT: Record<AccentColor, string> = {
  blue: '#007aff',
  indigo: '#5856d6',
  purple: '#af52de',
  pink: '#ff2d55',
  red: '#ff3b30',
  orange: '#ff9500',
  yellow: '#ffcc00',
  green: '#34c759',
  teal: '#30b0c7',
  cyan: '#32ade6',
  gray: '#8e8e93',
  brown: '#a2845e',
};

/** Dark-appearance values, matching `globals.css`. */
export const ACCENT_HEX_DARK: Record<AccentColor, string> = {
  blue: '#0a84ff',
  indigo: '#5e5ce6',
  purple: '#bf5af2',
  pink: '#ff375f',
  red: '#ff453a',
  orange: '#ff9f0a',
  yellow: '#ffd60a',
  green: '#30d158',
  teal: '#40c8e0',
  cyan: '#64d2ff',
  gray: '#98989d',
  brown: '#ac8e68',
};

/** The CSS custom property name for an accent, usable inline. */
export function accentVar(color: AccentColor): string {
  return `var(--ios-${color})`;
}

export function accentHex(color: AccentColor, dark = false): string {
  return (dark ? ACCENT_HEX_DARK : ACCENT_HEX_LIGHT)[color] ?? ACCENT_HEX_LIGHT.blue;
}

/** Human labels for the colour picker. */
export const ACCENT_LABEL: Record<AccentColor, string> = {
  blue: 'Blue',
  indigo: 'Indigo',
  purple: 'Purple',
  pink: 'Pink',
  red: 'Red',
  orange: 'Orange',
  yellow: 'Yellow',
  green: 'Green',
  teal: 'Teal',
  cyan: 'Cyan',
  gray: 'Graphite',
  brown: 'Brown',
};

/** Deterministic colour for a tag that has none, so tags look stable over time. */
export function colorForName(name: string, palette: readonly AccentColor[]): AccentColor {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) | 0;
  }
  return palette[Math.abs(hash) % palette.length];
}

/**
 * Narrows an arbitrary string from the database to a known accent token.
 * Rows written by an older version (or by a future one) must not crash the UI.
 */
export function asAccentColor(value: string | null | undefined, fallback: AccentColor = 'blue'): AccentColor {
  return value && value in ACCENT_HEX_LIGHT ? (value as AccentColor) : fallback;
}

/**
 * The list colour shown on the calendar, in priority order:
 * an explicit calendar override, then the calendar's own colour.
 */
export function resolveCalendarColor(calendarColor: string | null, override: string | null): AccentColor {
  return asAccentColor(override ?? calendarColor, 'blue');
}

/** Blends an accent into a soft tinted background at the given alpha. */
export function accentSoft(color: AccentColor, alpha = 0.14, dark = false): string {
  const hex = accentHex(color, dark).replace('#', '');
  const r = Number.parseInt(hex.slice(0, 2), 16);
  const g = Number.parseInt(hex.slice(2, 4), 16);
  const b = Number.parseInt(hex.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
