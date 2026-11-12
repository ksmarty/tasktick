'use client';

/**
 * Live data, for a page that did not make the change.
 *
 * Every write the app itself makes already drops the reads it touched and
 * refetches them (`invalidate()` in `store.ts`), so a screen is never stale
 * because of something *it* did. What it cannot know about is everything else:
 * an automation that calls the API, a second browser, a phone, a CalDAV push
 * landing on the server. Today those show up on the next navigation, which reads
 * as "the app is not live".
 *
 * So the page asks one cheap question on a timer — "has anything changed for me?"
 * — and on a different answer drops every read it holds and refetches the mounted
 * ones. That is the same wave a local write causes, just triggered by the server
 * saying so. `startLiveSync` is deliberately the only place that knows the
 * interval or the endpoint.
 *
 * ## Why this and not a socket
 *
 * A push channel needs the server to know which connections are open, which is a
 * second source of truth next to the database, and it needs a reconnect story
 * through the service worker and the app's own offline layer. A token costs six
 * indexes and one small response, needs nothing but the session cookie, and is
 * correct after any amount of time spent in another app — a socket has usually
 * dropped by then, while a token is read fresh.
 *
 * ## What it costs when nothing is happening
 *
 * One request every `POLL_INTERVAL_MS`, and none of them while the document is
 * hidden or the browser says it is offline: a page in the background cannot show
 * anything, and a page with no network has nothing to ask. Coming back triggers a
 * read immediately — the token it compares against is the one from before it
 * left, so a change made while it was away is caught on that first poll instead of
 * a full interval later.
 *
 * A failed poll backs off to `RETRY_INTERVAL_MS` rather than retrying at the tick
 * rate: a server that is down is not a server to hammer, and the next success
 * resets the cadence.
 */
import { FRESH_READ_HEADER } from './api-client';

const ENDPOINT = '/api/sync/version';

/** Often enough to read as live, rarely enough to ignore in a log. */
const POLL_INTERVAL_MS = 5_000;

/** What a failed poll waits before trying again. */
const RETRY_INTERVAL_MS = 20_000;

/** A poll that has not answered by then is treated as failed. */
const POLL_TIMEOUT_MS = 8_000;

export interface LiveSyncOptions {
  /** Called when the server's token has moved. Dropping the reads is the caller's. */
  onChange: () => void | Promise<void>;
  /** Override for tests. */
  intervalMs?: number;
}

/**
 * Starts the poll and returns the function that stops it.
 *
 * Nothing runs until the first scheduled tick, so a session that never becomes
 * idle never asks. The token starts absent, which means the first answer is
 * recorded without firing `onChange` — an app that has just loaded is not behind.
 */
export function startLiveSync({ onChange, intervalMs = POLL_INTERVAL_MS }: LiveSyncOptions): () => void {
  if (typeof window === 'undefined') return () => {};

  let timer: ReturnType<typeof setTimeout> | null = null;
  let token: string | null = null;
  let inFlight = false;
  let stopped = false;

  function schedule(delay: number) {
    if (timer !== null) clearTimeout(timer);
    timer = stopped ? null : setTimeout(() => void poll(), delay);
  }

  function visible() {
    return document.visibilityState === 'visible';
  }

  async function poll(): Promise<void> {
    if (stopped || inFlight) return;
    if (!visible() || navigator.onLine === false) {
      schedule(intervalMs);
      return;
    }

    inFlight = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), POLL_TIMEOUT_MS);
    try {
      /*
       * Forced fresh: the service worker answers a `/api/**` read from this
       * session's own copy the moment it has one, which for this endpoint would
       * be a token frozen at the moment the page loaded — the feature switching
       * itself off while looking perfectly healthy.
       */
      const response = await fetch(ENDPOINT, {
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { [FRESH_READ_HEADER]: '1', Accept: 'application/json' },
        signal: controller.signal,
      });
      if (!response.ok) {
        schedule(RETRY_INTERVAL_MS);
        return;
      }
      const envelope = (await response.json()) as { ok?: boolean; data?: { token?: string } };
      const next = envelope?.data?.token;
      if (typeof next === 'string') {
        if (token !== null && next !== token) await onChange();
        token = next;
      }
      schedule(intervalMs);
    } catch {
      // Offline mid-flight, aborted, or not JSON: all the same decision.
      schedule(RETRY_INTERVAL_MS);
    } finally {
      clearTimeout(timeout);
      inFlight = false;
    }
  }

  /*
   * Leaving and returning, and losing and regaining the network, are the two
   * moments a page is most likely to be behind — so both read at once instead of
   * waiting out the tick.
   */
  const wake = () => {
    if (stopped) return;
    if (!visible() || navigator.onLine === false) return;
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => void poll(), 0);
  };

  document.addEventListener('visibilitychange', wake);
  window.addEventListener('online', wake);
  window.addEventListener('focus', wake);

  schedule(intervalMs);

  return () => {
    stopped = true;
    if (timer !== null) clearTimeout(timer);
    timer = null;
    document.removeEventListener('visibilitychange', wake);
    window.removeEventListener('online', wake);
    window.removeEventListener('focus', wake);
  };
}
