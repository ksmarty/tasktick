/**
 * A reminder link that signs the browser in, so a tap from a notification does
 * not end at a password prompt.
 *
 * ## Why this exists
 *
 * A reminder delivered through Home Assistant lands on an iPhone as a
 * notification whose tap opens **Safari**, not the installed web app: iOS has no
 * way to hand a URL to a home-screen web app (no universal links for PWAs). So
 * the tap arrives in a browser with no TaskTick session and, before this, the
 * user had to sign in before they could see the reminder they had just been
 * told about.
 *
 * The link now carries a credential, minted when the notification is sent and
 * verified when it is tapped:
 *
 *   `/api/auth/reminder-link?next=%2Ftasks%3Ftask%3Dabc&token=v1.<payload>.<sig>`
 *
 * Following it creates a session for that one user and redirects to `next`,
 * which is the reminder's own screen.
 *
 * ## What the credential is worth
 *
 * Deliberately little:
 *
 *  - **Short-lived.** {@link REMINDER_LINK_TTL_MS} is fifteen minutes, the
 *    window between a reminder being sent and being tapped.
 *  - **One user.** The payload names a user id and an expiry and nothing else;
 *    there is no scope, no role and no "act as".
 *  - **Signed, not stored.** HMAC-SHA256 under a key derived from
 *    `BETTER_AUTH_SECRET` with its own info string, so it is independent of the
 *    session-cookie signing key and of the CalDAV field-encryption key. Nothing
 *    is written to the database to mint one.
 *  - **The destination is not in the credential.** `next` travels in the query
 *    and is put through `safeNextPath` both when the link is minted and when it
 *    is followed, so tampering with it can only move the user to another screen
 *    of this app — never to another origin. Keeping it outside the token is also
 *    what lets an *expired* link still say where it was going: the sign-in page
 *    it falls back to carries the same `next`.
 *
 * The tap it authorises is the same trust the notification itself already
 * carried: whoever can read the notification can act on the item in it
 * (`/api/reminders/ack` needs nothing more than a session). What changes is that
 * a session now costs one tap instead of a password.
 *
 * Signing is only applied on the Home Assistant route (`routeDelivery` in
 * `src/server/services/reminders.ts`). The app's own Web Push payload goes to a
 * service worker inside an already-signed-in app, so a credential there would be
 * sent to the push service for no benefit.
 */
import { createHmac, hkdfSync } from 'node:crypto';
import { getEnv } from '@/lib/env';
import { safeNextPath } from '@/lib/safe-next';
import { safeEqual } from './crypto';

/** Where the tap lands. Also the better-auth endpoint that verifies the token. */
export const REMINDER_LINK_PATH = '/api/auth/reminder-link';

/**
 * How long a minted link works for.
 *
 * A reminder is tapped within minutes of arriving, and the notification stays on
 * the lock screen far longer than this — an unread reminder whose link has
 * expired falls back to the normal sign-in page, which still carries the
 * destination, so the worst case is the behaviour the app had before.
 */
export const REMINDER_LINK_TTL_MS = 15 * 60 * 1000;

/** Token version, so a future format change invalidates old links instead of misreading them. */
const TOKEN_VERSION = 'v1';

/** What a verified token claims. The destination travels separately — see below. */
export interface ReminderLinkClaims {
  userId: string;
  expiresAt: number;
}

function signingKey(): Buffer {
  const secret = getEnv().BETTER_AUTH_SECRET;
  return Buffer.from(hkdfSync('sha256', secret, 'tasktick-reminder-link', 'reminder-link-v1', 32));
}

function signature(versionedPayload: string): string {
  return createHmac('sha256', signingKey()).update(versionedPayload, 'utf8').digest('base64url');
}

function encodeClaims(userId: string, expiresAt: number): string {
  // Short keys: this string ends up in a notification's URL.
  return Buffer.from(JSON.stringify({ u: userId, e: expiresAt }), 'utf8').toString('base64url');
}

/**
 * Builds the tap target for one reminder, signed for one user.
 *
 * `next` is normalised with `safeNextPath` rather than trusted: an already-clean
 * path comes back unchanged, and anything else becomes the task list, which is a
 * better landing than an error.
 */
export function signReminderLink(next: string, userId: string, nowMs: number = Date.now()): string {
  const destination = safeNextPath(next);
  const payload = encodeClaims(userId, nowMs + REMINDER_LINK_TTL_MS);
  const token = `${TOKEN_VERSION}.${payload}.${signature(`${TOKEN_VERSION}.${payload}`)}`;
  const query = new URLSearchParams({ next: destination, token });
  return `${REMINDER_LINK_PATH}?${query.toString()}`;
}

/**
 * Reads a token back, or `null` for anything not worth acting on.
 *
 * Every failure is the same `null` on purpose: a tampered token, a truncated
 * one, one signed with a previous secret and one that has simply aged out all
 * mean "do not sign in", and the caller sends the user to the ordinary sign-in
 * page either way. There is no value in telling an attacker which of them it was.
 */
export function verifyReminderLink(token: string, nowMs: number = Date.now()): ReminderLinkClaims | null {
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== TOKEN_VERSION) return null;

  const [, payload, provided] = parts;
  if (!provided || !safeEqual(provided, signature(`${TOKEN_VERSION}.${payload}`))) return null;

  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (typeof decoded !== 'object' || decoded === null) return null;

  const { u, e } = decoded as { u?: unknown; e?: unknown };
  if (typeof u !== 'string' || u.length === 0) return null;
  if (typeof e !== 'number' || !Number.isFinite(e)) return null;
  if (e <= nowMs) return null;
  // A signature cannot be forged, so an expiry beyond the window means the clock
  // or the secret changed under us. Either way the link is not trustworthy.
  if (e - nowMs > REMINDER_LINK_TTL_MS) return null;

  return { userId: u, expiresAt: e };
}
