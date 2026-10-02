/**
 * `hasPassword` decides whether the settings screen offers the change-password
 * form, so getting it wrong in the permissive direction shows a form that can
 * only fail (better-auth's `changePassword` verifies the current password first)
 * and in the other direction hides a password the user really can change.
 *
 * The interesting case is the account that has *both*: signed in through the
 * identity provider once, and set a password at some point. "Is there an OIDC
 * account?" answers "yes" for that user and is wrong. The question is about the
 * credential row, so that is what these tests pin.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetEnvCache } from '@/lib/env';
import { resetDialectCache } from '@/server/db/dialect';
import { closeDb, getDb } from '@/server/db';
import { account, user } from '@/server/db/schema';
import { hasPassword } from '@/server/repos/accounts';

const USER_ID = 'user-accounts-test';
let tempDir = '';

/** One better-auth `account` row. Only the fields the lookup reads matter. */
function accountRow(id: string, providerId: string, password: string | null) {
  return { id, accountId: `${providerId}-${id}`, providerId, userId: USER_ID, password };
}

beforeEach(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tasktick-accounts-'));
  const file = path.join(tempDir, 'accounts.db');
  process.env.DATABASE_URL = `file:${file}`;
  process.env.BETTER_AUTH_SECRET = 'test-secret-test-secret-test-secret-0001';

  resetEnvCache();
  resetDialectCache();
  await closeDb();

  const handle = new Database(file);
  try {
    handle.pragma('journal_mode = WAL');
    handle.pragma('foreign_keys = ON');
    migrate(drizzle(handle), { migrationsFolder: path.join(process.cwd(), 'drizzle', 'sqlite') });
  } finally {
    handle.close();
  }

  await getDb().insert(user).values({
    id: USER_ID,
    name: 'Account Holder',
    email: 'accounts@example.test',
    emailVerified: true,
    timezone: 'UTC',
  });
});

afterEach(async () => {
  await closeDb();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe('hasPassword', () => {
  it('is false for a user with no account rows at all', async () => {
    expect(await hasPassword(USER_ID)).toBe(false);
  });

  it('is true for a credential account that holds a hash', async () => {
    await getDb().insert(account).values(accountRow('a1', 'credential', 'scrypt$argon2id$fake-hash'));
    expect(await hasPassword(USER_ID)).toBe(true);
  });

  it('is false for an OIDC-only account, whose password column is empty', async () => {
    await getDb().insert(account).values(accountRow('a2', 'oidc', null));
    expect(await hasPassword(USER_ID)).toBe(false);
  });

  it('is true when the user has an OIDC account AND a credential account', async () => {
    await getDb()
      .insert(account)
      .values([accountRow('a3', 'oidc', null), accountRow('a4', 'credential', 'scrypt$argon2id$fake-hash')]);

    // The reading this guards against — "the user has an oauth account, so hide
    // the form" — would answer false here and strand a password they can change.
    expect(await hasPassword(USER_ID)).toBe(true);
  });

  it('ignores a credential row with no password in it', async () => {
    await getDb().insert(account).values(accountRow('a5', 'credential', null));
    expect(await hasPassword(USER_ID)).toBe(false);
  });
});
