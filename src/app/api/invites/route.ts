/**
 * Invite management (admin only).
 *
 * Registration is invite-gated by default, so this is how an admin lets someone
 * else in. The token is returned exactly once, in the create response.
 */
import { ok, parseJson, route } from '@/server/http';
import { getDb } from '@/server/db';
import { invites } from '@/server/db/schema';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { newId, randomToken } from '@/server/crypto';
import { createInviteSchema } from '@/lib/schemas';
import { getEnv } from '@/lib/env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route(
  async ({ user }) => {
    const db = getDb();
    const rows = await db
      .select()
      .from(invites)
      .where(eq(invites.createdByUserId, user.id))
      .orderBy(desc(invites.createdAt))
      .limit(100);

    const base = getEnv().APP_URL.replace(/\/$/, '');
    return ok(
      rows.map((row) => ({
        id: row.id,
        email: row.email,
        isAdmin: row.isAdmin,
        // Only usable invites expose their link; accepted ones are spent.
        url: row.acceptedAtMs ? null : `${base}/register?invite=${row.token}`,
        expiresAtMs: row.expiresAtMs,
        acceptedAtMs: row.acceptedAtMs,
        createdAt: row.createdAt,
      })),
    );
  },
  { admin: true },
);

export const POST = route(
  async ({ user, req }) => {
    const body = await parseJson(req, createInviteSchema);
    const db = getDb();
    const id = newId();
    const token = randomToken(24);
    const now = Date.now();

    // Revoke any outstanding invite for the same address so only one link works.
    await db
      .update(invites)
      .set({ expiresAtMs: now })
      .where(and(eq(invites.email, body.email.toLowerCase()), isNull(invites.acceptedAtMs)));

    await db.insert(invites).values({
      id,
      email: body.email.toLowerCase(),
      token,
      isAdmin: body.isAdmin ?? false,
      createdByUserId: user.id,
      expiresAtMs: now + (body.expiresInDays ?? 14) * 86_400_000,
      createdAt: now,
      updatedAt: now,
    });

    const base = getEnv().APP_URL.replace(/\/$/, '');
    return ok({ id, url: `${base}/register?invite=${token}`, expiresAtMs: now + (body.expiresInDays ?? 14) * 86_400_000 }, 201);
  },
  { admin: true },
);
