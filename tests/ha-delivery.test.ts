/**
 * Delivery delegation to Home Assistant.
 *
 * These run against a real migrated SQLite file rather than a mocked store,
 * because the interesting part is the *claim*: the integration rewrites one row
 * on every poll, the sweep reads it back, and the only thing standing between
 * "Home Assistant is delivering" and "the app is speaking too" is the freshness
 * boundary. A fake store would only be asserting itself.
 */
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { newId } from '@/server/crypto';
import { getDb } from '@/server/db';
import { haDeliveries, user } from '@/server/db/schema';
import {
  HA_DELIVERY_FRESH_MS,
  MIRRORED_SOURCES,
  freshHaDeliveries,
  haDeliveryRegistration,
  haDeliverySources,
  isMirroredSource,
  registerHaDelivery,
} from '@/server/services/ha-delivery';
import { disposeTempDatabase, useTempDatabase } from './sync-helpers';

const ZONE = 'UTC';

/** 2026-05-12T12:00:00Z — the instant every case is measured from. */
const NOW = Date.UTC(2026, 4, 12, 12, 0, 0);

let databaseFile: string;
let userId: string;

async function seedUser(): Promise<string> {
  const db = getDb();
  const id = newId();
  await db.insert(user).values({
    id,
    name: 'Delegation Tester',
    email: `${id}@example.test`,
    emailVerified: true,
    timezone: ZONE,
  });
  return id;
}

beforeEach(async () => {
  databaseFile = await useTempDatabase();
  userId = await seedUser();
});

afterEach(async () => {
  await disposeTempDatabase(databaseFile);
});

describe('the registration', () => {
  it('records the sources Home Assistant says it mirrors', async () => {
    const receipt = await registerHaDelivery(userId, ['task', 'habit'], NOW);
    expect(receipt).toEqual({ sources: ['task', 'habit'], registeredAtMs: NOW });

    await expect(haDeliveryRegistration(userId)).resolves.toEqual({
      sources: ['task', 'habit'],
      registeredAtMs: NOW,
    });
  });

  it('puts the names in the app’s own order and drops a duplicate', async () => {
    await registerHaDelivery(userId, ['event', 'task', 'task', 'habit'], NOW);
    await expect(haDeliverySources(userId, NOW)).resolves.toEqual(['task', 'habit', 'event']);
  });

  it('replaces the previous registration rather than adding a row', async () => {
    await registerHaDelivery(userId, ['task'], NOW);
    await registerHaDelivery(userId, ['habit'], NOW + 60_000);

    const rows = await getDb().select().from(haDeliveries).where(eq(haDeliveries.userId, userId));
    expect(rows).toHaveLength(1);
    await expect(haDeliverySources(userId, NOW + 60_000)).resolves.toEqual(['habit']);
  });

  it('treats an empty list as an answer, not as silence', async () => {
    // "Home Assistant is connected and mirroring nothing" is a real state — the
    // integration is installed before the user has chosen a notify service — and
    // it must not read as "nobody else is delivering".
    await registerHaDelivery(userId, [], NOW);
    await expect(haDeliverySources(userId, NOW)).resolves.toEqual([]);
  });
});

describe('freshness', () => {
  it('reads back while the registration is still being refreshed', async () => {
    await registerHaDelivery(userId, ['habit'], NOW);
    await expect(haDeliverySources(userId, NOW + HA_DELIVERY_FRESH_MS - 1)).resolves.toEqual(['habit']);
  });

  it('gives up on a registration that stopped being refreshed', async () => {
    await registerHaDelivery(userId, ['habit'], NOW);
    await expect(haDeliverySources(userId, NOW + HA_DELIVERY_FRESH_MS)).resolves.toBeNull();
  });

  it('reads null for an account that never registered', async () => {
    await expect(haDeliveryRegistration(userId)).resolves.toBeNull();
    await expect(haDeliverySources(userId, NOW)).resolves.toBeNull();
  });
});

describe('the sweep’s read', () => {
  it('answers for every fresh account in one query', async () => {
    const other = await seedUser();
    await registerHaDelivery(userId, ['task'], NOW);
    await registerHaDelivery(other, [], NOW);

    const fresh = await freshHaDeliveries(NOW);
    expect(fresh.size).toBe(2);
    expect(fresh.get(userId)).toEqual(new Set(['task']));
    expect(fresh.get(other)).toEqual(new Set());
  });

  it('leaves a stale account out of the map', async () => {
    await registerHaDelivery(userId, ['task'], NOW - HA_DELIVERY_FRESH_MS);
    await expect(freshHaDeliveries(NOW)).resolves.toEqual(new Map());
  });
});

describe('source names', () => {
  it('accepts exactly the three sources the app can delegate', () => {
    expect(MIRRORED_SOURCES).toEqual(['task', 'habit', 'event']);
    expect(isMirroredSource('task')).toBe(true);
    expect(isMirroredSource('habit')).toBe(true);
    expect(isMirroredSource('event')).toBe(true);
    expect(isMirroredSource('list')).toBe(false);
    expect(isMirroredSource(null)).toBe(false);
    expect(isMirroredSource(7)).toBe(false);
  });
});
