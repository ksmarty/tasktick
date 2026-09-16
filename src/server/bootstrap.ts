/**
 * New-account provisioning.
 *
 * Every user needs a small amount of scaffolding before the app is usable, and
 * it must be created exactly once and idempotently (the OIDC path can run these
 * hooks twice under a retry).
 */
import { eq, and } from 'drizzle-orm';
import { getDb } from './db';
import { lists, calendars, userSettings } from './db/schema';
import { newId } from './crypto';

export async function ensureUserBootstrap(userId: string, timezone: string, weekStartsOn: number): Promise<void> {
  const db = getDb();

  const [existingInbox] = await db
    .select({ id: lists.id })
    .from(lists)
    .where(and(eq(lists.userId, userId), eq(lists.isInbox, true)))
    .limit(1);

  if (!existingInbox) {
    await db.insert(lists).values({
      id: newId(),
      userId,
      name: 'Inbox',
      color: 'blue',
      emoji: '📥',
      sortOrder: 'a0',
      isInbox: true,
    });
  }

  const [existingCalendar] = await db
    .select({ id: calendars.id })
    .from(calendars)
    .where(eq(calendars.userId, userId))
    .limit(1);

  if (!existingCalendar) {
    await db.insert(calendars).values({
      id: newId(),
      userId,
      name: 'Personal',
      color: 'blue',
      timezone,
      provider: 'local',
      isDefault: true,
      isVisible: true,
      supportsVtodo: true,
      sortOrder: 'a0',
    });
  }

  const [settings] = await db
    .select({ userId: userSettings.userId })
    .from(userSettings)
    .where(eq(userSettings.userId, userId))
    .limit(1);

  if (!settings) {
    await db.insert(userSettings).values({ userId, timezone, weekStartsOn });
  }
}

/** Creates the Inbox lazily if it somehow went missing (e.g. hand-edited DB). */
export async function requireInboxListId(userId: string): Promise<string> {
  const db = getDb();
  const [inbox] = await db
    .select({ id: lists.id })
    .from(lists)
    .where(and(eq(lists.userId, userId), eq(lists.isInbox, true)))
    .limit(1);
  if (inbox) return inbox.id;
  const id = newId();
  await db.insert(lists).values({ id, userId, name: 'Inbox', color: 'blue', emoji: '📥', sortOrder: 'a0', isInbox: true });
  return id;
}
