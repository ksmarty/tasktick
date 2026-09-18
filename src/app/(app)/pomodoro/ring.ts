/**
 * The focus ring's geometry.
 *
 * Kept out of the page as a pure function so it can be tested without a DOM: the
 * page only turns a `0..1` progress into an SVG `stroke-dashoffset`, and the
 * arithmetic that decides where the stroke ends is here.
 */

/** Diameter of the ring, in px. The page sizes its box to match (`size-50`). */
export const RING_SIZE = 200;

/** Stroke width of the ring, in px. */
export const RING_STROKE = 8;

export interface RingGeometry {
  /** Viewbox edge length. */
  size: number;
  stroke: number;
  /** Radius of the stroke's centre line. */
  radius: number;
  /** Centre coordinate, for `cx`/`cy`. */
  center: number;
  /** Length of the full circle. */
  circumference: number;
  /** `stroke-dasharray` — the full circumference. */
  dashArray: number;
  /** `stroke-dashoffset` — what is left to draw, so `1` is a full ring. */
  dashOffset: number;
  /** The clamped progress the offsets were computed from. */
  progress: number;
}

/**
 * The ring's numbers for a given progress.
 *
 * Progress is clamped into `0..1` (a non-finite value reads as `0`), so a clock
 * that momentarily reports more elapsed time than the phase planned can never
 * draw a ring longer than the circle or a negative arc.
 */
export function ringGeometry(
  progress: number,
  size: number = RING_SIZE,
  stroke: number = RING_STROKE,
): RingGeometry {
  const safe = Number.isFinite(progress) ? Math.min(1, Math.max(0, progress)) : 0;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  return {
    size,
    stroke,
    radius,
    center: size / 2,
    circumference,
    dashArray: circumference,
    dashOffset: circumference * (1 - safe),
    progress: safe,
  };
}
