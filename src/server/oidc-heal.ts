/**
 * Recovers a provider that was dropped when the auth instance was built.
 *
 * better-auth resolves a generic OIDC provider by fetching its discovery
 * document once, in the plugin's `init`. If that fetch fails — the provider was
 * restarting, DNS was not up yet, the container booted before its network — the
 * provider is skipped and the library carries on without it. Nothing retries.
 * The result is a sign-in button that renders forever and an endpoint that
 * answers `404 PROVIDER_NOT_FOUND` until somebody restarts the process. That is
 * indistinguishable, from the outside, from "OIDC is broken".
 *
 * The fix is a targeted retry: only a 404 that says *this* provider is missing
 * causes the cached instance to be rebuilt (which re-runs discovery) and the
 * request to be replayed once. A genuine 404, or a request naming a provider we
 * never configure, passes through untouched.
 */
import { getAuth, resetAuthCache } from './auth';
import { oidcConfigured } from '@/lib/env';

/** better-auth's code for "no social provider with that id is registered". */
const PROVIDER_NOT_FOUND = 'PROVIDER_NOT_FOUND';

/** Our provider id, matching `providerId` in `buildOAuthPlugins()`. */
const PROVIDER_ID = 'oidc';

/**
 * Whether the request is a sign-in for our OIDC provider.
 *
 * Read from a copy: the copy is only inspected, and the body better-auth parses
 * belongs to a different copy, so nothing here can consume it.
 */
async function targetsOidcProvider(request: Request): Promise<boolean> {
  if (request.method !== 'POST') return false;
  try {
    const body: unknown = await request.json();
    return (
      typeof body === 'object' && body !== null && (body as { provider?: unknown }).provider === PROVIDER_ID
    );
  } catch {
    return false;
  }
}

async function isProviderNotFound(response: Response): Promise<boolean> {
  try {
    const payload: unknown = await response.json();
    return (
      typeof payload === 'object' &&
      payload !== null &&
      (payload as { code?: unknown }).code === PROVIDER_NOT_FOUND
    );
  } catch {
    return false;
  }
}

/**
 * Runs an auth request, and replays it once if the provider turned out to be
 * missing because discovery failed at startup.
 */
export async function withProviderHeal(
  request: Request,
  handle: (request: Request) => Promise<Response>,
): Promise<Response> {
  if (!oidcConfigured()) return handle(request);

  // Two copies before anything is consumed: one for the retry, one to inspect.
  const replayable = request.clone();
  const inspector = request.clone();

  const response = await handle(request);
  if (response.status !== 404 || !(await isProviderNotFound(response))) return response;
  if (!(await targetsOidcProvider(inspector))) return response;

  // Rebuilding re-runs the plugin's discovery fetch against the provider as it
  // is now. If it is still unreachable the replay returns the same 404, and the
  // next attempt tries again — a failure mode that costs one extra fetch instead
  // of costing a restart.
  console.warn(
    '[auth] the OIDC provider is missing from the auth context — discovery must have failed when it was built. Rebuilding and retrying this request.',
  );
  resetAuthCache();
  return handle(replayable);
}
