/**
 * Structure guards for the split filter/sort menus and the compact rows.
 *
 * The menus are client components that portal and bind drag handlers, so this
 * suite (node, no DOM) pins the source contract instead of rendering:
 *
 *  - filtering and sorting are two components with two triggers, not one sheet;
 *  - both use the GodUI `Drawer`, which is what gives them swipe-down-to-dismiss
 *    and a content-height panel (`Sheet` put a full-height column on screen);
 *  - the pickers use the same `Drawer`, so the whole family is one control;
 *  - the row keeps a 44px tap target while its visual rhythm shrinks.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function read(relativeToSrc: string): string {
  return readFileSync(new URL(`../src/${relativeToSrc}`, import.meta.url), 'utf8');
}

function source(relative: string): string {
  return read(`components/tasks/${relative}`);
}

const FILTER = source('FilterMenu.tsx');
const SORT = source('SortMenu.tsx');
const VIEW = source('TasksView.tsx');
const ROW = source('TaskRow.tsx');
const INDEX = source('index.ts');
const PICKERS = ['ListPicker.tsx', 'PriorityPicker.tsx', 'RepeatPicker.tsx', 'ReminderPicker.tsx', 'TagPicker.tsx'].map(source);

describe('filter and sort are two menus', () => {
  it('exports a filter menu and a sort menu instead of one sheet', () => {
    expect(FILTER).toContain('export function TaskFilterMenu');
    expect(SORT).toContain('export function TaskSortMenu');
    expect(FILTER).not.toContain('TaskFilterSheet');
    expect(INDEX).toContain("export { TaskFilterMenu, type TaskFilterMenuProps } from './FilterMenu'");
    expect(INDEX).toContain("export { TaskSortMenu, type TaskSortMenuProps } from './SortMenu'");
  });

  it('keeps filtering and sorting out of each other', () => {
    // The filter menu holds the filter dimensions and no sort options.
    expect(FILTER).toContain('TASK_WINDOWS');
    expect(FILTER).not.toContain('TASK_SORTS');
    // The sort menu holds the sorts and no filter dimensions.
    expect(SORT).toContain('TASK_SORTS');
    expect(SORT).not.toContain('TASK_WINDOWS');
  });

  it('keeps the single-choice semantics and labels of every dimension', () => {
    for (const label of ['Due window', 'Priority', 'List', 'Tag']) {
      expect(FILTER).toContain(`aria-label="${label}"`);
    }
    // Every row is a radio, and picking one closes the menu.
    expect(FILTER).toContain('role="radio"');
    expect(FILTER).toContain('aria-checked={selected}');
    expect(FILTER).toContain('onOpenChange(false)');
    expect(SORT).toContain('role="radio"');
    expect(SORT).toContain('aria-label="Sort"');
    expect(SORT).toContain('onOpenChange(false)');
  });

  it('puts a trigger for each menu in the header', () => {
    expect(VIEW).toContain('aria-label="Filter tasks"');
    expect(VIEW).toContain('`Sort: ${activeSort.label}');
    // The sort is an icon button now, and its glyph carries the direction.
    expect(VIEW).toContain('icon={SortIcon}');
    expect(VIEW).toContain('sortDirLabel(state.sortDir)');
    expect(VIEW).toContain('<TaskFilterMenu');
    expect(VIEW).toContain('<TaskSortMenu');
    expect(VIEW).not.toContain('TaskFilterSheet');
  });

  it('exposes the sort direction as a labelled toggle, only where it applies', () => {
    expect(SORT).toContain('aria-label="Sort direction"');
    expect(SORT).toContain('isDirectionalSort(state.sort)');
    for (const label of ['Ascending', 'Descending']) expect(SORT).toContain(label);
    // Choosing a key starts it in its own natural direction.
    expect(SORT).toContain('defaultSortDir(sort)');
  });
});

describe('the menus and pickers are the same Drawer control', () => {
  it('opens the filter and sort menus in a content-height drawer', () => {
    for (const file of [FILTER, SORT]) {
      expect(file).toContain("from '@/components/godui/drawer'");
      expect(file).toContain('<Drawer');
      // A cap, not a fixed height: the panel is only as tall as its contents.
      expect(file).toContain('max-h-[70dvh]');
      expect(file).not.toContain("from '@/components/ui/sheet'");
    }
  });

  it('uses the Drawer for all five pickers too', () => {
    for (const file of PICKERS) {
      expect(file).toContain("from '@/components/godui/drawer'");
      expect(file).toContain('<Drawer');
      expect(file).not.toContain("from '@/components/ui/sheet'");
    }
  });
});

describe('the row is denser but keeps its 44px targets', () => {
  it('tightens the visual rhythm with scale utilities only', () => {
    // The 2px vertical padding is gone, the title leads tight so the title/meta
    // group fits the 44px target, and the title↔due-date gap drops a step.
    expect(ROW).not.toContain('py-0.5');
    expect(ROW).toContain('justify-center');
    expect(ROW).toContain('leading-tight');
    expect(ROW).toContain('gap-x-1 gap-y-0');
    expect(ROW).not.toContain('gap-x-1.5');
    expect(ROW).toContain('gap-0 ');
    // No arbitrary spacing, even after the tightening.
    expect(ROW).not.toMatch(/\bp[xytblr]?-\[\d/);
    expect(ROW).not.toMatch(/\bgap-\[\d/);
  });

  it('keeps the row and its controls at a 44px touch size', () => {
    // The row stays `min-h-11`, the checkbox keeps its `size-11` target, and the
    // open control grows to the same minimum rather than the row growing.
    expect(ROW).toContain('min-h-11');
    expect(ROW).toContain('size-11');
    expect(ROW).toContain('size-11 shrink-0 place-items-center');
  });
});
