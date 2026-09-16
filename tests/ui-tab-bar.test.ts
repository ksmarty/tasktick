/**
 * Pure layout maths behind `TabBar`: how many tabs fit, where the "More" tab
 * goes, and the equal-width geometry each slot occupies.
 */
import { describe, expect, it } from 'vitest';
import {
  TAB_BAR_MAX_ITEMS,
  findTabSlot,
  resolveTabBarItems,
  tabBarBoxes,
  tabItemBox,
} from '@/components/ui/tab-bar-layout';

describe('resolveTabBarItems', () => {
  it('shows every item when the bar is not full', () => {
    const items = ['today', 'calendar', 'habits', 'settings'];
    const result = resolveTabBarItems(items);

    expect(result.visible).toEqual(items);
    expect(result.overflow).toEqual([]);
    expect(result.hasOverflow).toBe(false);
  });

  it('keeps exactly the maximum visible and parks the tail behind "More"', () => {
    const items = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
    const result = resolveTabBarItems(items);

    // Five slots, and the fifth belongs to "More" itself.
    expect(TAB_BAR_MAX_ITEMS).toBe(5);
    expect(result.visible).toEqual(['a', 'b', 'c', 'd']);
    expect(result.overflow).toEqual(['e', 'f', 'g']);
    expect(result.hasOverflow).toBe(true);
    expect(result.visible.length + (result.hasOverflow ? 1 : 0)).toBe(TAB_BAR_MAX_ITEMS);
  });

  it('honours a custom maximum', () => {
    const result = resolveTabBarItems(['a', 'b', 'c', 'd'], 3);

    expect(result.visible).toEqual(['a', 'b']);
    expect(result.overflow).toEqual(['c', 'd']);
  });

  it('copies rather than aliases the input', () => {
    const items = ['a', 'b'];
    const result = resolveTabBarItems(items);
    result.visible.push('c');

    expect(items).toEqual(['a', 'b']);
  });

  it('rejects a maximum that cannot hold a tab', () => {
    expect(() => resolveTabBarItems([], 0)).toThrow(RangeError);
    expect(() => resolveTabBarItems([], -2)).toThrow(RangeError);
  });
});

describe('tabItemBox', () => {
  it('centres slot 1 of 4', () => {
    expect(tabItemBox(1, 4)).toEqual({
      index: 1,
      leftPercent: 25,
      widthPercent: 25,
      centerPercent: 37.5,
    });
  });

  it('tiles the whole bar without gaps or overlap', () => {
    const boxes = tabBarBoxes(5);

    expect(boxes.map((box) => box.widthPercent)).toEqual([20, 20, 20, 20, 20]);
    expect(boxes.map((box) => box.leftPercent)).toEqual([0, 20, 40, 60, 80]);
    expect(boxes.map((box) => box.centerPercent)).toEqual([10, 30, 50, 70, 90]);
    expect(boxes.reduce((total, box) => total + box.widthPercent, 0)).toBeCloseTo(100, 10);
  });

  it('gives the only slot the full width', () => {
    expect(tabItemBox(0, 1).widthPercent).toBe(100);
  });

  it('throws for indexes and counts outside the bar', () => {
    expect(() => tabItemBox(3, 3)).toThrow(RangeError);
    expect(() => tabItemBox(-1, 3)).toThrow(RangeError);
    expect(() => tabItemBox(0.5, 3)).toThrow(RangeError);
    expect(() => tabBarBoxes(0)).toThrow(RangeError);
  });
});

describe('findTabSlot', () => {
  it('finds the slot holding the active value', () => {
    expect(findTabSlot(['today', 'calendar', 'habits'], 'calendar')).toBe(1);
  });

  it('returns -1 when the value is parked behind "More"', () => {
    expect(findTabSlot(['today', 'calendar'], 'settings')).toBe(-1);
    expect(findTabSlot(['today'], undefined)).toBe(-1);
  });
});
