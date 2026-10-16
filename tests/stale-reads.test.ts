/**
 * What a screen shows when it comes back from an app switch.
 *
 * Two independent caches sit between a read and the origin, and the reported
 * sequence — add a calendar event, switch apps, come back, and it is not there
 * until some later read — is both of them at once:
 *
 *   1. the store's memory. The foreground revalidation was a *non-forced* load,
 *      so the fifteen-second `staleAfterMs` gate answered it from memory;
 *   2. the service worker's per-session copy, which answered whatever got past
 *      the gate with the body from before the write — while the fresher body it
 *      fetched alongside went into the cache for the *next* read. That is
 *      precisely "the events eventually show up".
 *
 * So a read the app makes *because* something changed has to be able to say so,
 * end to end: `useResource`'s forced load carries `fresh`, `api-client` turns it
 * into a header, and the worker skips its own copy for a read carrying it. The
 * resume has to force in the first place. The mutation end is the same story
 * from the other side: a calendar sync whose response was lost has still
 * happened, so a failure must not leave the screen stale.
 *
 * The worker's half is behavioural in `pwa-sw.test.ts` and the header's is in
 * `api-client-resilience.test.ts`. What is left — the wiring between them — only
 * exists as source, which is what this file pins.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = (relative: string): string =>
  readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8');

const STORE = source('src/lib/store.ts');
const CLIENT = source('src/lib/api-client.ts');
const SW = source('public/sw.js');
const TASKS = source('src/components/tasks/TasksView.tsx');
const EDITOR = source('src/components/calendar/EventEditorSheet.tsx');
const SCREEN = source('src/components/calendar/CalendarScreen.tsx');

describe('a forced read asks the origin, not the caches in front of it', () => {
  it('sends the fresh header from the one place a read is made', () => {
    // The header name is stated once and read by the worker's own constant of
    // the same name; a typo in either would silently disable the whole path.
    expect(CLIENT).toContain("export const FRESH_READ_HEADER = 'X-TaskTick-Fresh';");
    expect(SW).toContain("const FRESH_READ_HEADER = 'X-TaskTick-Fresh';");
    expect(CLIENT).toContain('freshReadHeaders(options?.fresh === true)');
  });

  it('carries the forced flag from `load(force)` through to the request', () => {
    // `useResource`'s `load(force)` is the only caller that knows a read is a
    // revalidation; if it stops passing `force` on, every forced read quietly
    // becomes an ordinary one and the worker's copy is back in charge.
    expect(STORE).toContain('{ fresh: force }');
  });

  it('skips the cached copy for a read that carries it', () => {
    expect(SW).toContain('const wantsFresh = request.headers.get(FRESH_READ_HEADER) === \'1\';');
    expect(SW).toContain('if (cached && !wantsFresh) {');
    // With nothing cached, or with the network silent, the copy is still the
    // fallback — a resumed screen offline shows the data it left with rather
    // than an offline error.
    expect(SW).toContain('return cached ?? offlineResponse();');
  });
});

describe('a resume revalidates forcibly', () => {
  it('forces on visibility, not merely on the fifteen-second gate', () => {
    expect(STORE).toContain("if (document.visibilityState === 'visible') void load(true);");
  });

  it('forces on a back/forward-cache restore too', () => {
    // iOS restores a backgrounded web app from the bfcache, which fires
    // `pageshow` with `persisted` set and need not fire `visibilitychange`.
    expect(STORE).toContain("window.addEventListener('pageshow', onPageShow);");
    expect(STORE).toContain('if (event.persisted) void load(true);');
    expect(STORE).toContain("window.removeEventListener('pageshow', onPageShow);");
  });

  it('still leaves a resource that opted out of focus revalidation alone', () => {
    expect(STORE).toContain('if (!revalidateOnFocus) return;');
  });
});

describe('a write whose answer was lost still refreshes what it changed', () => {
  it('drops and refetches on failure when the caller says the failure is ambiguous', () => {
    expect(STORE).toContain('invalidateOnError?: boolean;');
    expect(STORE).toContain('if (options.invalidateOnError && prefixes.length > 0) await invalidate(prefixes);');
  });

  it('is off by default, because a rejected write changed nothing', () => {
    // The default has to stay off: refetching every read a failed write would
    // have touched is a burst of requests to be told what is already on screen.
    expect(STORE).not.toContain('invalidateOnError = true');
  });

  it('is asked for by the calendar refresh, whose sweep is unbounded', () => {
    expect(TASKS).toContain('invalidateOnError: true,');
    expect(TASKS).toContain("affectsFor('POST', '/api/calendars/sync')");
  });
});

describe('a read that began before a drop is not stored by it', () => {
  it('bumps a generation when the session cache is invalidated', () => {
    // The worker never sees the write, so the page names the prefixes. A read
    // already on the wire when that lands still holds the pre-write body.
    expect(SW).toContain('apiEpoch += 1;');
    expect(SW).toContain('const epoch = apiEpoch;');
    expect(SW).toContain('&& epoch === apiEpoch');
  });
});

describe('a new calendar event opens with the caret in its title', () => {
  it('focuses the title, but only when creating', () => {
    // Creating is typing a title and then filling in when; editing is reading a
    // form that arrived filled in, where a stolen caret raises a keyboard over
    // the field the user came to look at.
    expect(EDITOR).toContain('if (!isEdit) titleRef.current?.focus({ preventScroll: true });');
    expect(EDITOR).toContain('if (event || readOnly) return;');
    expect(EDITOR).toContain('ref={titleRef}');
  });

  it('does it in a layout effect, which is what raises the keyboard on iOS', () => {
    // iOS raises the keyboard only when `focus()` runs in the task that handled
    // the tap; a passive effect is a frame later, in another task, where the
    // gesture is spent.
    expect(EDITOR).toContain('useLayoutEffect(() => {');
  });

  it('flushes the open inside the gesture, so the field exists in that task', () => {
    expect(SCREEN).toContain('flushSync(() => {');
    expect(SCREEN).toContain('import { flushSync } from \'react-dom\';');
  });
});
