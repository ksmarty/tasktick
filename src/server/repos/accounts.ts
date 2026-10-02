/**
 * Account credential lookups.
 *
 * better-auth owns the `account` table, so nothing here writes to it. This is
 * only the read the settings screen needs to decide what it may offer.
 */
import { and, eq, isNotNull } from 'drizzle-orm';
import { getDb } from '../db';
import { account } from '../db/schema';

/**
 * Whether an account can sign in with a password.
 *
 * True when better-auth holds a `credential` account for the user, because that
 * is the row its `changePassword` endpoint reads and writes. Deliberately not
 * "signed in with something other than OIDC": an account can have both — sign in
 * through the provider, then set a password — and for that user the
 * change-password form has to stay. The answer is a fact about the rows, so it is
 * read from the table better-auth owns rather than inferred from how the current
 * session was opened.
 */
export async function hasPassword(userId: string): Promise<boolean> {
  const [row] = await getDb()
    .select({ id: account.id })
    .from(account)
    .where(and(eq(account.userId, userId), eq(account.providerId, 'credential'), isNotNull(account.password)))
    .limit(1);

  return Boolean(row);
}
