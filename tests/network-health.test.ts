/**
 * Reachability, and why it is not `navigator.onLine`.
 *
 * The case this module exists for cannot be produced in a test: a phone handed
 * from Wi-Fi to cellular keeps `navigator.onLine === true` while the socket that
 * was open on the old interface is dead, so requests hang instead of refusing.
 * What *can* be pinned is the correction — that a request which produced no
 * response is recorded as unreachable, that any response at all clears it, and
 * that the browser's own events do both.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __resetNetworkHealthForTests,
  isReachable,
  reportReachable,
  reportUnreachable,
  startNetworkHealth,
  subscribeReachability,
} from '@/lib/network-health';

beforeEach(() => {
  __resetNetworkHealthForTests();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the reachability flag', () => {
  it('starts optimistic, so a cold start does not flash "offline"', () => {
    expect(isReachable()).toBe(true);
  });

  it('goes false on a request that produced no response, and true again on one that did', () => {
    reportUnreachable();
    expect(isReachable()).toBe(false);

    reportReachable();
    expect(isReachable()).toBe(true);
  });

  it('notifies subscribers only when the answer actually changes', () => {
    // `useSyncExternalStore` re-reads its snapshot on every notification, so an
    // emit that changes nothing is wasted work at best and a render loop at
    // worst. Repeating a report must therefore be silent.
    const listener = vi.fn();
    const unsubscribe = subscribeReachability(listener);

    reportUnreachable();
    reportUnreachable();
    expect(listener).toHaveBeenCalledTimes(1);

    reportReachable();
    reportReachable();
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    reportUnreachable();
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('keeps notifying the rest when one listener throws', () => {
    const good = vi.fn();
    const unsubscribeBad = subscribeReachability(() => {
      throw new Error('boom');
    });
    const unsubscribeGood = subscribeReachability(good);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    reportUnreachable();

    expect(good).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalled();

    unsubscribeBad();
    unsubscribeGood();
  });
});

describe('the browser events', () => {
  /** A window with just the two events `startNetworkHealth` listens to. */
  function fakeWindow() {
    const listeners = new Map<string, Set<() => void>>();
    return {
      addEventListener(type: string, listener: () => void) {
        const set = listeners.get(type) ?? new Set<() => void>();
        set.add(listener);
        listeners.set(type, set);
      },
      dispatch(type: string) {
        for (const listener of listeners.get(type) ?? []) listener();
      },
      listenerCount(type: string) {
        return listeners.get(type)?.size ?? 0;
      },
    };
  }

  it('takes the offline event at its word, and treats online as a claim to re-test', () => {
    const window = fakeWindow();
    vi.stubGlobal('window', window);

    startNetworkHealth();
    expect(window.listenerCount('online')).toBe(1);
    expect(window.listenerCount('offline')).toBe(1);

    // With no interface at all there is nothing to reach, so this needs no
    // interpretation.
    window.dispatch('offline');
    expect(isReachable()).toBe(false);

    // A new interface may well work even though the old one did not, so the
    // claim is believed — and the queue pump listens to the same event, which
    // means it is tested against the server immediately rather than left
    // standing.
    window.dispatch('online');
    expect(isReachable()).toBe(true);
  });

  it('installs once, however often it is called', () => {
    const window = fakeWindow();
    vi.stubGlobal('window', window);

    startNetworkHealth();
    startNetworkHealth();

    expect(window.listenerCount('offline')).toBe(1);
    expect(window.listenerCount('online')).toBe(1);
  });

  it('does nothing without a window, so importing it on the server is safe', () => {
    expect(() => startNetworkHealth()).not.toThrow();
    expect(isReachable()).toBe(true);
  });
});
