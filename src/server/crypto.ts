/**
 * Field-level encryption for secrets that must be recoverable (CalDAV app
 * passwords). Passwords are *never* stored in plaintext, and the key is derived
 * from `BETTER_AUTH_SECRET` so a stolen database file alone is not enough.
 *
 * Format: `v1.<iv-b64>.<tag-b64>.<ciphertext-b64>` (AES-256-GCM).
 */
import { createCipheriv, createDecipheriv, randomBytes, hkdfSync, timingSafeEqual } from 'node:crypto';
import { getEnv } from '@/lib/env';

const VERSION = 'v1';
const ALGO = 'aes-256-gcm';
const IV_BYTES = 12;
const KEY_BYTES = 32;

let cachedKey: Buffer | null = null;

function key(): Buffer {
  if (cachedKey) return cachedKey;
  const secret = getEnv().BETTER_AUTH_SECRET;
  // Distinct info string => the encryption key is independent of the one used
  // to sign sessions, so leaking one does not compromise the other.
  cachedKey = Buffer.from(hkdfSync('sha256', secret, 'tasktick-field-encryption', 'caldav-credentials', KEY_BYTES));
  return cachedKey;
}

export function encryptField(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, key(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString('base64'), tag.toString('base64'), enc.toString('base64')].join('.');
}

export function decryptField(payload: string): string {
  const parts = payload.split('.');
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error('Unsupported ciphertext format');
  }
  const [, ivB64, tagB64, dataB64] = parts;
  const decipher = createDecipheriv(ALGO, key(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8');
}

/** Constant-time comparison for opaque tokens (invites, ICS feed URLs). */
export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/** URL-safe random token used for invites and ICS feed URLs. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function newId(): string {
  return randomBytes(16).toString('base64url');
}
