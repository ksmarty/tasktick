/**
 * When a screen may start reading.
 *
 * A cold launch used to chain three round trips: the bootstrap answered, then
 * the task list asked, then the calendar asked — each one waiting for the one
 * before it, on the launch that was already waiting for its own document. The
 * document is now served from disk (see `pwa-sw.test.ts`); this is the data half
 * of the same launch.
 *
 * The store restores its persisted reads in one pass, and `hydrated` is the flag
 * that says the pass is done. Gating on it rather than on the bootstrap payload
 * is the difference between "start now, in parallel" and "start after the
 * bootstrap" — and the pass finishes even when the bootstrap fails or was never
 * cached, which the payload can never say.
 *
 * The hook needs a renderer and the pass needs IndexedDB, so the wiring is pinned
 * as source: that is exactly the part that can regress silently.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = (relative: string): string =>
  readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8');

const STORE = source('src/lib/store.ts');
const VIEW = source('src/components/tasks/TasksView.tsx');

describe('the store says when its disk pass is done', () => {
  it('marks the pass finished on both of its exits', () => {
    /*
     * Two paths return from `hydrateCache`: an empty disk (a first launch) and a
     * restored cache. The first one is the case that made this flag necessary —
     * nothing to restore still means there is nothing left to wait for, and
     * without the mark a fresh install would gate its reads on a pass that has
     * already finished.
     */
    expect(STORE).toContain('let cacheHydrated = false;');
    expect(STORE.match(/\bmarkHydrated\(\);/g)).toHaveLength(2);
    expect(STORE).toContain('function markHydrated(): void {');
    /*
     * The flag is only ever set to true. It answers "is there more disk to read?",
     * not "is there data?" — a cleared cache has been read just as thoroughly as
     * a full one, and resetting it would gate the next screen on a pass that is
     * not going to run again.
     */
    expect(STORE.match(/cacheHydrated = (?:true|false)/g)).toEqual([
      'cacheHydrated = false',
      'cacheHydrated = true',
    ]);
  });

  it('wakes the gated screens when it lands', () => {
    /*
     * `useSyncExternalStore` only re-reads a snapshot when the store emits, so a
     * mark that does not emit leaves every gated read waiting for the next
     * unrelated write.
     */
    const mark = STORE.slice(STORE.indexOf('function markHydrated'), STORE.indexOf('}', STORE.indexOf('function markHydrated')));
    expect(mark).toContain('cacheHydrated = true;');
    expect(mark).toContain('emit();');
  });

  it('exposes the flag as a hook, defaulting to false on the server', () => {
    expect(STORE).toContain('export function useCacheHydrated(): boolean {');
    expect(STORE).toContain(
      'return useSyncExternalStore(subscribe, () => cacheHydrated, () => false);',
    );
  });
});

describe('the All-tasks screen starts reading as soon as it may', () => {
  it('opens its gate on the pass, not on the bootstrap payload', () => {
    expect(VIEW).toContain('const hydrated = useCacheHydrated();');
    expect(VIEW).toContain(
      'const bootstrapReady = hydrated || Boolean(bootstrap.data) || Boolean(bootstrap.error);',
    );
    /*
     * Every read of the screen stays behind the one gate — a read that escaped it
     * would fetch before the pass and paint the skeleton the gate exists to
     * avoid.
     */
    expect(VIEW.match(/enabled: bootstrapReady/g)).toHaveLength(3);
  });
});
