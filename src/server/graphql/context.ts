/**
 * GraphQL request authentication.
 *
 * The endpoint is authenticated by the API token **and nothing else** — there is
 * deliberately no session-cookie path, no query-string token and no "trusted
 * internal" shortcut. A request without a valid `Authorization: Bearer <token>`
 * header is rejected before the document is ever parsed, so no resolver can run
 * on an unauthenticated request.
 *
 * The token resolves to its owner; the owner's row is then loaded so that a
 * **banned** account's token stops working immediately (a deleted account's
 * token is removed by the `on delete cascade` foreign key, and the join in
 * `resolveApiToken` also drops it). The per-user settings are loaded once here,
 * so resolvers do not each re-derive the timezone.
 */
import { eq } from 'drizzle-orm';
import { getDb } from '../db';
import { user } from '../db/schema';
import { resolveApiToken, touchApiToken } from '../repos/api-tokens';
import { getSettings } from '../repos/settings';
import type { SessionUser, UserSettings } from '@/lib/types';

export interface GraphQLContext {
  /** The authenticated account. Every resolver scopes to this id, never to an argument. */
  userId: string;
  user: SessionUser;
  settings: UserSettings;
  /** The account's timezone, the default for any date arithmetic. */
  zone: string;
  weekStartsOn: number;
}

/**
 * Turns a bearer token into a request context, or null when it is not valid.
 *
 * `null` covers every negative case identically — unknown token, malformed
 * token, cycled-out token, banned owner, deleted owner — because telling a
 * caller *which* of those it is would be an oracle. The caller turns null into a
 * single `UNAUTHENTICATED` failure.
 */
export async function buildGraphQLContext(token: string): Promise<GraphQLContext | null> {
  const resolved = await resolveApiToken(token);
  if (!resolved) return null;

  const db = getDb();
  const [row] = await db
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      image: user.image,
      isAdmin: user.isAdmin,
      timezone: user.timezone,
      banned: user.banned,
    })
    .from(user)
    .where(eq(user.id, resolved.userId))
    .limit(1);

  if (!row || row.banned) return null;

  const settings = await getSettings(row.id);

  // Best-effort usage stamp; never fail an authenticated request for it.
  try {
    await touchApiToken(row.id);
  } catch {
    /* usage tracking is not worth a failed request */
  }

  const sessionUser: SessionUser = {
    id: row.id,
    name: row.name ?? row.email,
    email: row.email,
    image: row.image ?? null,
    isAdmin: Boolean(row.isAdmin),
    timezone: row.timezone ?? settings.timezone,
  };

  return {
    userId: row.id,
    user: sessionUser,
    settings,
    zone: settings.timezone || sessionUser.timezone,
    weekStartsOn: settings.weekStartsOn,
  };
}
