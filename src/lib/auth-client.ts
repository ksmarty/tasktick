'use client';

/**
 * Browser-side auth client.
 *
 * better-auth owns the session lifecycle; we only wrap it so the UI has a typed,
 * same-origin entry point. No base URL is needed because the handler is mounted
 * at `/api/auth/*` on this origin.
 */
import { createAuthClient } from 'better-auth/react';
import { purgeSession } from './session-scope';

export const authClient = createAuthClient({});

export const { signIn, signUp, useSession } = authClient;

const endSession = authClient.signOut;

/**
 * Signs out, and takes the local data with it.
 *
 * Everything TaskTick keeps on this device — the persisted read cache, the
 * queued writes, and the service worker's per-session API cache — belongs to the
 * session that is ending. Porting the purge through this one function rather
 * than through every call site is what makes that true by construction: the UI
 * cannot sign out without emptying the device.
 *
 * The purge is conditional on the sign-out succeeding. Signing out while
 * offline does not end anything on the server, and throwing the user's unsent
 * work away because a request failed would be worse than keeping it: they are
 * still signed in, and the queue still replays.
 */
export const signOut: typeof authClient.signOut = (async (...args: Parameters<typeof endSession>) => {
  const result = await endSession(...args);
  if (!result?.error) await purgeSession();
  return result;
}) as typeof authClient.signOut;

/**
 * Starts a generic OIDC sign-in.
 *
 * Deliberately calls the endpoint directly rather than going through the client
 * proxy: the request shape is small and stable, and doing it by hand keeps the
 * error message honest instead of whatever the proxy would throw.
 *
 * The endpoint is `/sign-in/social`, not `/sign-in/oauth2`. better-auth 1.7
 * refactored `genericOAuth`: the server plugin no longer registers its own
 * endpoints, it registers each configured provider as a first-class social
 * provider (`init` → `context.socialProviders`), and the core `signIn.social`
 * endpoint drives the flow. Posting to the old `/sign-in/oauth2` path is a 404
 * against the auth router, which surfaced as "Could not start single sign-on".
 * The provider key is `provider` here (matching `signIn.social`), where the old
 * generic-OAuth endpoint called it `providerId`.
 *
 * The response body is better-auth's own shape (`{ url, redirect }`), NOT this
 * app's `{ ok, data }` envelope, so `api` from `@/lib/api-client` is not used.
 */
export async function startOidcSignIn(callbackURL = '/tasks'): Promise<void> {
  const response = await fetch('/api/auth/sign-in/social', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ provider: 'oidc', callbackURL }),
  });

  // Named explicitly rather than via `typeof payload`: an inline `as typeof` in
  // the assignment would refer to the already-narrowed `null` type.
  type OAuthStartResponse = { url?: string; message?: string; error?: string };

  let payload: OAuthStartResponse | null = null;
  try {
    payload = (await response.json()) as OAuthStartResponse;
  } catch {
    /* fall through to the generic error below */
  }

  if (!response.ok || !payload?.url) {
    throw new Error(
      payload?.message ?? payload?.error ?? 'Could not start single sign-on. Check the OIDC configuration.',
    );
  }

  // Full navigation, not a client-side route: the provider must receive the request.
  window.location.href = payload.url;
}
