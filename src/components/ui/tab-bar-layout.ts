/**
 * Layout maths for `TabBar` — pure, so it can be unit-tested without a DOM.
 *
 * iOS tab bars show at most five items; anything past that collapses into a
 * trailing "More" tab. All geometry is expressed as a percentage of the bar
 * width so the bar can be laid out entirely by CSS.
 */

/** Maximum number of visible tabs, matching `UITabBar`. */
export const TAB_BAR_MAX_ITEMS = 5;

export interface TabBarOverflow<T> {
  /** Items that get a tab of their own. */
  visible: T[];
  /** Items hidden behind the "More" tab. Empty when everything fits. */
  overflow: T[];
  /** True when a trailing "More" tab has to be rendered. */
  hasOverflow: boolean;
}

/**
 * Splits `items` into the tabs that fit and the ones that move behind "More".
 * The last slot belongs to "More" itself, so at most `max - 1` real items stay
 * visible once the bar overflows.
 */
export function resolveTabBarItems<T>(items: readonly T[], max: number = TAB_BAR_MAX_ITEMS): TabBarOverflow<T> {
  if (!Number.isInteger(max) || max < 1) {
    throw new RangeError(`TabBar max must be a positive integer, received ${max}`);
  }
  if (items.length <= max) {
    return { visible: [...items], overflow: [], hasOverflow: false };
  }
  const slots = max - 1;
  return { visible: items.slice(0, slots), overflow: items.slice(slots), hasOverflow: true };
}

export interface TabItemBox {
  /** Slot index, 0-based, left to right. */
  index: number;
  /** Distance from the leading edge of the bar, as a percentage of its width. */
  leftPercent: number;
  /** Slot width, as a percentage of the bar width. */
  widthPercent: number;
  /** Midpoint of the slot, as a percentage of the bar width. */
  centerPercent: number;
}

function assertCount(count: number): void {
  if (!Number.isInteger(count) || count < 1) {
    throw new RangeError(`TabBar slot count must be a positive integer, received ${count}`);
  }
}

/** Equal-width slot geometry for one tab. Throws on an out-of-range index. */
export function tabItemBox(index: number, count: number): TabItemBox {
  assertCount(count);
  if (!Number.isInteger(index) || index < 0 || index >= count) {
    throw new RangeError(`TabBar slot index ${index} is outside 0..${count - 1}`);
  }
  const widthPercent = 100 / count;
  return {
    index,
    widthPercent,
    leftPercent: index * widthPercent,
    centerPercent: (index + 0.5) * widthPercent,
  };
}

/** Every slot box of a `count`-item bar, in order. The boxes tile the full width. */
export function tabBarBoxes(count: number): TabItemBox[] {
  assertCount(count);
  return Array.from({ length: count }, (_, index) => tabItemBox(index, count));
}

/**
 * Index of the slot holding `value`, or `-1` when it is not on the bar (an item
 * parked behind "More", for instance).
 */
export function findTabSlot<T>(
  items: readonly T[],
  value: T | undefined,
  equals: (a: T, b: T) => boolean = Object.is,
): number {
  if (value === undefined) return -1;
  return items.findIndex((item) => equals(item, value));
}
