/**
 * Where a Home Assistant wants its reminders delivered.
 *
 * ## Why the app has to know
 *
 * A `tasktick` Home Assistant installation can deliver a reminder far better
 * than the app can on iPhone: an installed PWA gets no reliable background
 * wake-up, while Home Assistant is already awake and its notification carries a
 * button that completes the item or checks in the habit. So the integration
 * registers a webhook with this app and the reminder sweep POSTs each due
 * reminder there (see `src/server/services/ha-push.ts`) instead of pushing it
 * itself.
 *
 * ## A claim, not a setting
 *
 * There is deliberately nothing to configure. The integration calls
 * {@link registerHaDelivery} on every poll, which records *that Home Assistant is
 * there* and *where to reach it*; the sweep delivers through it while the record
 * is fresh ({@link HA_DELIVERY_FRESH_MS}) and falls back to the app's own push
 * the moment a POST fails. Uninstall the integration, disable it, or let Home
 * Assistant go silent for a quarter of an hour and the registration goes stale on
 * its own — and the app's own transport takes over again without anyone toggling
 * anything. A user who downgrades, or whose server address changed, is never left
 * with reminders that arrive nowhere.
 *
 * Freshness is what makes the write safe to repeat: the integration polls every
 * minute, so a registration that is even ten minutes old means something has gone
 * wrong on the Home Assistant side.
 *
 * ## Why the URL is the whole registration
 *
 * The webhook URL embeds the integration's own secret, so it is the only thing
 * that has to be stored: the app keeps no Home Assistant token, and Home Assistant
 * needs none from us, because the button on a delivered notification calls
 * TaskTick's own services.
 */
import { eq, gt } from 'drizzle-orm';
import type { Millis } from '@/lib/types';
import { getDb } from '../db';
import { haDeliveryTargets } from '../db/schema';

/**
 * How long a registration stays believable.
 *
 * The integration polls once a minute, so fifteen missed polls is not a slow
 * network — it is an integration that is gone or broken. Long enough to ride out
 * a restart of either side, short enough that a user is not silently reliant on a
 * Home Assistant that stopped answering.
 */
export const HA_DELIVERY_FRESH_MS = 15 * 60 * 1000;

/** Where to deliver one account's reminders, and when that was last confirmed. */
export interface HaDeliveryTarget {
  /** The integration's webhook, secret and all. */
  webhookUrl: string;
  registeredAtMs: Millis;
}

/**
 * Records that Home Assistant receives this account's reminders at `webhookUrl`.
 *
 * One row per account, overwritten on every poll: a second Home Assistant
 * replaces the first rather than doubling every notification.
 */
export async function registerHaDelivery(
  userId: string,
  webhookUrl: string,
  nowMs: Millis,
): Promise<HaDeliveryTarget> {
  const url = webhookUrl.trim();
  const db = getDb();

  await db
    .insert(haDeliveryTargets)
    .values({ userId, webhookUrl: url, registeredAtMs: nowMs })
    .onConflictDoUpdate({
      target: haDeliveryTargets.userId,
      set: { webhookUrl: url, registeredAtMs: nowMs, updatedAt: nowMs },
    });

  return { webhookUrl: url, registeredAtMs: nowMs };
}

/** The last registration for one account, fresh or not, or null when there is none. */
export async function haDeliveryRegistration(userId: string): Promise<HaDeliveryTarget | null> {
  const db = getDb();
  const [row] = await db
    .select({ webhookUrl: haDeliveryTargets.webhookUrl, registeredAtMs: haDeliveryTargets.registeredAtMs })
    .from(haDeliveryTargets)
    .where(eq(haDeliveryTargets.userId, userId))
    .limit(1);
  if (!row) return null;

  return { webhookUrl: row.webhookUrl, registeredAtMs: row.registeredAtMs };
}

/**
 * Where to deliver this account's reminders right now, or null when no *fresh*
 * registration says where.
 *
 * Null rather than an empty URL: the caller's question is "is somebody else
 * delivering", and a URL with nothing in it answers it the same way as no row at
 * all — which is what an integration that registered before it knew its own
 * address would leave behind.
 */
export async function haDeliveryTarget(
  userId: string,
  nowMs: Millis,
  freshMs: number = HA_DELIVERY_FRESH_MS,
): Promise<HaDeliveryTarget | null> {
  const registration = await haDeliveryRegistration(userId);
  if (!registration || !registration.webhookUrl) return null;
  if (registration.registeredAtMs <= nowMs - freshMs) return null;
  return registration;
}

/**
 * Every *fresh* registration, keyed by account — the sweep's read.
 *
 * One query for the whole tick rather than one per recipient: the sweep already
 * walks every account that can receive anything, and a per-account read would
 * double its query count to answer a question that is almost always "no".
 */
export async function freshHaDeliveries(
  nowMs: Millis,
  freshMs: number = HA_DELIVERY_FRESH_MS,
): Promise<Map<string, HaDeliveryTarget>> {
  const db = getDb();
  const rows = await db
    .select({
      userId: haDeliveryTargets.userId,
      webhookUrl: haDeliveryTargets.webhookUrl,
      registeredAtMs: haDeliveryTargets.registeredAtMs,
    })
    .from(haDeliveryTargets)
    .where(gt(haDeliveryTargets.registeredAtMs, nowMs - freshMs));

  const fresh = new Map<string, HaDeliveryTarget>();
  for (const row of rows) {
    if (!row.webhookUrl) continue;
    fresh.set(row.userId, { webhookUrl: row.webhookUrl, registeredAtMs: row.registeredAtMs });
  }
  return fresh;
}
