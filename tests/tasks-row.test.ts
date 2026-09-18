/**
 * Shape and structure guards for the task chrome.
 *
 * These components are client components that bind pointer and drag handlers and
 * read DOM APIs, and this suite runs in node with no DOM, so they cannot be
 * rendered here. What regresses silently is the structural contract the design
 * leans on — a row that drifts back off MUI's list primitives, a section that
 * hand-rolls a grid-rows transition instead of using `Collapse`, or a quick-add
 * dialog that drops the synchronous focus the iOS keyboard depends on. So this
 * pins the source instead of a render.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function source(relative: string): string {
  return readFileSync(new URL(`../src/components/tasks/${relative}`, import.meta.url), 'utf8');
}

const ROW = source('TaskRow.tsx');
const SECTION = source('TaskListSection.tsx');
const QUICK_ADD = source('QuickAddBar.tsx');

describe('TaskRow — MUI list primitives', () => {
  it('is a ListItem with a ListItemButton and ListItemText', () => {
    expect(ROW).toContain("import ListItem from '@mui/material/ListItem'");
    expect(ROW).toContain("import ListItemButton from '@mui/material/ListItemButton'");
    expect(ROW).toContain("import ListItemText from '@mui/material/ListItemText'");
    expect(ROW).toContain('<ListItem');
    expect(ROW).toContain('<ListItemButton');
    expect(ROW).toContain('<ListItemText');
  });

  it('uses a MUI Checkbox for completion, with the wont-do state as indeterminate', () => {
    expect(ROW).toContain("import Checkbox from '@mui/material/Checkbox'");
    expect(ROW).toContain('checked={completed}');
    expect(ROW).toContain('indeterminate={wontDo && !completed}');
  });

  it('keeps the accessible name of the completion control', () => {
    expect(ROW).toContain('`Mark ${task.title} incomplete`');
    expect(ROW).toContain('`Complete ${task.title}`');
  });

  it('keeps the trailing row actions reachable by name', () => {
    expect(ROW).toContain('`Delete ${task.title}`');
    expect(ROW).toContain('`Open ${task.title}`');
    expect(ROW).toContain("'Deselect' : 'Select'");
  });
});

describe('TaskRow — no Tailwind, no hand-rolled divider', () => {
  it('does not use Tailwind utility classes or cn()', () => {
    expect(ROW).not.toContain('@/lib/cn');
    expect(ROW).not.toMatch(/rounded-\[6px\]/);
    expect(ROW).not.toContain('after:bg-separator');
    expect(ROW).not.toContain('after:left-13');
  });

  it('still rounds the first and last row of a card', () => {
    // `first`/`last` survived the divider removal because they round the corner.
    expect(ROW).toContain('first');
    expect(ROW).toContain('last');
    expect(ROW).toMatch(/borderRadius: last \?/);
  });
});

describe('TaskListSection — MUI grouping and Collapse', () => {
  it('groups rows with List and ListSubheader', () => {
    expect(SECTION).toContain("import List from '@mui/material/List'");
    expect(SECTION).toContain("import ListSubheader from '@mui/material/ListSubheader'");
    expect(SECTION).toContain('<ListSubheader');
  });

  it('animates the section with MUI Collapse rather than a grid-rows track', () => {
    expect(SECTION).toContain("import Collapse from '@mui/material/Collapse'");
    expect(SECTION).toContain('<Collapse');
    expect(SECTION).not.toContain('grid-template-rows');
    expect(SECTION).not.toContain('grid-rows-');
  });

  it('keeps the section accessible name and expanded state', () => {
    expect(SECTION).toContain('aria-expanded={!collapsed}');
    expect(SECTION).toContain('`${collapsed ? \'Expand\' : \'Collapse\'} ${section.title}`');
  });

  it('paints the deliberate leading edge with a border', () => {
    expect(SECTION).toContain("borderLeft: '3px solid'");
    expect(SECTION).toContain('borderLeftColor');
  });
});

describe('QuickAddBar — synchronous focus contract', () => {
  it('opens as a MUI Dialog', () => {
    expect(QUICK_ADD).toContain("import Dialog from '@mui/material/Dialog'");
    expect(QUICK_ADD).toContain('<Dialog');
  });

  it('keeps the focus in the same commit as the open, not a frame later', () => {
    // A layout effect, plus `autoFocus` as the React-native fallback: both run
    // inside the task that handled the tap, which is what iOS requires.
    expect(QUICK_ADD).toContain('useLayoutEffect');
    expect(QUICK_ADD).toMatch(/useLayoutEffect\(\(\) => \{\s*if \(!open\) return;/);
    expect(QUICK_ADD).toContain('autoFocus');
  });

  it('does not fade the dialog in — that delay is exactly what breaks the keyboard', () => {
    expect(QUICK_ADD).toContain('transitionDuration={0}');
  });

  it('keeps the input’s accessible name', () => {
    // MUI spreads a bare `aria-label` onto the FormControl root, not the input,
    // so the name is set through the `htmlInput` slot.
    expect(QUICK_ADD).toContain("'aria-label': 'Quick add a task'");
    expect(QUICK_ADD).toContain('htmlInput:');
  });
});

describe('search — the scroll-reveal hook is gone', () => {
  it('is not referenced anywhere in the tasks feature', () => {
    expect(() => source('useScrollReveal.ts')).toThrow();
  });
});
