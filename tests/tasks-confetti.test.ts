/**
 * Completing a task fires GodUI's confetti; un-completing it and letting a
 * recurring task roll forward do not.
 *
 * Pinned as source because the handler is inside a hook that cannot be rendered
 * here, and as a *behaviour* claim rather than a class name: the three branches
 * are what matter, not that a function was called somewhere in the file.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const ACTIONS = readFileSync(new URL('../src/components/tasks/useTaskActions.ts', import.meta.url), 'utf8');
const CONFETTI = readFileSync(new URL('../src/components/godui/confetti.tsx', import.meta.url), 'utf8');

describe('the completion confetti', () => {
  it('fires a burst when a task is actually completed', () => {
    expect(ACTIONS).toContain("import { fireConfetti } from '@/components/godui/confetti';");
    expect(ACTIONS).toContain('fireConfetti();');
  });

  it('takes the undo flag off the completion payload', () => {
    // Without this the handler cannot tell a completion from its reverse.
    expect(ACTIONS).toContain('onSuccess: (result, [task, undo]) => {');
  });

  it('is in the else branch, so a recurring task and an un-completion both skip it', () => {
    // The burst must sit after the `recurred` toast and be gated on `!undo` — one
    // `if/else if`, not two independent statements that could both run.
    const branch = ACTIONS.slice(ACTIONS.indexOf('if (result.recurred'), ACTIONS.indexOf('fireConfetti();'));
    expect(branch).toContain('} else if (!undo) {');
    expect(branch).not.toContain('} else {');
  });

  it('honours the app’s motion preference rather than a media query', () => {
    // The default is what does the work here, and it must stay on.
    expect(CONFETTI).toContain('disableForReducedMotion: true,');
    // …and it must read the app's own store, not `matchMedia` — the store folds in
    // the user's preference and the Low Power Mode signal too.
    expect(CONFETTI).toContain('appReducedMotionNow');
    expect(CONFETTI).not.toContain('matchMedia');
  });

  it('cannot burst while there is no document', () => {
    // It is called from a mutation callback, which can resolve during a
    // server-side pass in principle; the guard is what makes that safe.
    expect(CONFETTI).toContain("if (typeof window === 'undefined' || typeof document === 'undefined') return;");
  });
});
