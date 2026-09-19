/**
 * Fetching a URL a user typed, from inside the server.
 *
 * This is the one genuinely dangerous thing an iCal subscription does. The app
 * is self-hosted and may well be reachable from the internet, and the server
 * sits on a private network next to things that are not meant to be on the
 * internet — routers, NAS boxes, `169.254.169.254` on a cloud host, the
 * instance's own admin surface on localhost. A feature that will fetch any URL
 * a user names turns "add a calendar subscription" into "make the server read an
 * internal endpoint for me", and the response comes back to the user.
 *
 * So the address is checked, not just the string:
 *
 *  1. **Scheme**: `http` and `https` only. That rejects `file:`, `gopher:`,
 *     `data:` and friends.
 *  2. **Hostname resolution**: the host is resolved and *every* returned address
 *     is checked. Checking the literal hostname would be trivially bypassed by a
 *     domain whose A record points at `127.0.0.1`.
 *  3. **Address ranges**: loopback, private, link-local (including the cloud
 *     metadata address), CGNAT, multicast, reserved and unspecified are all
 *     refused, for IPv4 and IPv6.
 *  4. **Redirects**: followed by hand, re-checking each hop. `fetch`'s own
 *     redirect handling would follow a public URL to an internal one, which is
 *     the standard way this check gets bypassed.
 *
 * What this deliberately does *not* do is pin the connection to the address that
 * was checked. A DNS record can change between the lookup and the request
 * (DNS rebinding), so a determined attacker can still win this race. Closing it
 * properly means connecting to the resolved IP with a `Host` header, which needs
 * a custom agent per scheme. The exposure is a self-hosted app whose user is
 * already trusted with the server; this raises the bar from "trivial" to
 * "requires a race", which is the proportionate answer here.
 */
import { promises as dns } from 'node:dns';
import { isIP } from 'node:net';

/** A response we are willing to read. */
export interface FetchedFeed {
  body: string;
  etag: string | null;
  notModified: boolean;
}

export type FeedFetchError =
  | 'invalid-url'
  | 'blocked-address'
  | 'too-many-redirects'
  | 'timeout'
  | 'http-error'
  | 'too-large'
  | 'network-error';

export class FeedError extends Error {
  constructor(
    readonly code: FeedFetchError,
    message: string,
    readonly detail?: string,
  ) {
    super(message);
    this.name = 'FeedError';
  }
}

/** How much of a feed we will read. A calendar is text; anything larger is abuse. */
export const MAX_FEED_BYTES = 8 * 1024 * 1024;

export const FEED_TIMEOUT_MS = 20_000;

export const MAX_REDIRECTS = 3;

/**
 * Parse and validate the scheme, returning a `URL`.
 *
 * `webcal://` is accepted and rewritten to `https://`: it is what every calendar
 * app hands out for a subscription link (the app's own outgoing feed offers
 * one), and it is not a real scheme — it means "fetch this over HTTP".
 */
export function parseFeedUrl(input: string): URL {
  const trimmed = input.trim();
  if (!trimmed) throw new FeedError('invalid-url', 'Enter a calendar URL.');

  const normalised = trimmed.replace(/^webcal:\/\//i, 'https://').replace(/^webcals:\/\//i, 'https://');

  let url: URL;
  try {
    url = new URL(normalised);
  } catch {
    throw new FeedError('invalid-url', 'That is not a valid URL.');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new FeedError('invalid-url', 'Only http and https calendar URLs are supported.');
  }
  if (!url.hostname) throw new FeedError('invalid-url', 'That URL has no host.');
  // Credentials in the URL would be logged and echoed back; refuse them.
  if (url.username || url.password) {
    throw new FeedError('invalid-url', 'Remove the username and password from the URL.');
  }
  return url;
}

/** True when an address must never be reached from here. */
export function isBlockedAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) return isBlockedV4(address);
  if (version === 6) return isBlockedV6(address);
  // Not an IP at all — the caller should have resolved it first.
  return true;
}

function isBlockedV4(address: string): boolean {
  const parts = address.split('.').map((p) => Number(p));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = parts;

  if (a === 0) return true; // "this network"
  if (a === 10) return true; // private
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local, incl. 169.254.169.254 metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 0) return true; // IETF protocol assignments
  if (a === 192 && b === 168) return true; // private
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a >= 224) return true; // multicast, reserved, broadcast
  return false;
}

function isBlockedV6(address: string): boolean {
  const lower = address.toLowerCase().split('%')[0];

  // IPv4-mapped (::ffff:127.0.0.1) and IPv4-compatible addresses are the classic
  // way an IPv6 check leaks an IPv4 target.
  const mapped = lower.match(/^::(?:ffff:)?(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isBlockedV4(mapped[1]);

  if (lower === '::' || lower === '::1') return true; // unspecified, loopback
  if (lower.startsWith('fe80')) return true; // link-local
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // unique local
  if (lower.startsWith('ff')) return true; // multicast
  // 2001:db8::/32 documentation, 2001:0::/32 Teredo.
  if (lower.startsWith('2001:db8') || lower.startsWith('2001:0')) return true;
  return false;
}

/**
 * Resolve a host and refuse it if any address it maps to is internal.
 *
 * Every address is checked, not the first: a host with both a public and a
 * private record must not be reachable at all, or the check becomes a coin toss.
 */
export async function assertPublicHost(hostname: string): Promise<void> {
  // A bare IP literal needs no lookup.
  if (isIP(hostname)) {
    if (isBlockedAddress(hostname)) {
      throw new FeedError('blocked-address', 'That address is not reachable from this server.');
    }
    return;
  }

  let addresses: { address: string }[];
  try {
    addresses = await dns.lookup(hostname, { all: true });
  } catch {
    throw new FeedError('network-error', 'That host could not be resolved.');
  }
  if (addresses.length === 0) {
    throw new FeedError('network-error', 'That host could not be resolved.');
  }
  for (const { address } of addresses) {
    if (isBlockedAddress(address)) {
      throw new FeedError('blocked-address', 'That host resolves to an address this server will not reach.');
    }
  }
}

/**
 * Fetch a feed, following redirects by hand so each hop is checked.
 *
 * `etag` enables a conditional request: a feed that has not changed answers
 * `304` and costs neither bandwidth nor a re-parse, which matters when the
 * scheduler polls it every quarter of an hour.
 */
export async function fetchFeed(
  rawUrl: string,
  etag: string | null,
  deps: { fetchImpl?: typeof fetch } = {},
): Promise<FetchedFeed> {
  const doFetch = deps.fetchImpl ?? fetch;
  let url = parseFeedUrl(rawUrl);

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    await assertPublicHost(url.hostname);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FEED_TIMEOUT_MS);
    let response: Response;
    try {
      response = await doFetch(url.toString(), {
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          Accept: 'text/calendar, text/plain;q=0.8, */*;q=0.1',
          'User-Agent': 'TaskTick/iCal',
          ...(etag && hop === 0 ? { 'If-None-Match': etag } : {}),
        },
      });
    } catch (error) {
      const aborted = error instanceof Error && error.name === 'AbortError';
      throw new FeedError(
        aborted ? 'timeout' : 'network-error',
        aborted ? 'The calendar did not respond in time.' : 'The calendar could not be reached.',
      );
    } finally {
      clearTimeout(timer);
    }

    if (response.status === 304) return { body: '', etag, notModified: true };

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) throw new FeedError('http-error', 'The calendar redirected without a location.');
      // Resolve relative to the hop we just made, then loop — the next iteration
      // re-checks the address.
      url = parseFeedUrl(new URL(location, url).toString());
      continue;
    }

    if (!response.ok) {
      throw new FeedError('http-error', `The calendar returned ${response.status}.`);
    }

    // Read with a ceiling rather than trusting Content-Length, which can lie.
    const declared = Number(response.headers.get('content-length') ?? '0');
    if (declared > MAX_FEED_BYTES) {
      throw new FeedError('too-large', 'That calendar is too large to import.');
    }
    const body = await readCapped(response);
    const nextEtag = response.headers.get('etag');
    return { body, etag: nextEtag ?? null, notModified: false };
  }

  throw new FeedError('too-many-redirects', 'That calendar redirected too many times.');
}

async function readCapped(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return await response.text();

  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > MAX_FEED_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new FeedError('too-large', 'That calendar is too large to import.');
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder('utf-8').decode(merged);
}
