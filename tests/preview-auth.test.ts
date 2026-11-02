/**
 * Preview sign-in — the loopback-only escape hatch that makes this app
 * screenshottable (`src/lib/preview-auth.ts`).
 *
 * The interesting half is not that it works, it is that it stays off. Every test
 * below is written from that side: nothing enabled, a variable set to something
 * that is not an address, a request that arrived from another machine, a request
 * whose `Host` merely *looks* like loopback. Those are the cases where a mistake
 * would turn a convenience for a test environment into an authentication hole on
 * a self-hosted instance, so they are the cases pinned hardest.
 */
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import {
  isLoopbackHost,
  previewAuthAvailable,
  previewAuthEmail,
  PREVIEW_AUTH_ENV,
  PREVIEW_DEFAULT_EMAIL,
} from '@/lib/preview-auth';

const source = (relative: string): string =>
  readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8');

const headers = (host: string | null): Headers => {
  const value = new Headers();
  if (host !== null) value.set('host', host);
  return value;
};

describe('previewAuthEmail', () => {
  it('is off unless the variable is set', () => {
    expect(previewAuthEmail({})).toBeNull();
    expect(previewAuthEmail({ [PREVIEW_AUTH_ENV]: '' })).toBeNull();
    expect(previewAuthEmail({ [PREVIEW_AUTH_ENV]: '   ' })).toBeNull();
  });

  it('reads the usual spellings of "on" as the seeded account', () => {
    for (const value of ['1', 'true', 'TRUE', 'yes', 'on', ' 1 ']) {
      expect(previewAuthEmail({ [PREVIEW_AUTH_ENV]: value })).toBe(PREVIEW_DEFAULT_EMAIL);
    }
  });

  it('signs in as a named account when one is given', () => {
    expect(previewAuthEmail({ [PREVIEW_AUTH_ENV]: 'QA@Example.com ' })).toBe('qa@example.com');
  });

  it('refuses anything it cannot read as an address or as "on"', () => {
    // A typo must not become "some account, probably"; the failure it would cause
    // is a login page that quietly refuses for no stated reason.
    for (const value of ['onn', 'off', 'false', '0', 'no', 'nobody', 'a@b', 'not an email']) {
      expect(previewAuthEmail({ [PREVIEW_AUTH_ENV]: value })).toBeNull();
    }
  });
});

describe('isLoopbackHost', () => {
  it('accepts the names that mean this machine', () => {
    for (const host of [
      'localhost',
      'localhost:3000',
      'LOCALHOST:4101',
      '127.0.0.1:4101',
      '127.1.2.3',
      '::1',
      '[::1]:3000',
      'tasktick.localhost:3000',
    ]) {
      expect(isLoopbackHost(host), host).toBe(true);
    }
  });

  it('refuses every other address, including ones shaped like loopback', () => {
    for (const host of [
      '192.168.1.5:3000',
      '10.0.0.5',
      '0.0.0.0:3000',
      'evil.com',
      // The one that matters: a public hostname whose *prefix* is a loopback IP.
      '127.0.0.1.evil.com',
      'localhost.evil.com',
      '',
      undefined,
      null,
    ]) {
      expect(isLoopbackHost(host), String(host)).toBe(false);
    }
  });
});

describe('previewAuthAvailable', () => {
  const original = process.env[PREVIEW_AUTH_ENV];

  afterEach(() => {
    if (original === undefined) delete process.env[PREVIEW_AUTH_ENV];
    else process.env[PREVIEW_AUTH_ENV] = original;
  });

  it('needs both keys: the switch and a loopback request', () => {
    delete process.env[PREVIEW_AUTH_ENV];
    expect(previewAuthAvailable(headers('127.0.0.1:4101'))).toBeNull();

    process.env[PREVIEW_AUTH_ENV] = '1';
    expect(previewAuthAvailable(headers('127.0.0.1:4101'))).toBe(PREVIEW_DEFAULT_EMAIL);
    // Set, but the browser came from elsewhere — a proxy, the LAN, the internet.
    expect(previewAuthAvailable(headers('tasks.example.com'))).toBeNull();
    expect(previewAuthAvailable(headers('192.168.1.5:3000'))).toBeNull();
  });
});

describe('the preview sign-in is wired through the ordinary session path', () => {
  it('registers the endpoint only when an account is configured', () => {
    const AUTH = source('src/server/auth.ts');
    expect(AUTH).toContain('...(previewEmail ? [previewSignInPlugin()] : []),');
    expect(AUTH).toContain("createAuthEndpoint(\n        '/preview-session',");
    // The session is better-auth's own, created and written by its own helpers —
    // that is what keeps every downstream check honest.
    expect(AUTH).toContain('ctx.context.internalAdapter.createSession(user.id)');
    expect(AUTH).toContain('await setSessionCookie(ctx, { session, user });');
    // And it refuses a request that did not arrive over loopback.
    expect(AUTH).toContain('previewAuthAvailable(ctx.headers ?? new Headers())');
  });

  it('sends the login page to it, once, and never in a loop', () => {
    const PAGE = source('src/app/(auth)/login/page.tsx');
    expect(PAGE).toContain('if (!params.preview && previewAuthAvailable(request.headers)) {');
    expect(PAGE).toContain("redirect(`/api/auth/preview-session?next=${encodeURIComponent(next)}`);");
  });

  it('offers an account link only where registering is possible', () => {
    // The footer used to be unconditional, so on an instance with registration
    // closed the only link on the sign-in page bounced straight back to it.
    const FORM = source('src/components/auth/LoginForm.tsx');
    expect(FORM).toContain('{canRegister ? (');
    expect(FORM).toContain('New accounts are disabled on this server.');
    const PAGE = source('src/app/(auth)/login/page.tsx');
    expect(PAGE).toContain('canRegister={registrationAllowed(state)}');
  });

  it('says so on every screen while it is responsible for the session', () => {
    const SHELL = source('src/components/app/AppShell.tsx');
    expect(SHELL).toContain('{previewEmail ? <PreviewAuthBanner email={previewEmail} /> : null}');
    // Including the screens that publish no header of their own.
    expect(SHELL).toContain('{!published && previewEmail ? (');
    const LAYOUT = source('src/app/(app)/layout.tsx');
    expect(LAYOUT).toContain('preview === user.email.toLowerCase()');
  });

  it('shares one definition of "on" with the rest of the app', () => {
    expect(source('src/lib/env.ts')).toContain('isTruthyEnvFlag(v)');
    expect(source('src/server/http.ts')).toContain('return isTruthyEnvFlag(raw);');
  });
});
