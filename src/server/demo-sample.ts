/**
 * Provisioning the sample account on demand.
 *
 * ## Why this exists rather than relying on the seed
 *
 * The sample account was created by `npm run db:seed`, and the Docker image runs
 * **migrations only** — never the seed. So on every deployed instance the sample
 * account did not exist, `resolveSampleUserId()` returned `null`, and demo mode
 * silently fell through to the signed-in user: the user switched demo mode on and
 * saw their own empty data, which reads as "demo mode is broken".
 *
 * It was broken in exactly the way the earlier comment warned about — a demo that
 * quietly shows your real data — and the fix is to stop depending on a step that a
 * deployment does not run.
 *
 * ## What it creates
 *
 * The account itself, with the shape a new account has (an Inbox, a default
 * calendar and the rest), so the app has something coherent to render. It runs
 * once, on the first request that asks for demo mode, and is idempotent by
 * checking for the account first.
 */
import { eq } from 'drizzle-orm';
import { getDb } from '@/server/db';
import { ensureUserBootstrap } from '@/server/bootstrap';
import { newId } from '@/server/crypto';
import { user } from '@/server/db/schema';
import { SAMPLE_EMAIL } from '@/server/demo';

const ZONE = 'UTC';

/**
 * Creates the sample account if it is not already there.
 *
 * Returns the account id, or `null` if it could not be created — the caller then
 * leaves demo mode off rather than serving the real user's data under a demo label.
 */
export async function ensureSampleAccount(): Promise<string | null> {
  const db = getDb();

  const [existing] = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, SAMPLE_EMAIL))
    .limit(1);
  if (existing) return existing.id;

  /*
   * Inserted with **no credential row**: registration here is invite-only, and an
   * account that exists to be looked at should not be sign-in-able. With no
   * `account` row there is no password hash to attack, and demo mode reaches it by
   * id, server-side, which is the only way in.
   */
  const id = newId();
  await db.insert(user).values({
    id,
    name: 'Sample Data',
    email: SAMPLE_EMAIL,
    emailVerified: true,
    isAdmin: false,
    timezone: ZONE,
  });

  // Gives it an Inbox, a default calendar and the rest of a new account's shape.
  await ensureUserBootstrap(id, ZONE, 1);

  return id;
}
