/**
 * Whether single sign-on can actually start, not merely whether it is configured.
 *
 * `oidcConfigured()` only looks at environment variables, so it says "yes" for a
 * provider the server has never successfully talked to. That answer is what put
 * a live-looking SSO button on the sign-in page while every click behind it
 * failed: better-auth fetches the provider's discovery document once, per auth
 * instance, and silently drops the provider when that fetch fails — so the
 * button rendered and the endpoint behind it answered 404.
 *
 * This module asks the same question the library asks, in the same way (a plain
 * GET of the discovery URL), and turns a failure into a sentence a person can
 * act on. It is a diagnostic, not a gate: a failed probe here does not disable
 * anything, because a transient failure must not lock a user out of an
 * otherwise working provider. It is cached for a few seconds so that rendering
 * the sign-in page does not become a load test against the identity provider.
 */
import { getEnv, oidcConfigured } from '@/lib/env';

export interface OidcAvailability {
  /** Configured well enough that the button is worth showing. */
  enabled: boolean;
  /** Display name for the provider (`OIDC_PROVIDER_NAME`). */
  name: string;
  /** Why sign-in cannot work, when we know why. Absent means "no complaint". */
  problem?: string;
}

/** Bounded so a black-holed provider cannot hold a page render open. */
const PROBE_TIMEOUT_MS = 3000;

/** Long enough to collapse a burst of renders, short enough to notice a fix. */
const PROBE_TTL_MS = 30_000;

interface Probe {
  /** The URL that was probed; a config change must invalidate the entry. */
  url: string;
  at: number;
  problem?: string;
}

let lastProbe: Probe | null = null;

/**
 * The document better-auth reads at startup.
 *
 * Kept in one place so the probe cannot drift from what `buildOAuthPlugins()`
 * in `src/server/auth.ts` actually fetches: if the URL differs, the probe would
 * happily report "reachable" for something the library never looks at.
 */
export function oidcDiscoveryUrl(): string | null {
  if (!oidcConfigured()) return null;
  const env = getEnv();
  const issuer = env.OIDC_ISSUER!.replace(/\/$/, '');
  return env.OIDC_DISCOVERY_URL ?? `${issuer}/.well-known/openid-configuration`;
}

/** Test seam — lets a suite observe a change without waiting out the TTL. */
export function resetOidcProbeCache(): void {
  lastProbe = null;
}

function describeFetchFailure(error: unknown, timeoutMs: number): string {
  if (error instanceof Error) {
    if (error.name === 'TimeoutError' || error.name === 'AbortError') {
      return `the request timed out after ${timeoutMs / 1000}s`;
    }
    // `fetch failed` wraps the useful part (ENOTFOUND, ECONNREFUSED, a bad
    // certificate) in `cause`; dig it out because that is the actionable text.
    const cause = (error as { cause?: unknown }).cause;
    if (cause instanceof Error && cause.message) return cause.message;
    if (typeof cause === 'object' && cause !== null) {
      const code = (cause as { code?: unknown }).code;
      if (typeof code === 'string' && code) return code;
    }
    if (error.message) return error.message;
  }
  return 'the connection failed';
}

/**
 * Fetches the discovery document and reports the first thing that would stop
 * better-auth from registering the provider.
 */
async function probeDiscovery(url: string): Promise<Probe> {
  const now = Date.now();
  if (lastProbe && lastProbe.url === url && now - lastProbe.at < PROBE_TTL_MS) {
    return lastProbe;
  }

  let result: Probe;
  try {
    const response = await fetch(url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      cache: 'no-store',
    });

    if (!response.ok) {
      result = {
        url,
        at: now,
        problem: `${url} answered HTTP ${response.status}. Check that OIDC_ISSUER points at the provider's base URL.`,
      };
    } else {
      let document: unknown = null;
      try {
        document = await response.json();
      } catch {
        /* handled below */
      }

      if (typeof document !== 'object' || document === null) {
        result = { url, at: now, problem: `${url} did not return an OpenID discovery document.` };
      } else {
        const { authorization_endpoint, token_endpoint } = document as {
          authorization_endpoint?: unknown;
          token_endpoint?: unknown;
        };
        // The same two fields better-auth requires before it will register a
        // provider; a document missing them is a misconfigured issuer, not a
        // network problem, and the messages differ for a reason.
        result =
          typeof authorization_endpoint === 'string' && typeof token_endpoint === 'string'
            ? { url, at: now }
            : {
                url,
                at: now,
                problem: `${url} describes no authorization and token endpoint. Check that OIDC_ISSUER points at the provider itself, not at a proxy path.`,
              };
      }
    }
  } catch (error) {
    result = {
      url,
      at: now,
      problem: `${url} could not be reached from the server (${describeFetchFailure(error, PROBE_TIMEOUT_MS)}). The app needs outbound access to the provider, and to trust its certificate.`,
    };
  }

  lastProbe = result;
  return result;
}

/**
 * Config plus reachability, for screens that have to tell the user the truth
 * before they click. Never throws and never takes longer than the probe timeout.
 */
export async function describeOidcAvailability(): Promise<OidcAvailability> {
  const name = getEnv().OIDC_PROVIDER_NAME ?? 'Single sign-on';
  const url = oidcDiscoveryUrl();
  if (!url) return { enabled: false, name };

  const probe = await probeDiscovery(url);
  return probe.problem ? { enabled: true, name, problem: probe.problem } : { enabled: true, name };
}

/**
 * Boot-time warning, so a broken provider is visible in the container logs
 * instead of only in a failing button.
 *
 * A warning rather than a crash: the provider may be down for reasons that have
 * nothing to do with this app, and password sign-in still works. The retry in
 * `src/server/oidc-heal.ts` recovers the auth instance once it comes back.
 */
export function logOidcAvailability(availability: OidcAvailability): void {
  if (!availability.enabled) return;
  if (availability.problem) {
    console.warn(
      `[startup] OIDC is configured but unusable: ${availability.problem}\n` +
        '[startup] Single sign-on requests will fail until the provider is reachable; the\n' +
        '[startup] app retries the provider on demand, so a restart is not required once\n' +
        '[startup] it is back.',
    );
    return;
  }
  console.log(`[startup] OIDC provider "${availability.name}" reachable`);
}
