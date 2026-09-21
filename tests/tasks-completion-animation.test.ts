/**
 * The completion Undo's colour and the completion animations, pinned.
 *
 * Two kinds of assertion live here, and the difference matters:
 *
 *  - **The colour is pinned by its resolved contrast**, computed from the values
 *    in `globals.css`. `--chart-2` on the glyph's `--background` in both themes,
 *    through a real OKLCH → sRGB → relative-luminance conversion. That is a
 *    number, so it fails when the palette moves under the control — which is the
 *    failure this whole change exists to prevent, since the colour it replaced
 *    (`--secondary`) had 1.09:1 against the light page and 1.00:1 against the
 *    dark one. The same numbers are asserted for `--secondary` below, so the
 *    reason the old colour was wrong is a pinned fact and not a claim in a
 *    comment.
 *  - **The animations are pinned structurally**, as `habits-ring-animation` and
 *    `habits-checkin-animation` do: there is no jsdom in this repo, these are
 *    client components bound to pointer handlers, and what regresses silently is
 *    the *shape* of the contract — which hook the reduced-motion decision comes
 *    from, that the exit ran the entrance backwards, that a recurring task is
 *    excluded from the completion beat, and that the presence wrapper is scoped
 *    to one section's rows and suppressed on first paint.
 *
 * Every source assertion runs against comment-stripped code: the previous
 * assertion for this control was satisfied by a *comment* after the colour
 * changed, which is the way a pin turns into decoration.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function source(relative: string): string {
  return readFileSync(new URL(`../src/${relative}`, import.meta.url), 'utf8');
}

/** The source with block and line comments removed. */
function code(relative: string): string {
  return source(relative)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');
}

const CSS = source('app/globals.css');
const UNDO = code('components/tasks/CompletionUndo.tsx');
const ROW = code('components/tasks/TaskRow.tsx');
const SECTION = code('components/tasks/TaskListSection.tsx');
const FOLD = code('components/tasks/SectionFold.tsx');
const TASKS_VIEW = code('components/tasks/TasksView.tsx');
const TODAY_VIEW = code('components/tasks/TodayView.tsx');

/* -------------------------------------------------------------------------- */
/* OKLCH → WCAG contrast, so the palette can be checked as a resolved value    */
/* -------------------------------------------------------------------------- */

function oklchToLinear(L: number, C: number, hDeg: number): [number, number, number] {
  const h = (hDeg * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const relativeLuminance = ([r, g, b]: [number, number, number]) =>
  0.2126 * clamp01(r) + 0.7152 * clamp01(g) + 0.0722 * clamp01(b);

/** WCAG 2.x contrast ratio between two linear-light colours. */
function contrast(a: [number, number, number], b: [number, number, number]): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Reads one token's `oklch(L C h)` out of a block of `globals.css`. */
function oklch(css: string, token: string): [number, number, number] {
  const match = css.match(new RegExp(`--${token}:\\s*oklch\\(\\s*([\\d.]+)\\s+([\\d.]+)\\s+([\\d.]+)\\s*\\)`));
  if (!match) throw new Error(`--${token} not found as an oklch() value`);
  return oklchToLinear(Number(match[1]), Number(match[2]), Number(match[3]));
}

/** `:root` is light, `.dark` is dark; each block is taken on its own. */
const lightBlock = CSS.slice(CSS.indexOf(':root'), CSS.indexOf('.dark {'));
const darkBlock = CSS.slice(CSS.indexOf('.dark {'), CSS.indexOf('@theme inline'));

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

describe('the Undo disc is legible in both themes', () => {
  it('keeps at least 3:1 between the glyph and the disc', () => {
    // `bg-chart-2 text-background`: the ink is the page background, which is
    // white in light mode and near-black in dark, so it flips with the theme
    // exactly as the disc's lightness requires.
    const pairs = [
      { theme: 'light', disc: oklch(lightBlock, 'chart-2'), ink: oklch(lightBlock, 'background') },
      { theme: 'dark', disc: oklch(darkBlock, 'chart-2'), ink: oklch(darkBlock, 'background') },
    ];
    for (const pair of pairs) {
      const ratio = round(contrast(pair.disc, pair.ink));
      // eslint-disable-next-line no-console
      console.log(`undo glyph on the ${pair.theme} disc: ${ratio}:1`);
      expect(ratio, `${pair.theme} glyph vs disc`).toBeGreaterThanOrEqual(3);
    }
  });

  it('stands out from the page it floats over, in both themes', () => {
    const light = round(contrast(oklch(lightBlock, 'chart-2'), oklch(lightBlock, 'background')));
    const dark = round(contrast(oklch(darkBlock, 'chart-2'), oklch(darkBlock, 'background')));
    expect(light).toBeGreaterThanOrEqual(3);
    expect(dark).toBeGreaterThanOrEqual(3);
  });

  it('is not a surface token, which is what "just grey" was', () => {
    /*
     * The old colour. `--secondary` is the card surface: within 1.1:1 of the page
     * in both themes, so the disc was the surface it sat on. Asserted here rather
     * than described, so if someone re-points `--secondary` at something with
     * contrast this test says so instead of the comment going stale.
     */
    const lightSecondary = round(contrast(oklch(lightBlock, 'secondary'), oklch(lightBlock, 'background')));
    const darkSecondary = round(contrast(oklch(darkBlock, 'secondary'), oklch(darkBlock, 'background')));
    expect(lightSecondary).toBeLessThan(2);
    expect(darkSecondary).toBeLessThan(2);
    // And the disc is a different token than both the surface and the action
    // button's fill.
    expect(UNDO).toContain('bg-chart-2');
    expect(UNDO).not.toContain('bg-secondary');
    expect(UNDO).not.toContain('bg-primary');
  });

  it('is still the 56px icon-only circle above the action button', () => {
    expect(UNDO).toContain('size-14');
    expect(UNDO).toContain('rounded-full');
    expect(UNDO).toContain('right-gutter');
    expect(UNDO).toContain('aria-label={`Undo completing ${task.title}`}');
    // The window is still the user's 2s.
    expect(UNDO).toContain('const COMPLETION_UNDO_MS = 2000;');
    expect(UNDO).toContain('window.setTimeout(() => dismissRef.current(), COMPLETION_UNDO_MS)');
  });
});

describe('the Undo control has an entrance, a dwell and a mirrored exit', () => {
  it('is one presence wrapper keyed by the task, so a second completion replaces it', () => {
    expect(UNDO).toContain('<AnimatePresence>');
    expect(UNDO).toMatch(/key=\{task\.id\}/);
    expect(UNDO).toContain('motion.div');
    // It still leaves the DOM entirely when there is nothing to undo.
    expect(UNDO).toMatch(/\{task \? \(/);
  });

  it('enters on a spring and leaves the way it came in', () => {
    // The entrance: transparent, 14px low, at 60% scale.
    expect(UNDO).toMatch(/initial=\{[^}]*opacity: 0, y: UNDO_TRAVEL_PX, scale: 0\.6\s*\}/);
    expect(UNDO).toMatch(/animate=\{\{ opacity: 1, y: 0, scale: 1 \}\}/);
    // The exit is the mirror: the same three values, on a short ease.
    expect(UNDO).toMatch(/exit=\{/);
    expect(UNDO).toMatch(/opacity: 0,\s*y: UNDO_TRAVEL_PX,\s*scale: 0\.6,/);
    expect(UNDO).toContain('type: \'spring\'');
    expect(UNDO).toContain('ease: \'easeIn\'');
    // A press has its own feedback.
    expect(UNDO).toContain('whileTap');
  });

  it('draws the eye once, with one halo that then stays still', () => {
    // One expanding ring in the completion hue, behind the button and out of the
    // pointer's way. No `repeat`, no `Infinity` — a cue that loops is a nag.
    expect(UNDO).toContain('border-chart-2');
    expect(UNDO).toContain('pointer-events-none absolute -inset-1 rounded-full');
    expect(UNDO).toMatch(/animate=\{\{ opacity: 0, scale: 1\.5 \}\}/);
    expect(UNDO).not.toContain('repeat');
    expect(UNDO).not.toContain('Infinity');
  });

  it('reads the app’s motion preference, not the media query', () => {
    expect(UNDO).toContain("import { useReducedMotion } from '@/lib/motion';");
    expect(UNDO).not.toMatch(/import\s*\{[^}]*useReducedMotion[^}]*\}\s*from\s*'framer-motion'/);
    // Under it: no entrance at all, a zero-length exit, no halo, no press dip.
    expect(UNDO).toMatch(/initial=\{reduceMotion \? false : \{/);
    expect(UNDO).toMatch(/transition=\{reduceMotion \? \{ duration: 0 \} : UNDO_ENTRANCE\}/);
    expect(UNDO).toMatch(/whileTap=\{reduceMotion \? undefined : \{ scale: 0\.9 \}\}/);
    expect(UNDO).toMatch(/\{reduceMotion \? null : \(/);
  });
});

describe('completing a task animates the row, and the recurring case does not', () => {
  it('folds the row with a height collapse, so the gap closes continuously', () => {
    // Height, not opacity alone: a fade would only postpone the jump the row's
    // removal causes.
    expect(ROW).toMatch(/exit: \{\s*opacity: 0,\s*height: 0,/);
    expect(ROW).toMatch(/animate: \{ opacity: 1, height: 'auto' as const \}/);
    // No `layout` on the rows: the collapsing height moves the siblings for
    // free, where `layout` would measure every row on every frame.
    expect(ROW).not.toContain('layout');
  });

  it('gives a one-off completion the beat and a recurring task none of it', () => {
    // The checkbox pop is the "finished" beat, and it is suppressed for a task
    // whose tick rolls the series forward.
    expect(ROW).toContain('if (!completed && !task.recurrenceRule) setJustCompleted(true);');
    // The exit's shrink is gated the same way: a recurring row folds, but it is
    // not given the completion flourish.
    expect(ROW).toContain('...(task.recurrenceRule ? {} : { scale: 0.97 })');
    // The pop itself is the existing animation, untouched.
    expect(ROW).toMatch(/animate=\{justCompleted && !reduceMotion \? \{ scale: \[0\.82, 1\.12, 1\] \} : \{ scale: 1 \}\}/);
  });

  it('honours the app’s motion preference for the row too', () => {
    expect(ROW).toContain("import { useReducedMotion } from '@/lib/motion';");
    expect(ROW).not.toMatch(/import\s*\{[^}]*useReducedMotion[^}]*\}\s*from\s*'framer-motion'/);
    // Under it the row is simply there and simply gone.
    expect(ROW).toMatch(/initial: false as const,\s*animate: \{ opacity: 1 \},\s*exit: \{ opacity: 0, transition: \{ duration: 0 \} \},\s*transition: \{ duration: 0 \},/);
  });

  it('keeps presence scoped to one section’s rows, suppressed on first paint', () => {
    expect(SECTION).toContain("import { AnimatePresence } from 'framer-motion';");
    // One wrapper per section, around the tasks only: events never leave for a
    // completion, and `initial={false}` is what keeps a tab switch from drawing
    // the list row by row.
    expect(SECTION).toContain('<AnimatePresence initial={false}>');
    const rows = SECTION.slice(SECTION.indexOf('<AnimatePresence initial={false}>'));
    expect(rows.indexOf('section.tasks.map')).toBeLessThan(rows.indexOf('</AnimatePresence>'));
  });

  it('folds an emptied section card too, clipping only while it leaves', () => {
    // The last row of a group takes the group with it; without this the card —
    // and the row's exit with it — is removed in a single frame.
    expect(FOLD).toContain("import { motion, useIsPresent } from 'framer-motion';");
    expect(FOLD).toContain('const present = useIsPresent();');
    expect(FOLD).toContain("cn(!present && 'overflow-hidden', className)");
    expect(FOLD).toMatch(/exit=\{/);
    expect(FOLD).toMatch(/opacity: 0,\s*height: 0,/);
    // No entrance: a card appearing must not move the list below it.
    expect(FOLD).not.toContain('initial=');
    for (const view of [TASKS_VIEW, TODAY_VIEW]) {
      expect(view).toContain("import { SectionFold } from './SectionFold';");
      expect(view).toContain('<AnimatePresence initial={false}>');
      expect(view).toContain('<SectionFold key={section.id}>');
    }
  });

  it('keeps the AnimatePresence in `TasksView` for the search field alone', () => {
    // The screen already had one presence wrapper; the rows did not get a second
    // mechanism, they got the same one one level down. If a third appears the
    // list has grown two ways to animate, which is what this guards.
    const wrappers = (TASKS_VIEW.match(/<AnimatePresence/g) ?? []).length;
    expect(wrappers).toBe(2);
  });
});
