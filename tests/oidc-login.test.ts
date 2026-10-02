/**
 * OIDC sign-in, end to end, through the real auth handler.
 *
 * Regression guard for the shipped 404: the client posted to
 * `/api/auth/sign-in/oauth2`, which better-auth 1.7 no longer registers — the
 * `genericOAuth` plugin now contributes its providers to `context.socialProviders`
 * and the core `/sign-in/social` endpoint drives the flow. The symptom was
 * `POST /api/auth/sign-in/oauth2 404` and "Could not start single sign-on".
 *
 * A source-string assertion ("the client calls /sign-in/social") would pass even
 * if better-auth moved the route again, so this drives the real handler against a
 * real mock provider and follows the whole flow to a session cookie. The two
 * things it pins are the ones that were wrong: the start endpoint answers, and
 * the callback it advertises is the one the provider can actually reach.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetEnvCache } from '@/lib/env';
import { resetAuthCache } from '@/server/auth';
import { resetDialectCache } from '@/server/db/dialect';
import { closeDb } from '@/server/db';
import { startOidcSignIn } from '@/lib/auth-client';

const SECRET = 'test-secret-test-secret-test-secret-oidc';
const APP_ORIGIN = 'http://127.0.0.1:3000';
const CLIENT_ID = 'tasktick-test-client';
const CLIENT_SECRET = 'tasktick-test-secret';
const SUBJECT = 'oidc-subject-1';
const USER_EMAIL = 'oidc-user@example.com';
const USER_NAME = 'OIDC User';
const KID = 'tasktick-test-key';

/* -------------------------------------------------------------------------- */
/* mock OpenID Provider                                                       */
/* -------------------------------------------------------------------------- */

interface PendingAuthorization {
  codeChallenge: string;
  redirectUri: string;
  nonce?: string;
}

const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const publicJwk = publicKey.export({ format: 'jwk' }) as Record<string, unknown>;

const b64url = (input: Buffer | string) => Buffer.from(input).toString('base64url');

function signIdToken(claims: Record<string, unknown>): string {
  const signingInput = `${b64url(JSON.stringify({ alg: 'RS256', kid: KID, typ: 'JWT' }))}.${b64url(
    JSON.stringify(claims),
  )}`;
  const signature = crypto.sign('sha256', Buffer.from(signingInput), privateKey);
  return `${signingInput}.${b64url(signature)}`;
}

async function readBody(req: http.IncomingMessage): Promise<URLSearchParams> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (req.headers['content-type']?.includes('application/json')) {
    const parsed = JSON.parse(raw || '{}') as Record<string, string>;
    return new URLSearchParams(parsed);
  }
  return new URLSearchParams(raw);
}

function basicCredentials(header: string | undefined): [string, string] | null {
  if (!header?.startsWith('Basic ')) return null;
  const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
  const index = decoded.indexOf(':');
  return index === -1 ? null : [decoded.slice(0, index), decoded.slice(index + 1)];
}

/**
 * Starts a standards-compliant-enough OP on a loopback port and returns it with
 * its issuer. Everything is signed for real (RS256 + a served JWKS) so the
 * library's own verification is exercised rather than stubbed.
 */
async function startProvider() {
  const authorizations = new Map<string, PendingAuthorization>();
  const accessTokens = new Map<string, string>();

  const server = http.createServer((req, res) => {
    void (async () => {
      const issuer = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      const url = new URL(req.url ?? '/', issuer);

      if (url.pathname === '/.well-known/openid-configuration') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            issuer,
            authorization_endpoint: `${issuer}/authorize`,
            token_endpoint: `${issuer}/token`,
            userinfo_endpoint: `${issuer}/userinfo`,
            jwks_uri: `${issuer}/jwks`,
            response_types_supported: ['code'],
            subject_types_supported: ['public'],
            id_token_signing_alg_values_supported: ['RS256'],
            scopes_supported: ['openid', 'email', 'profile'],
            token_endpoint_auth_methods_supported: ['client_secret_post', 'client_secret_basic'],
            code_challenge_methods_supported: ['S256'],
          }),
        );
        return;
      }

      if (url.pathname === '/jwks') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ keys: [{ ...publicJwk, kid: KID, alg: 'RS256', use: 'sig' }] }));
        return;
      }

      if (url.pathname === '/authorize') {
        // A real provider would show a consent screen; this one consents
        // immediately and bounces straight back with an authorization code.
        const code = `code-${crypto.randomUUID()}`;
        authorizations.set(code, {
          codeChallenge: url.searchParams.get('code_challenge') ?? '',
          redirectUri: url.searchParams.get('redirect_uri') ?? '',
          nonce: url.searchParams.get('nonce') ?? undefined,
        });
        const back = new URL(url.searchParams.get('redirect_uri')!);
        back.searchParams.set('code', code);
        const state = url.searchParams.get('state');
        if (state) back.searchParams.set('state', state);
        res.writeHead(302, { location: back.toString() });
        res.end();
        return;
      }

      if (url.pathname === '/token') {
        const params = await readBody(req);
        const code = params.get('code') ?? '';
        const pending = authorizations.get(code);
        const credentials = basicCredentials(req.headers.authorization);
        const clientId = credentials?.[0] ?? params.get('client_id');
        const clientSecret = credentials?.[1] ?? params.get('client_secret');

        if (!pending || clientId !== CLIENT_ID || clientSecret !== CLIENT_SECRET) {
          res.writeHead(400, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: 'invalid_grant' }));
          return;
        }

        // PKCE is verified for real: the challenge must match the verifier.
        const verifier = params.get('code_verifier') ?? '';
        const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
        if (challenge !== pending.codeChallenge) {
          res.writeHead(400, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: 'invalid_grant', error_description: 'PKCE mismatch' }));
          return;
        }

        authorizations.delete(code);
        const accessToken = `access-${crypto.randomUUID()}`;
        accessTokens.set(accessToken, SUBJECT);
        const now = Math.floor(Date.now() / 1000);
        const idToken = signIdToken({
          iss: issuer,
          sub: SUBJECT,
          aud: CLIENT_ID,
          exp: now + 3600,
          iat: now,
          email: USER_EMAIL,
          email_verified: true,
          name: USER_NAME,
          ...(pending.nonce ? { nonce: pending.nonce } : {}),
        });

        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            access_token: accessToken,
            token_type: 'Bearer',
            expires_in: 3600,
            scope: 'openid email profile',
            id_token: idToken,
          }),
        );
        return;
      }

      if (url.pathname === '/userinfo') {
        const token = (req.headers.authorization ?? '').replace(/^Bearer /, '');
        if (!accessTokens.has(token)) {
          res.writeHead(401, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: 'invalid_token' }));
          return;
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            sub: SUBJECT,
            email: USER_EMAIL,
            email_verified: true,
            name: USER_NAME,
            preferred_username: 'oidc-user',
            picture: 'https://example.com/avatar.png',
          }),
        );
        return;
      }

      res.writeHead(404).end();
    })();
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const issuer = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { server, issuer };
}

/* -------------------------------------------------------------------------- */
/* harness                                                                    */
/* -------------------------------------------------------------------------- */

let tempDir = '';
let provider: http.Server;
let issuer = '';
let handler: (request: Request) => Promise<Response>;

/**
 * The browser boundary, reproduced.
 *
 * `startOidcSignIn` is the code that was wrong, so the test has to run *it*, not
 * a hand-written request that merely looks like it. Its relative `fetch` is
 * routed into the real handler (same-origin) while genuine cross-origin calls
 * still reach the mock provider. `routedResponses` keeps the responses the
 * browser would have seen, which is where the state cookie lives.
 *
 * A `let` holding only the last response cannot be used: TypeScript narrows it
 * to `null` at the reset and cannot see the assignment made inside the fetch
 * override, so the read afterwards would be typed `never` and `tsc` would fail.
 */
const realFetch = globalThis.fetch;
const routedResponses: Response[] = [];

function installBrowser() {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url;
    const absolute = new URL(raw, APP_ORIGIN);
    if (absolute.origin === APP_ORIGIN) {
      const response = await handler(new Request(absolute.toString(), init));
      routedResponses.push(response.clone());
      return response;
    }
    return realFetch(input as never, init);
  }) as typeof fetch;

  // The function navigates on success; there is no `window` in node.
  (globalThis as { window?: unknown }).window = { location: { href: '' } };
}

/** Collects the cookies better-auth set so the callback can present them back. */
function cookieJar(response: Response): string {
  const raw = response.headers.getSetCookie?.() ?? [];
  return raw
    .map((cookie) => cookie.split(';')[0])
    .filter(Boolean)
    .join('; ');
}

beforeEach(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tasktick-oidc-'));
  const file = path.join(tempDir, 'auth.db');

  const started = await startProvider();
  provider = started.server;
  issuer = started.issuer;

  process.env.DATABASE_URL = `file:${file}`;
  process.env.BETTER_AUTH_SECRET = SECRET;
  process.env.APP_URL = APP_ORIGIN;
  process.env.OIDC_ISSUER = issuer;
  process.env.OIDC_CLIENT_ID = CLIENT_ID;
  process.env.OIDC_CLIENT_SECRET = CLIENT_SECRET;
  process.env.OIDC_PROVIDER_NAME = 'Single sign-on';

  resetEnvCache();
  resetDialectCache();
  resetAuthCache();
  await closeDb();

  const handle = new Database(file);
  try {
    handle.pragma('journal_mode = WAL');
    handle.pragma('foreign_keys = ON');
    migrate(drizzle(handle), { migrationsFolder: path.join(process.cwd(), 'drizzle', 'sqlite') });
  } finally {
    handle.close();
  }

  const { getAuthHandler } = await import('@/server/auth');
  handler = getAuthHandler() as (request: Request) => Promise<Response>;
  installBrowser();
});

afterEach(async () => {
  globalThis.fetch = realFetch;
  delete (globalThis as { window?: unknown }).window;
  await closeDb();
  await new Promise<void>((resolve) => provider.close(() => resolve()));
  fs.rmSync(tempDir, { recursive: true, force: true });
});

/** Runs the real client entry point and returns what it was handed. */
async function startSignIn() {
  routedResponses.length = 0;
  await startOidcSignIn('/tasks');
  const response = routedResponses.at(-1);
  if (!response) throw new Error('the client never reached the auth handler');
  const body = (await response.clone().json()) as { url?: string };
  const navigated = (globalThis as unknown as { window: { location: { href: string } } }).window.location.href;
  return { status: response.status, body, cookies: cookieJar(response), navigated };
}

/* -------------------------------------------------------------------------- */
/* tests                                                                      */
/* -------------------------------------------------------------------------- */

describe('OIDC sign-in', () => {
  it('starts the flow at /sign-in/social and points at the provider', async () => {
    const { status, body, navigated } = await startSignIn();

    expect(status).toBe(200);
    expect(body.url, 'no authorization URL came back').toBeTruthy();
    // The client must navigate to the provider itself, not render a link.
    expect(navigated).toBe(body.url);

    const authorize = new URL(body.url!);
    expect(authorize.origin + authorize.pathname).toBe(`${issuer}/authorize`);
    expect(authorize.searchParams.get('client_id')).toBe(CLIENT_ID);
    // PKCE is on, so a challenge must be present or the provider rejects us.
    expect(authorize.searchParams.get('code_challenge_method')).toBe('S256');
    expect(authorize.searchParams.get('code_challenge')).toBeTruthy();
    // This is the URI the operator has to register; if it moves, so must the docs.
    expect(authorize.searchParams.get('redirect_uri')).toBe(`${APP_ORIGIN}/api/auth/callback/oidc`);
  });

  it('no longer serves the removed /sign-in/oauth2 endpoint', async () => {
    // The old client called this. If better-auth ever brings it back the client
    // could regress to it silently, so assert it is gone rather than assume.
    const response = await handler(
      new Request(`${APP_ORIGIN}/api/auth/sign-in/oauth2`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: APP_ORIGIN },
        body: JSON.stringify({ providerId: 'oidc', callbackURL: '/tasks' }),
      }),
    );
    expect(response.status).toBe(404);
  });

  it('completes the flow and issues a session', async () => {
    const { body, cookies } = await startSignIn();

    // Follow the authorization request. The provider answers with a 302 back to
    // the redirect_uri carrying the code and state.
    const authorized = await fetch(body.url!, { redirect: 'manual' });
    expect(authorized.status).toBe(302);
    const callbackUrl = new URL(authorized.headers.get('location')!);
    expect(callbackUrl.origin + callbackUrl.pathname).toBe(`${APP_ORIGIN}/api/auth/callback/oidc`);

    // Hand that straight to the app's callback, as the browser would.
    const callback = await handler(
      new Request(callbackUrl.toString(), {
        method: 'GET',
        headers: { cookie: cookies, origin: APP_ORIGIN },
      }),
    );
    expect(callback.status, await callback.clone().text()).toBeLessThan(400);

    const sessionCookie = cookieJar(callback);
    const session = await handler(
      new Request(`${APP_ORIGIN}/api/auth/get-session`, {
        method: 'GET',
        headers: { cookie: sessionCookie || cookies, origin: APP_ORIGIN },
      }),
    );
    const sessionBody = (await session.json()) as { user?: { email?: string; name?: string } } | null;
    expect(sessionBody?.user?.email).toBe(USER_EMAIL);
    expect(sessionBody?.user?.name).toBe(USER_NAME);
  });

  /**
   * The second half of the report: "I shouldn't have to define both
   * BETTER_AUTH_TRUSTED_ORIGINS and APP_URL".
   *
   * `baseURL` is `APP_URL`, and better-auth seeds the allow-list with the base
   * URL's origin before appending `trustedOrigins` and then
   * `BETTER_AUTH_TRUSTED_ORIGINS`. So APP_URL authorises itself and the variable
   * is purely additive — it is not a prerequisite for a public hostname.
   *
   * NOTE: the *enforcement* of that list cannot be asserted from a unit test.
   * better-auth sets `advanced.disableOriginCheck` to true by default when it
   * detects a test environment (`isTest()`), and it reads NODE_ENV once at import,
   * so a request from `https://evil.com` is accepted here no matter what. The
   * policy itself is covered against a real server by `scripts/smoke/origins.mjs`;
   * what is pinned here is the composition that makes APP_URL sufficient.
   */
  it('trusts APP_URL on its own, with BETTER_AUTH_TRUSTED_ORIGINS purely additive', async () => {
    expect(process.env.BETTER_AUTH_TRUSTED_ORIGINS).toBeUndefined();

    const { getAuth } = await import('@/server/auth');
    const readOrigins = async () =>
      ((await (getAuth() as unknown as { $context: Promise<{ trustedOrigins: string[] }> }).$context)
        .trustedOrigins) ?? [];

    expect(await readOrigins()).toContain(APP_ORIGIN);

    process.env.BETTER_AUTH_TRUSTED_ORIGINS = 'https://tasks.notato.xyz';
    resetEnvCache();
    resetAuthCache();
    const origins = await readOrigins();

    expect(origins).toContain(APP_ORIGIN);
    expect(origins).toContain('https://tasks.notato.xyz');
  });
});
