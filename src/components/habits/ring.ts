/**
 * The completion ring's geometry — the arithmetic behind `HabitDayRing`.
 *
 * Pure numbers, no React and no DOM, so the fiddly part (an arc is a path, a
 * ring is N arcs, and the gap between them has to stay visible at every count)
 * is testable without a renderer — see `tests/habits-ring.test.ts`.
 *
 * The ring is drawn in the day cell's own 36px disc, so every measure below is
 * in that disc's coordinates: a `viewBox="0 0 36 36"` with the centre at 18,18.
 * Angles run clockwise from 12 o'clock, which is where a clock face — and the
 * eye reading a date — starts.
 */

/** The disc the ring is drawn in, in the disc's own coordinates. */
export const RING_BOX_PX = 36;
export const RING_CENTRE_PX = RING_BOX_PX / 2;
/** Just inside the disc's 1px border, so the ring never touches its edge. */
export const RING_RADIUS_PX = 16;
export const RING_STROKE_PX = 1.5;

/** The widest a gap between two sections may get, in degrees. */
const MAX_GAP_DEG = 24;
/** …and a gap is never more than a quarter of the section it separates. */
const MAX_GAP_FRACTION = 0.25;

export interface RingArc {
  /** Degrees clockwise from 12 o'clock where the arc begins. */
  fromDeg: number;
  /** …and where it ends. Always greater than `fromDeg`. */
  toDeg: number;
}

/**
 * The arcs a `segments`-section ring is made of.
 *
 * One completion is the whole ring: there is nothing to divide it from, and a
 * closed circle is what "completed" looks like. From two up, each habit gets an
 * equal section with a gap at every boundary, so the count is countable at a
 * glance instead of blurring into a slightly different circle.
 *
 * The gap is capped both ways — never wider than 24°, and never more than a
 * quarter of its own section — so two habits are two fat arcs with a clear
 * break, twelve are twelve arcs with a hairline break, and neither count
 * degenerates. It is centred on each boundary, which keeps the sections
 * symmetric about 12 o'clock instead of drifting a gap's width to one side.
 */
export function ringArcs(segments: number): RingArc[] {
  const count = Math.max(0, Math.floor(segments));
  if (count <= 0) return [];
  if (count === 1) return [{ fromDeg: 0, toDeg: 360 }];

  const section = 360 / count;
  const gap = Math.min(MAX_GAP_DEG, section * MAX_GAP_FRACTION);
  return Array.from({ length: count }, (_, index) => ({
    fromDeg: index * section + gap / 2,
    toDeg: (index + 1) * section - gap / 2,
  }));
}

/** The point `deg` clockwise from 12 o'clock, on the ring's circle. */
export function ringPoint(
  deg: number,
  radius: number = RING_RADIUS_PX,
  centre: number = RING_CENTRE_PX,
): { x: number; y: number } {
  // -90° puts 0 at 12 o'clock; SVG's y grows downwards, so a growing angle
  // travels clockwise on screen, which is the direction the angles mean here.
  const radians = ((deg - 90) * Math.PI) / 180;
  return { x: centre + radius * Math.cos(radians), y: centre + radius * Math.sin(radians) };
}

/** Rounds to a hundredth, so the emitted path stays readable and stable. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * One arc as an SVG path, or `null` when the arc is empty.
 *
 * A full turn cannot be an arc path — its endpoints coincide and SVG would paint
 * nothing — so a single-section ring is drawn as a `<circle>` by the component
 * rather than through this function.
 */
export function ringArcPath(arc: RingArc, radius: number = RING_RADIUS_PX, centre: number = RING_CENTRE_PX): string | null {
  const sweep = arc.toDeg - arc.fromDeg;
  if (sweep <= 0) return null;
  if (sweep >= 360) return null;

  const start = ringPoint(arc.fromDeg, radius, centre);
  const end = ringPoint(arc.toDeg, radius, centre);
  const largeArc = sweep > 180 ? 1 : 0;
  return `M ${round2(start.x)} ${round2(start.y)} A ${radius} ${radius} 0 ${largeArc} 1 ${round2(end.x)} ${round2(end.y)}`;
}
