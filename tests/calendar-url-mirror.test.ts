/**
 * The calendar screen's `?date=` mirror.
 *
 * The screen keeps the selected day in the query string so a reload, a bookmark
 * or the back gesture lands on the day the user was looking at. It used to do
 * that with `router.replace`, which asks the App Router to render the new URL —
 * and this route reads `searchParams`, so every mirrored day became a server
 * round trip for a route payload (`/calendar?date=…&_rsc=…`).
 *
 * OFFLINE that is fatal, and it is the whole of the reported "glitch loop":
 * the worker has no payload cached for that exact `_rsc` URL and answers 503,
 * the router treats the failure as a dead end and falls back to a full DOCUMENT
 * navigation, the worker serves the cached document, the screen boots and
 * mirrors the URL again, which misses again. Measured before the fix: 48
 * document responses and 96 main-frame navigations in a 10.1s window (≈4.8
 * boots/s, ≈9.5 navigations/s), indefinitely.
 *
 * `window.history.replaceState` updates the address bar without asking the
 * router for anything, and the equality guard is what makes it a no-op on a
 * document that was loaded at a `?date=` URL in the first place.
 *
 * The client component cannot be rendered in node, so the contract is pinned
 * from source, like the rest of this suite.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const SCREEN = readFileSync(
  new URL('../src/components/calendar/CalendarScreen.tsx', import.meta.url),
  'utf8',
);

describe('the calendar URL mirror never asks the router for a route payload', () => {
  it('writes the query with the history API, not router.replace', () => {
    expect(SCREEN).toContain('window.history.replaceState(null, \'\', next)');
    // `router.replace` here is what produced the offline 503 → hard navigation
    // loop, so its absence is the fix, not an implementation detail.
    expect(SCREEN).not.toContain('router.replace(');
    expect(SCREEN).not.toContain("from 'next/navigation'");
  });

  it('is a no-op when the URL already matches, so a booted document does not re-mirror', () => {
    expect(SCREEN).toContain('if (next === `${window.location.pathname}${window.location.search}`) return;');
  });

  it('still mirrors both pieces of state the URL carries', () => {
    expect(SCREEN).toContain("new URLSearchParams({ date: selected })");
    expect(SCREEN).toContain("if (filterId) params.set('calendar', filterId);");
  });
});
