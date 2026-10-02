/**
 * Whether the origin can actually be reached right now.
 *
 * ## Why `navigator.onLine` is not the answer
 *
 * The browser's flag reports whether the device has *an* interface, not whether
 * the origin answers. Handing a phone from Wi-Fi to cellular is the case that
 * breaks the equivalence: for a while after the handover the flag stays `true`
 * while the socket that was open on the old interface is dead, so every request
 * sits there until the browser's own timeout decides — tens of seconds on a link
 * that never refuses, only hangs. The app looks frozen, and nothing it says
 * about the connection is true.
 *
 * So the flag is corrected by what requests actually did. A request that never
 * produced a response — a thrown fetch, or one abandoned at the client's own
 * ceiling — is hard evidence the network is not usable. Any response at all is
 * evidence that it is, including a 4xx or a 5xx: the server was reached and
 * answered, which is the question this module asks. The one exception is the
 * service worker's synthesised `503 { offline: true }`, which is not a server
 * answer at all and is reported as unreachable by `api-client.ts`.
 *
 * ## Why it is a module and not a hook
 *
 * The writer is `transport()` in `api-client.ts`, which is not a component, and
 * the reader is the offline indicator, which is. State has to live outside React
 * for those two to meet. There are no timers and no DOM access here: the module
 * is pure state, so it can be driven from a unit test in node, and
 * `startNetworkHealth()` is the only thing that touches `window`.
 */

type Listener = () => void;

/**
 * Starts `true` — the optimistic default.
 *
 * Nothing has been tried yet, so the app assumes it can reach the server. The
 * first request corrects it either way, and a pessimistic default would flash
 * "you're offline" on every cold start.
 */
let reachable = true;

const listeners = new Set<Listener>();

function emit(): void {
  for (const listener of [...listeners]) {
    try {
      listener();
    } catch (error) {
      console.warn('[network] reachability listener failed', error);
    }
  }
}

/** Records that a request reached the server. Any HTTP status counts. */
export function reportReachable(): void {
  if (reachable) return;
  reachable = true;
  emit();
}

/** Records that a request never reached the server. */
export function reportUnreachable(): void {
  if (!reachable) return;
  reachable = false;
  emit();
}

export function isReachable(): boolean {
  return reachable;
}

export function subscribeReachability(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

let started = false;

/**
 * Follows the browser's own connectivity events. Idempotent; browser-only.
 *
 * The `online` event is taken at face value — a new interface may well work even
 * though the old one did not — and the queue pump listens to the same event, so
 * the claim is tested immediately rather than left standing. The `offline` event
 * needs no interpretation: with no interface at all, nothing can be reached.
 */
export function startNetworkHealth(): void {
  if (started || typeof window === 'undefined') return;
  started = true;

  window.addEventListener('online', reportReachable);
  window.addEventListener('offline', reportUnreachable);
}

/** Test-only: forget all state. */
export function __resetNetworkHealthForTests(): void {
  reachable = true;
  started = false;
  listeners.clear();
}
