/**
 * API tokens for the public GraphQL endpoint.
 *
 * The model is deliberately the simplest one that satisfies the requirement:
 * **exactly one token per account**. `api_tokens.user_id` is the primary key, so
 * "only one token per account" is a property of the table rather than a rule a
 * caller could forget to enforce. Creating and cycling are therefore the same
 * write (`issue`), and revoking is a delete.
 *
 * Only a keyed hash is ever persisted — see `hashToken` in `src/server/crypto.ts`
 * for why the hash is keyed from `BETTER_AUTH_SECRET` rather than a bare digest.
 * The plaintext leaves this module exactly once, from `issueApiToken`, and the
 * caller is responsible for showing it once and never storing it.
 */
import { eq } from 'drizzle-orm';
import { getDb } from '../db';
import { apiTokens, user } from '../db/schema';
import { hashToken, randomToken, safeEqual } from '../crypto';

/** The prefix of every generated token, so one is recognisable at a glance. */
export const API_TOKEN_PREFIX = 'tt_';

/** How many leading characters are kept (in the clear) for identification. */
const VISIBLE_CHARS = 11; // `tt_` + 8 random characters

/** What the settings UI is allowed to know about a stored token. */
export interface ApiTokenView {
  /** The visible prefix, e.g. `tt_A1b2C3d4`. Never enough to reconstruct. */
  prefix: string;
  createdAt: number;
  /** Last time the token authenticated a request, or null if never used. */
  lastUsedAtMs: number | null;
}

/** The one-time result of creating or cycling a token. */
export interface IssuedApiToken extends ApiTokenView {
  /** The plaintext token. Returned exactly once, never persisted, never logged. */
  plaintext: string;
}

function newPlaintext(): string {
  return `${API_TOKEN_PREFIX}${randomToken(32)}`;
}

function viewOf(row: { tokenPrefix: string; createdAt: number; lastUsedAtMs: number | null }): ApiTokenView {
  return { prefix: row.tokenPrefix, createdAt: row.createdAt, lastUsedAtMs: row.lastUsedAtMs };
}

/** The current token's metadata, or null when the account has none. */
export async function getApiToken(userId: string): Promise<ApiTokenView | null> {
  const db = getDb();
  const [row] = await db.select().from(apiTokens).where(eq(apiTokens.userId, userId)).limit(1);
  return row ? viewOf(row) : null;
}

/**
 * Creates the account's token, replacing any existing one.
 *
 * This is the only writer, so "create" and "cycle" differ only in what the route
 * allows: a create on an account that already has a token is refused there, and
 * a cycle is allowed to overwrite. Both invalidate the previous plaintext
 * immediately, because the hash column is rewritten in place.
 */
export async function issueApiToken(userId: string): Promise<IssuedApiToken> {
  const db = getDb();
  const plaintext = newPlaintext();
  const now = Date.now();
  const row = {
    userId,
    tokenHash: hashToken(plaintext),
    tokenPrefix: plaintext.slice(0, VISIBLE_CHARS),
    lastUsedAtMs: null,
    createdAt: now,
    updatedAt: now,
  };

  await db
    .insert(apiTokens)
    .values(row)
    .onConflictDoUpdate({
      target: apiTokens.userId,
      set: { tokenHash: row.tokenHash, tokenPrefix: row.tokenPrefix, lastUsedAtMs: null, updatedAt: now },
    });

  return { plaintext, prefix: row.tokenPrefix, createdAt: now, lastUsedAtMs: null };
}

/** Creates a token only when the account has none; throws `exists` otherwise. */
export async function createApiToken(userId: string): Promise<IssuedApiToken> {
  const existing = await getApiToken(userId);
  if (existing) throw new Error('exists');
  return issueApiToken(userId);
}

/** Removes the account's token. The plaintext stops working immediately. */
export async function revokeApiToken(userId: string): Promise<boolean> {
  const db = getDb();
  const result = await db.delete(apiTokens).where(eq(apiTokens.userId, userId));
  void result;
  return true;
}

/**
 * Resolves a bearer token to its owner.
 *
 * The lookup is by the keyed hash, which is the only form of the token that
 * exists at rest. The subsequent `safeEqual` is belt-and-braces: it makes the
 * comparison constant-time even though the database has already matched the
 * indexed column, so no timing signal about the plaintext can escape.
 *
 * A token belonging to a banned or deleted account resolves to null. The delete
 * case is also covered structurally by the `on delete cascade` foreign key; the
 * ban check is explicit here because a banned row still exists.
 */
export async function resolveApiToken(plaintext: string): Promise<{ userId: string } | null> {
  if (!plaintext.startsWith(API_TOKEN_PREFIX)) return null;

  const db = getDb();
  const hash = hashToken(plaintext);
  const [row] = await db
    .select({ userId: apiTokens.userId, tokenHash: apiTokens.tokenHash, banned: user.banned })
    .from(apiTokens)
    .innerJoin(user, eq(user.id, apiTokens.userId))
    .where(eq(apiTokens.tokenHash, hash))
    .limit(1);

  if (!row) return null;
  if (!safeEqual(row.tokenHash, hash)) return null;
  if (row.banned) return null;

  return { userId: row.userId };
}

/**
 * Records that a token was used. Best-effort: a failure here must never fail the
 * request that was successfully authenticated.
 */
export async function touchApiToken(userId: string): Promise<void> {
  const db = getDb();
  await db.update(apiTokens).set({ lastUsedAtMs: Date.now() }).where(eq(apiTokens.userId, userId));
}
