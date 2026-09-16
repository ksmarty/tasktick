/**
 * Ordering keys.
 *
 * Reordering must not rewrite every sibling row (that is O(n) writes per drag
 * and produces a storm of conflict windows with the CalDAV sync engine). So each
 * row carries a `sortOrder` string, and inserting between two neighbours writes
 * exactly one row.
 *
 * Scheme: fixed-width base-36 strings ordered lexicographically.
 *
 * Two decisions here are load-bearing and easy to get wrong:
 *
 *  1. **Fixed width.** A variable-length scheme breaks as soon as one key grows
 *     longer than another, because then `"b" < "a0"` in string order. Constant
 *     width makes plain string comparison a correct numeric comparison. The
 *     tradeoff is that subdividing between the same pair runs out after ~20
 *     insertions; `keyBetween` reports that via `needsRenumber` and the caller
 *     renumbers the list with `spreadKeys`.
 *
 *  2. **Lowercase-only base-36 alphabet.** Ordering must agree between three
 *     different comparators: JavaScript `<`, SQLite's BINARY collation (byte
 *     order) and Postgres's collation (locale-aware, often ICU). A mixed-case
 *     alphabet like `0-9A-Za-z` satisfies only the first two — `localeCompare`
 *     and ICU order letters case-insensitively, so `V` sorts before `k` by
 *     codepoint but after it by locale. Restricting the alphabet to `[0-9a-z]`
 *     removes the ambiguity entirely, because every collation agrees that digits
 *     precede letters and that both ascend naturally.
 */
import type { Millis } from './types';

const DIGITS = '0123456789abcdefghijklmnopqrstuvwxyz';
const BASE = BigInt(DIGITS.length); // 36

export const DEFAULT_KEY_WIDTH = 8;

function decode(key: string): bigint {
  let value = 0n;
  for (const ch of key) {
    const digit = DIGITS.indexOf(ch);
    if (digit < 0) throw new Error(`Invalid sort key character: ${JSON.stringify(ch)}`);
    value = value * BASE + BigInt(digit);
  }
  return value;
}

function encode(value: bigint, width: number): string {
  if (value < 0n) throw new Error('Sort key cannot be negative');
  let out = '';
  let v = value;
  while (v > 0n) {
    out = DIGITS[Number(v % BASE)] + out;
    v /= BASE;
  }
  out = out.padStart(width, DIGITS[0]);
  if (out.length > width) {
    throw new Error('Sort key space exhausted; renumber the list with spreadKeys()');
  }
  return out;
}

export const FIRST_KEY = DIGITS[0].repeat(DEFAULT_KEY_WIDTH);

/** Evenly spaced keys for `count` items — used for seeding and for renumbering. */
export function spreadKeys(count: number, width = DEFAULT_KEY_WIDTH): string[] {
  if (count <= 0) return [];
  const total = BASE ** BigInt(width);
  const step = total / BigInt(count + 1);
  const keys: string[] = [];
  for (let i = 1; i <= count; i++) {
    keys.push(encode(step * BigInt(i), width));
  }
  return keys;
}

export interface KeyBetweenResult {
  key: string;
  /** True when the gap was exhausted and the caller must renumber the list. */
  needsRenumber: boolean;
}

/**
 * A key that sorts strictly between `before` and `after`.
 * Pass `null` for either end to prepend/append.
 */
export function keyBetween(before: string | null, after: string | null, width = DEFAULT_KEY_WIDTH): KeyBetweenResult {
  const floor = before ? decode(before) : -1n;
  const ceiling = after ? decode(after) : BASE ** BigInt(width);

  if (after && before && before >= after) {
    throw new Error(`Sort keys out of order: ${before} >= ${after}`);
  }

  // Need at least one unused value strictly between the neighbours.
  if (ceiling - floor <= 1n) {
    return { key: before ?? FIRST_KEY, needsRenumber: true };
  }

  const mid = floor + (ceiling - floor) / 2n;
  if (mid === floor || mid === ceiling) {
    return { key: before ?? FIRST_KEY, needsRenumber: true };
  }

  let encoded: string;
  try {
    encoded = encode(mid, width);
  } catch {
    return { key: before ?? FIRST_KEY, needsRenumber: true };
  }

  // A key equal to either neighbour would break strict ordering.
  if (before !== null && encoded <= before) return { key: before, needsRenumber: true };
  if (after !== null && encoded >= after) return { key: after, needsRenumber: true };

  return { key: encoded, needsRenumber: false };
}

/** Convenience wrapper that throws rather than signalling, for the common path. */
export function requireKeyBetween(before: string | null, after: string | null, width = DEFAULT_KEY_WIDTH): string {
  return keyBetween(before, after, width).key;
}

export function compareKeys(a: string | null | undefined, b: string | null | undefined): number {
  // Deliberately NOT `localeCompare`: keys are base-36 and must be compared by
  // code unit so that JavaScript, SQLite and Postgres all agree on the order.
  const left = a ?? '';
  const right = b ?? '';
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

/**
 * Recomputes the ordered key sequence after a move that would otherwise
 * exhaust the key space. Pure, so it is trivially unit-testable.
 */
export function reorderKeys(
  orderedIds: string[],
  width = DEFAULT_KEY_WIDTH,
): { id: string; sortOrder: string }[] {
  const keys = spreadKeys(orderedIds.length, width);
  return orderedIds.map((id, index) => ({ id, sortOrder: keys[index] }));
}

/** Derives a stable sort key from a timestamp when no better signal exists. */
export function keyFromMillis(ms: Millis, width = DEFAULT_KEY_WIDTH): string {
  return encode(BigInt(Math.max(0, Math.floor(ms))), width);
}
