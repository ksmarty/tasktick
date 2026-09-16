/**
 * Update or delete a user (admin only).
 *
 * Refuses to remove or demote the last remaining administrator, which would
 * otherwise lock everyone out of instance management permanently.
 */
import { badRequest, notFound, ok, parseJson, route } from '@/server/http';
import { getDb } from '@/server/db';
import { user as userTable } from '@/server/db/schema';
import { and, eq, ne, sql } from 'drizzle-orm';
import { z } from 'zod';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const patchSchema = z
  .object({
    isAdmin: z.boolean().optional(),
    banned: z.boolean().optional(),
    name: z.string().min(1).max(200).optional(),
  })
  .strict();

async function countOtherAdmins(userId: string): Promise<number> {
  const db = getDb();
  const [row] = await db
    .select({ count: sql<number>`count(*)` })
    .from(userTable)
    .where(and(eq(userTable.isAdmin, true), ne(userTable.id, userId)));
  return Number(row?.count ?? 0);
}

export const PATCH = route(
  async ({ user, params, req }) => {
    const body = await parseJson(req, patchSchema);
    const db = getDb();

    const [target] = await db.select().from(userTable).where(eq(userTable.id, params.id)).limit(1);
    if (!target) throw notFound('That user does not exist.');

    if (target.isAdmin && (body.isAdmin === false || body.banned === true)) {
      if (target.id === user.id) throw badRequest('You cannot demote or disable your own account.');
      if ((await countOtherAdmins(target.id)) === 0) {
        throw badRequest('This is the only administrator. Promote someone else first.');
      }
    }

    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (body.isAdmin !== undefined) patch.isAdmin = body.isAdmin;
    if (body.banned !== undefined) patch.banned = body.banned;
    if (body.name !== undefined) patch.name = body.name;

    await db.update(userTable).set(patch).where(eq(userTable.id, params.id));
    return ok({ updated: true });
  },
  { admin: true },
);

export const DELETE = route(
  async ({ user, params }) => {
    if (params.id === user.id) throw badRequest('You cannot delete your own account.');
    const db = getDb();

    const [target] = await db.select().from(userTable).where(eq(userTable.id, params.id)).limit(1);
    if (!target) throw notFound('That user does not exist.');

    if (target.isAdmin && (await countOtherAdmins(target.id)) === 0) {
      throw badRequest('This is the only administrator.');
    }

    // Cascade deletes handle every child row (tasks, lists, calendars ...).
    await db.delete(userTable).where(eq(userTable.id, params.id));

    return ok({ deleted: true });
  },
  { admin: true },
);
