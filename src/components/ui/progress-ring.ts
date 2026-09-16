/**
 * Progress geometry and colour resolution — pure, so it can be unit-tested
 * without a DOM.
 *
 * The ring is drawn as a single SVG `<circle>` whose dash pattern encodes the
 * value, which keeps the markup to two elements and makes the progress
 * animatable with a plain CSS transition on `stroke-dashoffset`.
 */
import { accentVar } from '@/lib/colors';
import type { AccentColor } from '@/lib/types';

/** `tint` follows the user's accent; the semantic names follow the status colours. */
export type ProgressColor = 'tint' | 'success' | 'warning' | 'danger' | AccentColor;

/** Clamps a progress value into `0..1`; `NaN` and infinities become 0. */
export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

export interface RingGeometry {
  /** Side length of the square SVG viewport, in px. */
  size: number;
  /** Effective stroke width, clamped so the stroke always fits inside the viewport. */
  strokeWidth: number;
  /** Centre coordinate on both axes. */
  center: number;
  /** Radius of the stroke's centre line. */
  radius: number;
  /** Length of the full circle, i.e. the dash pattern's "on" length. */
  circumference: number;
}

/** Geometry for a ring drawn inside a `size` × `size` square. */
export function ringGeometry(size: number, strokeWidth: number): RingGeometry {
  if (!Number.isFinite(size) || size <= 0) {
    throw new RangeError(`ProgressRing size must be a positive number, received ${size}`);
  }
  const requested = Number.isFinite(strokeWidth) && strokeWidth > 0 ? strokeWidth : 1;
  const clamped = Math.min(requested, size / 2);
  const radius = (size - clamped) / 2;
  return {
    size,
    strokeWidth: clamped,
    center: size / 2,
    radius,
    circumference: 2 * Math.PI * radius,
  };
}

/**
 * `stroke-dashoffset` that leaves `value` of the circumference drawn. At `1`
 * the offset is 0 (full ring); at `0` it is the whole circumference (empty).
 */
export function ringDashOffset(value: number, circumference: number): number {
  return circumference * (1 - clamp01(value));
}

/** `0.42` → `"42%"`. */
export function formatPercent(value: number, fractionDigits = 0): string {
  return `${(clamp01(value) * 100).toFixed(fractionDigits)}%`;
}

/**
 * CSS colour for a progress stroke. Returns a design token reference rather
 * than a hex value, so light/dark and the user's accent keep working.
 */
export function progressColor(color: ProgressColor = 'tint'): string {
  switch (color) {
    case 'tint':
      return 'var(--tint)';
    case 'success':
      return 'var(--success)';
    case 'warning':
      return 'var(--warning)';
    case 'danger':
      return 'var(--danger)';
    default:
      return accentVar(color);
  }
}
