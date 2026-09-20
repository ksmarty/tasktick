/**
 * The account's API token, managed from Settings.
 *
 * One token per account, so this is a single resource rather than a collection:
 *
 *   GET    -> the current token's metadata (never the plaintext)
 *   POST   -> create, only when none exists
 *   PUT    -> cycle (replace) the token, invalidating the old one immediately
 *   DELETE -> revoke
 *
 * The plaintext is returned **only** by POST and PUT, in the same response that
 * creates it. It is never stored (only a keyed hash is) and never logged, so a
 * later GET cannot reveal it and a database dump cannot be replayed.
 *
 * This route is session-authenticated like the rest of the UI API; the token it
 * manages authenticates the *public* GraphQL endpoint at `/api/graphql`.
 */
import { conflict, ok, route } from '@/server/http';
import { createApiToken, getApiToken, issueApiToken, revokeApiToken } from '@/server/repos/api-tokens';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route(async ({ user }) => ok({ token: await getApiToken(user.id) }));

export const POST = route(async ({ user }) => {
  try {
    return ok({ token: await createApiToken(user.id) }, 201);
  } catch (error) {
    if (error instanceof Error && error.message === 'exists') {
      throw conflict('A token already exists. Cycle it instead.');
    }
    throw error;
  }
});

/** Cycling is an upsert, so it works whether or not a token already exists. */
export const PUT = route(async ({ user }) => ok({ token: await issueApiToken(user.id) }));

export const DELETE = route(async ({ user }) => {
  await revokeApiToken(user.id);
  return ok({ revoked: true });
});
