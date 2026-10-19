/**
 * Reminder links that sign the browser in.
 *
 * The device this exists for is an iPhone: a reminder delivered through Home
 * Assistant opens Safari, because iOS cannot hand a notification's URL to the
 * installed web app. Before this, that browser always stopped at the sign-in
 * page; now the URL carries a fifteen-minute token for one user.
 *
 * Two levels are pinned here. The token itself (signature, expiry, destination
 * handling) is unit-tested, and the endpoint is driven through the *real*
 * better-auth handler so the parts that are easy to get subtly wrong — creating
 * the session, writing the cookie, redirecting — are proven against the library
 * rather than against our idea of it.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetEnvCache } from '@/lib/env';
import { AUTH_COOKIE_PREFIX } from '@/lib/auth-cookie';
import { REMINDER_LINK_PATH, REMINDER_LINK_TTL_MS, signReminderLink, verifyReminderLink } from '@/server/reminder-link';
import { closeDb } from '@/server/db';
import { resetDialectCache } from '@/server/db/dialect';
import { resetAuthCache } from '@/server/auth';

const SECRET = 'test-secret-test-secret-test-secret-reminder';
const APP_ORIGIN = 'http://127.0.0.1:3000';
const USER_EMAIL = 'reminder-user@example.com';

/** A token signed `offsetMs` before now, for the expiry cases. */
function mint(next: string, userId: string, nowMs: number): string {
  const url = signReminderLink(next, userId, nowMs);
  const token = new URL(url, APP_ORIGIN).searchParams.get('token');
  if (!token) throw new Error('no token in the minted link');
  return token;
}

describe('the reminder token', () => {
  beforeEach(() => {
    process.env.BETTER_AUTH_SECRET = SECRET;
    process.env.APP_URL = APP_ORIGIN;
    resetEnvCache();
  });

  afterEach(() => {
    delete process.env.BETTER_AUTH_SECRET;
    delete process.env.APP_URL;
    resetEnvCache();
  });

  it('names the user and the endpoint, and verifies back to that user', () => {
    const url = signReminderLink('/tasks?task=abc', 'user-1', 1_000_000);
    const parsed = new URL(url, APP_ORIGIN);

    expect(parsed.pathname).toBe(REMINDER_LINK_PATH);
    expect(parsed.searchParams.get('next')).toBe('/tasks?task=abc');
    expect(verifyReminderLink(mint('/tasks?task=abc', 'user-1', 1_000_000), 1_000_000)).toEqual({
      userId: 'user-1',
      expiresAt: 1_000_000 + REMINDER_LINK_TTL_MS,
    });
  });

  it('keeps the destination out of the credential but still normalises it', () => {
    // Anything that is not an app path becomes the task list, so a tampered
    // `next` can move the user around this app but never off it.
    const parsed = new URL(signReminderLink('https://evil.example/pwn', 'user-1'), APP_ORIGIN);
    expect(parsed.searchParams.get('next')).toBe('/tasks');

    const protocolRelative = new URL(signReminderLink('//evil.example/pwn', 'user-1'), APP_ORIGIN);
    expect(protocolRelative.searchParams.get('next')).toBe('/tasks');
  });

  it('stops working once the window has passed', () => {
    const signedAt = 1_000_000;
    const token = mint('/habits?habit=h1', 'user-1', signedAt);

    expect(verifyReminderLink(token, signedAt + REMINDER_LINK_TTL_MS - 1)).not.toBeNull();
    expect(verifyReminderLink(token, signedAt + REMINDER_LINK_TTL_MS)).toBeNull();
  });

  it('rejects a token that was edited, truncated or signed with another secret', () => {
    const token = mint('/tasks?task=abc', 'user-1', 1_000_000);
    const [version, payload, signature] = token.split('.');

    // A different user, keeping the original signature.
    const forgedPayload = Buffer.from(JSON.stringify({ u: 'user-2', e: 1_000_000 })).toString('base64url');
    expect(verifyReminderLink(`${version}.${forgedPayload}.${signature}`, 1_000_000)).toBeNull();
    expect(verifyReminderLink(`${version}.${payload}`, 1_000_000)).toBeNull();
    expect(verifyReminderLink(`${version}.${payload}.`, 1_000_000)).toBeNull();
    expect(verifyReminderLink('', 1_000_000)).toBeNull();
    expect(verifyReminderLink(token, 1_000_000)).not.toBeNull();

    process.env.BETTER_AUTH_SECRET = `${SECRET}-rotated`;
    resetEnvCache();
    expect(verifyReminderLink(token, 1_000_000)).toBeNull();
  });
});

describe('following a reminder link', () => {
  let tempDir: string;
  let handler: (request: Request) => Promise<Response>;
  let userId: string;

  function cookieJar(response: Response): string {
    return (response.headers.getSetCookie?.() ?? [])
      .map((cookie) => cookie.split(';')[0])
      .filter(Boolean)
      .join('; ');
  }

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tasktick-reminder-link-'));
    const file = path.join(tempDir, 'db.sqlite');

    process.env.DATABASE_URL = `file:${file}`;
    process.env.BETTER_AUTH_SECRET = SECRET;
    process.env.APP_URL = APP_ORIGIN;
    resetEnvCache();
    resetDialectCache();
    resetAuthCache();
    await closeDb();

    const handle = new Database(file);
    try {
      handle.pragma('journal_mode = WAL');
      migrate(drizzle(handle), { migrationsFolder: path.join(process.cwd(), 'drizzle', 'sqlite') });
    } finally {
      handle.close();
    }

    const { getAuth, getAuthHandler } = await import('@/server/auth');
    handler = getAuthHandler() as (request: Request) => Promise<Response>;

    // The link names a user that already exists; there is no sign-up in this path.
    const context = await getAuth().$context;
    const created = await context.internalAdapter.createUser({
      email: USER_EMAIL,
      name: 'Reminder User',
      emailVerified: true,
    });
    userId = String(created.id);
  });

  afterEach(async () => {
    await closeDb();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('creates the session and lands on the reminder the notification was about', async () => {
    const target = '/tasks?task=task-42';
    const response = await handler(new Request(`${APP_ORIGIN}${signReminderLink(target, userId)}`));

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe(target);

    const cookies = cookieJar(response);
    expect(cookies).toContain(`${AUTH_COOKIE_PREFIX}.session_token=`);

    // The cookie is a real session: the library's own session read accepts it,
    // which is what a browser would do on the next request.
    const session = await handler(
      new Request(`${APP_ORIGIN}/api/auth/get-session`, { headers: { cookie: cookies } }),
    );
    expect(session.status).toBe(200);
    const body = (await session.json()) as { user?: { email?: string } } | null;
    expect(body?.user?.email).toBe(USER_EMAIL);
  });

  it('sends an expired link to the sign-in page with its destination kept', async () => {
    const signedAt = Date.now() - REMINDER_LINK_TTL_MS - 1_000;
    const response = await handler(
      new Request(`${APP_ORIGIN}${signReminderLink('/habits?habit=h1', userId, signedAt)}`),
    );

    expect(response.status).toBe(302);
    const location = response.headers.get('location') ?? '';
    expect(location).toContain('/login');
    expect(location).toContain('error=expired_reminder_link');
    expect(location).toContain(encodeURIComponent('/habits?habit=h1'));
    expect(cookieJar(response)).not.toContain('.session_token=');
  });

  it('refuses a link for an account that no longer exists', async () => {
    const response = await handler(new Request(`${APP_ORIGIN}${signReminderLink('/tasks', 'gone-user')}`));

    expect(response.status).toBe(302);
    expect(response.headers.get('location') ?? '').toContain('/login');
    expect(cookieJar(response)).not.toContain('.session_token=');
  });
});
