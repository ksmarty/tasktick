/**
 * The shell's route transition.
 *
 * The wrapper between the pane and the page used to be a framer-motion
 * `motion.div` with `initial={{ opacity: 0 }}` / `transition={{ duration: 0.34 }}`.
 * That shape cost the user twice — an inline `style="opacity:0"` in the
 * server-rendered HTML (so a cold load painted the page invisible until the
 * bundle hydrated) and a main-thread animation running while the route's own
 * first render needed the thread. It is now the same fade the dialogs use, in
 * CSS: no JS, compositor-driven, 150ms.
 *
 * The client components cannot be rendered in node, so the contract is pinned
 * from source, like the rest of this suite.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const SHELL = readFileSync(
  new URL('../src/components/app/AppShell.tsx', import.meta.url),
  'utf8',
);

describe('the route fade', () => {
  it('is a CSS animation, so the first paint does not wait for hydration', () => {
    expect(SHELL).not.toContain("import { motion } from 'framer-motion'");
    expect(SHELL).not.toContain('initial={{ opacity: 0 }}');
    expect(SHELL).toContain('animate-in');
    expect(SHELL).toContain('fade-in');
  });

  it('is short enough to not be the wait', () => {
    expect(SHELL).toContain('duration-150');
    expect(SHELL).not.toContain('duration: 0.34');
  });

  it('is opacity only, so the wrapper is not a containing block for fixed bars', () => {
    expect(SHELL).not.toContain('zoom-in');
    expect(SHELL).not.toContain('slide-in');
  });

  it('still remounts per destination, or the animation would run once ever', () => {
    expect(SHELL).toContain('key={contentKey}');
  });

  it('keeps the pane’s scroll guarantee and its full-height mode', () => {
    expect(SHELL).toContain("'flex animate-in flex-col gap-stack fade-in duration-150 ease-out'");
    expect(SHELL).toContain("paneFullHeight ? 'h-full' : 'min-h-[calc(100%_+_3rem)]'");
  });
});
