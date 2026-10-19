/**
 * Where Home Assistant takes the reminders from.
 *
 * These run against a real migrated SQLite file rather than a mocked store,
 * because the interesting part is the *registration*: the integration rewrites
 * one row on every poll, the sweep reads it back, and the only thing standing
 * between "Home Assistant is delivering" and "the app is speaking too" is the
 * freshness boundary. A fake store would only be asserting itself.
 */
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { newId } from '@/server/crypto';
import { getDb } from '@/server/db';
import { haDeliveryTargets, user } from '@/server/db/schema';
import {
  HA_DELIVERY_FRESH_MS,
  freshHaDeliveries,
  haDeliveryRegistration,
  haDeliveryTarget,
  registerHaDelivery,
} from '@/server/services/ha-delivery';
import { disposeTempDatabase, useTempDatabase } from './sync-helpers';

const ZONE = 'UTC';

/** 2026-05-12T12:00:00Z — the instant every case is measured from. */
const NOW = Date.UTC(2026, 4, 12, 12, 0, 0);

/** What a real one looks like: the integration's own secret is in the path. */
const WEBHOOK = 'https://ha.example.test/api/webhook/9f2c0a5e';

let databaseFile: string;
let userId: string;

async function seedUser(): Promise<string> {
  const db = getDb();
  const id = newId();
  await db.insert(user).values({
    id,
    name: 'Delivery Tester',
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
  it('records where Home Assistant wants the reminders', async () => {
    const receipt = await registerHaDelivery(userId, WEBHOOK, NOW);
    expect(receipt).toEqual({ webhookUrl: WEBHOOK, registeredAtMs: NOW });

    await expect(haDeliveryRegistration(userId)).resolves.toEqual({
      webhookUrl: WEBHOOK,
      registeredAtMs: NOW,
    });
  });

  it('trims the URL, because a trailing space is a 404 nobody can see', async () => {
    await registerHaDelivery(userId, `  ${WEBHOOK}\n`, NOW);
    await expect(haDeliveryRegistration(userId)).resolves.toEqual({
      webhookUrl: WEBHOOK,
      registeredAtMs: NOW,
    });
  });

  it('replaces the previous registration rather than adding a row', async () => {
    // A Home Assistant that moved, or a second one: the last poll wins, so
    // nothing is delivered twice.
    await registerHaDelivery(userId, WEBHOOK, NOW);
    await registerHaDelivery(userId, 'https://other.example.test/api/webhook/x', NOW + 60_000);

    const rows = await getDb().select().from(haDeliveryTargets).where(eq(haDeliveryTargets.userId, userId));
    expect(rows).toHaveLength(1);
    await expect(haDeliveryRegistration(userId)).resolves.toEqual({
      webhookUrl: 'https://other.example.test/api/webhook/x',
      registeredAtMs: NOW + 60_000,
    });
  });
});

describe('freshness', () => {
  it('reads back while the registration is still being refreshed', async () => {
    await registerHaDelivery(userId, WEBHOOK, NOW);
    await expect(haDeliveryTarget(userId, NOW + HA_DELIVERY_FRESH_MS - 1)).resolves.toEqual({
      webhookUrl: WEBHOOK,
      registeredAtMs: NOW,
    });
  });

  it('gives up on a registration that stopped being refreshed', async () => {
    await registerHaDelivery(userId, WEBHOOK, NOW);
    await expect(haDeliveryTarget(userId, NOW + HA_DELIVERY_FRESH_MS)).resolves.toBeNull();
  });

  it('reads null for an account that never registered', async () => {
    await expect(haDeliveryRegistration(userId)).resolves.toBeNull();
    await expect(haDeliveryTarget(userId, NOW)).resolves.toBeNull();
  });

  it('reads null for a registration with no address in it', async () => {
    // Not something the GraphQL layer would write, but an empty URL is an
    // answer the sweep must treat as "nobody is delivering here" rather than
    // POST to nowhere.
    await registerHaDelivery(userId, '  ', NOW);
    await expect(haDeliveryTarget(userId, NOW)).resolves.toBeNull();
    await expect(freshHaDeliveries(NOW)).resolves.toEqual(new Map());
  });
});

describe('the sweep’s read', () => {
  it('answers for every fresh account in one query', async () => {
    const other = await seedUser();
    await registerHaDelivery(userId, WEBHOOK, NOW);
    await registerHaDelivery(other, 'https://other.example.test/api/webhook/x', NOW);

    const fresh = await freshHaDeliveries(NOW);
    expect(fresh.size).toBe(2);
    expect(fresh.get(userId)).toEqual({ webhookUrl: WEBHOOK, registeredAtMs: NOW });
    expect(fresh.get(other)).toEqual({
      webhookUrl: 'https://other.example.test/api/webhook/x',
      registeredAtMs: NOW,
    });
  });

  it('leaves a stale account out of the map', async () => {
    await registerHaDelivery(userId, WEBHOOK, NOW - HA_DELIVERY_FRESH_MS);
    await expect(freshHaDeliveries(NOW)).resolves.toEqual(new Map());
  });
});
