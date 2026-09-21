/**
 * The toast tuning and the vendored stack's local edit.
 *
 * These are values the user asked to change, and a re-vendor of `godui/toast`
 * would silently restore the old one. The app wrapper is the place to prefer
 * changes; the one that had to live in the vendored file is pinned here so the
 * `LOCAL CHANGE` marker is not the only record.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function source(relative: string): string {
  return readFileSync(new URL(`../src/${relative}`, import.meta.url), 'utf8');
}

/**
 * The same source with its comments removed.
 *
 * A `toContain` on the raw file can be satisfied by a *comment* that mentions the
 * thing — which happened here when the Undo's colour changed: the assertion still
 * read `toContain('bg-secondary')` and still passed, because the new file's doc
 * comment explained what the old colour had been. Anything that pins a value has
 * to be checked against code, not prose.
 */
function code(relative: string): string {
  return source(relative)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');
}

const WRAPPER = source('components/app/Toast.tsx');
const STACK = source('components/godui/toast.tsx');
const TASKS_VIEW = source('components/tasks/TasksView.tsx');
const TODAY_VIEW = source('components/tasks/TodayView.tsx');
const USE_TASK_ACTIONS = source('components/tasks/useTaskActions.ts');
const COMPLETION_UNDO = source('components/tasks/CompletionUndo.tsx');
const COMPLETION_UNDO_CODE = code('components/tasks/CompletionUndo.tsx');
const QUICK_ADD_FAB = source('components/app/QuickAddFab.tsx');

describe('the app toast dwell time', () => {
  it('sits in the 1.5-2s the user asked for', () => {
    expect(WRAPPER).toContain('const DEFAULT_DURATION = 1800;');
    expect(WRAPPER).not.toContain('const DEFAULT_DURATION = 2500;');
    expect(WRAPPER).not.toContain('const DEFAULT_DURATION = 3200;');
  });

  it('leaves the deliberately persistent toast alone', () => {
    expect(WRAPPER).toContain('const PERSISTENT_DURATION = 2 ** 31 - 1;');
    // `duration: 0` still means "until dismissed" — the conversion is pinned
    // structurally because there is no jsdom to fire a real timeout here.
    expect(WRAPPER).toContain('banner.duration === 0');
    expect(WRAPPER).toContain('? PERSISTENT_DURATION');
  });

  /*
   * The Undo banner used to hard-code `duration: 5000` at each call site. It now
   * relies on the wrapper's rule for action-carrying banners, so the window is
   * stated once and stays finite — a future caller cannot accidentally pass
   * `duration: 0` (persistent, ~24.8 days) and leave the banner up.
   *
   * The task-complete Undo no longer uses that rule at all: it is the inline
   * `CompletionUndo` control now. The wrapper's action window stays because the
   * wrapper still has to support actions; what is pinned here is where the
   * completion path went, not the wrapper rule's removal.
   */
  it('gives an action-carrying banner a finite, longer window', () => {
    expect(WRAPPER).toContain('const ACTION_DURATION = 5000;');
    expect(WRAPPER).toContain('banner.action ? ACTION_DURATION');
  });

  /*
   * PORTED from the old `action: { label: 'Undo' }` assertions. The completion
   * path used to raise a full toast with an Undo action; it now raises the small
   * `CompletionUndo` control instead, and the re-add (undo) path raises nothing.
   * The point of the original assertion survives: the completion feedback is
   * still present, still undoable, and still has no persistent banner.
   */
  it('moves the completion Undo off the toast and leaves the re-add silent', () => {
    for (const view of [TASKS_VIEW, TODAY_VIEW]) {
      expect(view).toContain('CompletionUndo');
      expect(view).not.toContain('Task completed');
      expect(view).not.toMatch(/duration:\s*0\s*[,}]/);
      expect(view).not.toContain('duration: 5000');
    }
    expect(USE_TASK_ACTIONS).not.toContain('Marked as not done');
    // The 2s window the user asked for is the constant the control reads.
    expect(COMPLETION_UNDO).toContain('const COMPLETION_UNDO_MS = 2000;');
  });
});


/*
 * The control's shape, which the user specified: the same size as the action
 * button, icon only, and stacked above it on the right rather than at the left
 * edge. Pinned because the geometry is the requirement, and it had already
 * drifted twice.
 */
it('is an icon-only control the size of the action button, above it on the right', () => {
  // The action button is `size-14`; this must match it, not approximate it.
  expect(QUICK_ADD_FAB).toContain('size-14');
  expect(COMPLETION_UNDO).toContain('size-14');
  // Stacked above the band, sharing the action button gutter.
  expect(COMPLETION_UNDO).toContain('right-gutter');
  expect(COMPLETION_UNDO).not.toContain('left-gutter');
  // Icon only: no visible label text, and the name still carries the task.
  expect(COMPLETION_UNDO).toContain('aria-label={`Undo completing ${task.title}`}');
  expect(COMPLETION_UNDO).not.toMatch(/>\s*Undo\s*</);
  /*
   * A colour that is not the action button's `bg-primary`.
   *
   * PORTED from `bg-secondary`, which this assertion pinned until the colour
   * changed. It was passing for the wrong reason at that point — the new file
   * still contained the string `bg-secondary`, in the doc comment explaining what
   * the colour had been — so it is asserted against comment-stripped code now,
   * and the colour is pinned by its own contrast test as well
   * (`tests/tasks-completion-animation.test.ts`).
   */
  expect(COMPLETION_UNDO_CODE).toContain('bg-chart-2 text-background');
  expect(COMPLETION_UNDO_CODE).not.toContain('bg-secondary');
  expect(COMPLETION_UNDO_CODE).not.toContain('bg-primary');
});

describe('the countdown actually starts', () => {
  /*
   * The bug this pins: `expanded` suppresses the dismiss timer, and the
   * toaster used to set it from `onMouseEnter`. A tap delivers the
   * compatibility `mouseenter` and no matching `mouseleave`, so on a touch
   * device the stack was stuck expanded and no toast ever dismissed itself.
   * The pause is deliberate and must stay; what is pinned is that "hovered"
   * is decided by a pointer that can actually hover.
   */
  it('still pauses the stack while it is genuinely hovered', () => {
    expect(STACK).toContain('if (expanded) return;');
  });

  it('expands on a mouse pointer, not on a tap', () => {
    expect(STACK).toContain("event.pointerType !== 'mouse'");
    expect(STACK).toContain('onPointerEnter');
    expect(STACK).toContain('onPointerLeave');
    expect(STACK).not.toContain('onMouseEnter');
    expect(STACK).not.toContain('onMouseLeave');
  });
});

describe('the collapsed stack', () => {
  it('peeks 8px, marked as a local change', () => {
    expect(STACK).toContain('const PEEK = 8; // LOCAL CHANGE: was 16');
  });

  it('still caps the collapsed pile at three', () => {
    expect(STACK).toContain('const MAX_VISIBLE = 3;');
    expect(STACK).toContain('index >= MAX_VISIBLE');
  });

  it('keeps the live region', () => {
    expect(STACK).toContain('aria-live="polite"');
  });
});
