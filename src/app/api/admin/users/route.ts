/**
 * User administration (admin only).
 */
import { ok, route } from '@/server/http';
import { getDb } from '@/server/db';
import { user as userTable } from '@/server/db/schema';
import { desc } from 'drizzle-orm';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route(
  async () => {
    const db = getDb();
    const rows = await db
      .select({
        id: userTable.id,
        name: userTable.name,
        email: userTable.email,
        isAdmin: userTable.isAdmin,
        banned: userTable.banned,
        timezone: userTable.timezone,
        createdAt: userTable.createdAt,
      })
      .from(userTable)
      .orderBy(desc(userTable.createdAt))
      .limit(500);

    return ok(rows);
  },
  { admin: true },
);
