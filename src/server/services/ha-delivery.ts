/**
 * Who is delivering reminders, when Home Assistant has taken over.
 *
 * ## Why the app has to know
 *
 * Home Assistant can mirror TaskTick's reminders (`tasktick.create_reminder`,
 * driven now by the integration's own sync) and deliver them with a button that
 * completes the item. That is strictly better than what the app can do on iPhone
 * — an installed PWA gets no reliable background wake-up — but it means the same
 * reminder would otherwise arrive twice: once from Home Assistant and once from
 * the app's own Web Push or Apprise fan-out.
 *
 * ## A claim, not a setting
 *
 * There is deliberately nothing to configure. The integration calls
 * {@link registerHaDelivery} on every poll, which records *that Home Assistant is
 * there* and *what it mirrors*; the reminder sweep reads it back and stays quiet
 * about those sources while the record is fresh ({@link HA_DELIVERY_FRESH_MS}).
 * Uninstall the integration, disable it, or let Home Assistant go silent for a
 * quarter of an hour and the registration goes stale on its own — and the app's
 * own notifications come back without anyone toggling anything. A user who
 * downgrades, or whose server address changed, is never left with reminders that
 * arrive nowhere.
 *
 * Freshness is what makes the write safe to repeat: the integration polls every
 * minute, so a claim that is even ten minutes old means something has gone wrong
 * on the Home Assistant side.
 *
 * ## Why it is not derived from the push subscriptions
 *
 * A subscription only says a device *could* receive a push. It says nothing about
 * whether something else is already handling the reminder, which is exactly the
 * question here — so the answer is recorded by the thing doing the handling.
 */
import { eq, gt } from 'drizzle-orm';
import type { Millis } from '@/lib/types';
import { getDb } from '../db';
import { haDeliveries } from '../db/schema';

/** The reminder sources a Home Assistant can mirror. */
export const MIRRORED_SOURCES = ['task', 'habit', 'event'] as const;

export type MirroredSource = (typeof MIRRORED_SOURCES)[number];

/** True for a string that names a source this app can delegate. */
export function isMirroredSource(value: unknown): value is MirroredSource {
  return typeof value === 'string' && (MIRRORED_SOURCES as readonly string[]).includes(value);
}

/**
 * How long a registration stays believable.
 *
 * The integration polls once a minute, so fifteen missed polls is not a slow
 * network — it is an integration that is gone or broken. Long enough to ride out
 * a restart of either side, short enough that a user is not silently un-notified
 * for a day after removing the integration.
 */
export const HA_DELIVERY_FRESH_MS = 15 * 60 * 1000;

/** What a registration acknowledged, echoed back to the caller. */
export interface HaDeliveryReceipt {
  sources: MirroredSource[];
  registeredAtMs: Millis;
}

/**
 * Records that Home Assistant is delivering reminders for `sources`.
 *
 * The names are de-duplicated and put in {@link MIRRORED_SOURCES} order rather
 * than the caller's, so the stored value is canonical and a later comparison
 * cannot fail over ordering. An empty list is allowed and means "Home Assistant
 * is connected but mirroring nothing", which suppresses nothing.
 */
export async function registerHaDelivery(
  userId: string,
  sources: readonly MirroredSource[],
  nowMs: Millis,
): Promise<HaDeliveryReceipt> {
  const db = getDb();
  const wanted = MIRRORED_SOURCES.filter((source) => sources.includes(source));

  await db
    .insert(haDeliveries)
    .values({ userId, sources: wanted, registeredAtMs: nowMs })
    .onConflictDoUpdate({
      target: haDeliveries.userId,
      set: { sources: wanted, registeredAtMs: nowMs, updatedAt: nowMs },
    });

  return { sources: wanted, registeredAtMs: nowMs };
}

/** The last registration for one account, fresh or not, or null when there is none. */
export async function haDeliveryRegistration(
  userId: string,
): Promise<{ sources: MirroredSource[]; registeredAtMs: Millis } | null> {
  const db = getDb();
  const [row] = await db
    .select({ sources: haDeliveries.sources, registeredAtMs: haDeliveries.registeredAtMs })
    .from(haDeliveries)
    .where(eq(haDeliveries.userId, userId))
    .limit(1);
  if (!row) return null;

  return {
    sources: MIRRORED_SOURCES.filter((source) => (row.sources ?? []).includes(source)),
    registeredAtMs: row.registeredAtMs,
  };
}

/**
 * The sources Home Assistant is delivering right now, or null when no *fresh*
 * registration covers this account.
 *
 * Null rather than an empty array: the two answer different questions. Null is
 * "nobody else is delivering", an empty set is "Home Assistant is delivering, but
 * nothing in particular" — and only the first one means the app should speak.
 */
export async function haDeliverySources(
  userId: string,
  nowMs: Millis,
  freshMs: number = HA_DELIVERY_FRESH_MS,
): Promise<MirroredSource[] | null> {
  const registration = await haDeliveryRegistration(userId);
  if (!registration || registration.registeredAtMs <= nowMs - freshMs) return null;
  return registration.sources;
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
): Promise<Map<string, Set<MirroredSource>>> {
  const db = getDb();
  const rows = await db
    .select({ userId: haDeliveries.userId, sources: haDeliveries.sources })
    .from(haDeliveries)
    .where(gt(haDeliveries.registeredAtMs, nowMs - freshMs));

  const fresh = new Map<string, Set<MirroredSource>>();
  for (const row of rows) {
    fresh.set(row.userId, new Set(MIRRORED_SOURCES.filter((source) => (row.sources ?? []).includes(source))));
  }
  return fresh;
}
