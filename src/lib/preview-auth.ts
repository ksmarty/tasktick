/**
 * Preview sign-in — the escape hatch that makes this app screenshottable.
 *
 * ## Why it exists
 *
 * Every screen in this app is behind a session, so every automated look at it —
 * a screenshot tool, a design review, a smoke check of a flow that only exists
 * once there is data — stopped at the password form. Reaching the calendar meant
 * driving a browser through a sign-in first, and the tools that can see the page
 * cannot type.
 *
 * So one environment variable names an account, and a browser asking from this
 * machine is handed that account's session instead of a login form. Nothing else
 * about the session is special: it is better-auth's own session, written by
 * better-auth's own cookie code (`src/server/auth.ts`), so the app renders
 * through exactly the path a real user takes.
 *
 * ## Two keys, and why both
 *
 * 1. **The variable must be set.** There is no default, and no build flag that
 *    turns it on: an instance that never names the variable cannot be reached
 *    this way at all.
 * 2. **The request must arrive over the loopback interface.** This is the half
 *    that keeps a stale `.env` in a container from being a hole: behind a proxy,
 *    or from another machine on the network, the `Host` header is not a loopback
 *    name, so `previewAuthAvailable()` answers `null` and the visitor gets the
 *    ordinary login page. A deployment exposed to the internet is unreachable
 *    through this even with the variable set by mistake.
 *
 * The pair is deliberate: the variable says an operator asked for it, the address
 * says the request is coming from the machine the operator is sitting at.
 *
 * ## What it is not
 *
 * It is not demo mode (`src/server/demo.ts`). Demo mode swaps whose rows a
 * signed-in request may touch and is a feature of the app; this hands out a
 * session and then gets out of the way. It is also not a password: the session
 * it creates belongs to the named account and can read and write that account's
 * data, which is why it is confined to loopback and named after the account.
 */
import { isTruthyEnvFlag } from './env-flags';

/** The variable an operator sets to turn this on. */
export const PREVIEW_AUTH_ENV = 'TASKTICK_PREVIEW_AUTH';

/**
 * The account a bare `TASKTICK_PREVIEW_AUTH=1` signs in as.
 *
 * The seeded development account (`scripts/seed.ts`), deliberately: a preview
 * with an empty database shows empty screens, and an empty screen is the one
 * thing a screenshot cannot help with. An instance that wants a different
 * identity names it in full, e.g. `TASKTICK_PREVIEW_AUTH=qa@example.com`.
 */
export const PREVIEW_DEFAULT_EMAIL = 'demo@tasktick.local';

/**
 * The account this instance offers to loopback browsers, or `null` when the
 * feature is off.
 *
 * Read straight from the environment on every call rather than memoised: it is
 * consulted once per request that would otherwise redirect to a login form, and
 * a memo would make the value impossible to change without restarting — which
 * is the opposite of useful in the environment this exists for.
 */
export function previewAuthEmail(
  env: Record<string, string | undefined> = process.env,
): string | null {
  const raw = env[PREVIEW_AUTH_ENV]?.trim();
  if (!raw) return null;
  if (isTruthyEnvFlag(raw)) return PREVIEW_DEFAULT_EMAIL;

  /*
   * Anything else has to read as an address. A typo — `TASKTICK_PREVIEW_AUTH=on`
   * spelled `onn`, or a value with a stray quote — is refused rather than
   * guessed at, because the failure it would otherwise cause (a silent login
   * page, or worse a session for nobody) is exactly the kind that gets debugged
   * for an hour.
   */
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw) ? raw.toLowerCase() : null;
}

/**
 * Whether a `Host` header names this machine.
 *
 * Only genuine loopback names count. `.localhost` is included because browsers
 * resolve the whole suffix to the loopback address, which is how a project name
 * like `tasktick.localhost:3000` works; everything else — a LAN address, a
 * container name, a public domain — is not this machine, whatever the routing
 * does with it.
 */
export function isLoopbackHost(host: string | null | undefined): boolean {
  if (!host) return false;

  /*
   * A browser brackets an IPv6 literal (`[::1]:3000`) and that is the only form
   * a real request carries — but a hand-built one can arrive bare, and reading
   * `::1` as "not this machine" would be a false negative in the one direction
   * that costs nothing to be generous about.
   */
  const bare = host.trim();
  if (/^::1(?::\d+)?$/.test(bare)) return true;

  let hostname: string;
  try {
    // `URL` is the only correct way to split a name from a port: IPv6 literals
    // are bracketed (`[::1]:3000`), and a naive `split(':')` reads them as a
    // host with four ports.
    hostname = new URL(`http://${host.trim()}`).hostname.toLowerCase();
  } catch {
    return false;
  }

  if (hostname.startsWith('[') && hostname.endsWith(']')) hostname = hostname.slice(1, -1);

  return (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname === '::1' ||
    /^127(?:\.\d{1,3}){3}$/.test(hostname)
  );
}

/**
 * The account to sign in for this request, or `null` to leave it alone.
 *
 * This is the single decision both callers make — the login page (which sends
 * the browser to the sign-in endpoint) and the endpoint itself (which refuses to
 * create a session). Keeping it in one function is what stops the two from
 * drifting into "the page offers what the endpoint will not do", which is a
 * login form that reloads forever.
 */
export function previewAuthAvailable(headers: Headers): string | null {
  const email = previewAuthEmail();
  if (!email) return null;
  return isLoopbackHost(headers.get('host')) ? email : null;
}
