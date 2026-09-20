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

const WRAPPER = source('components/app/Toast.tsx');
const STACK = source('components/godui/toast.tsx');
const TASKS_VIEW = source('components/tasks/TasksView.tsx');
const TODAY_VIEW = source('components/tasks/TodayView.tsx');

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
   */
  it('gives an action-carrying banner a finite, longer window', () => {
    expect(WRAPPER).toContain('const ACTION_DURATION = 5000;');
    expect(WRAPPER).toContain('banner.action ? ACTION_DURATION');
    for (const view of [TASKS_VIEW, TODAY_VIEW]) {
      expect(view).not.toMatch(/duration:\s*0\s*[,}]/);
      expect(view).not.toContain('duration: 5000');
      expect(view).toContain("action: { label: 'Undo'");
    }
  });
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
