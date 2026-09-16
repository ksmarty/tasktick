/**
 * Network-origin helpers.
 *
 * ## Why this exists
 *
 * better-auth rejects any state-changing request whose `Origin` is not in
 * `trustedOrigins`. On a self-hosted instance that is served on a LAN — or over
 * Tailscale, or from a NAS hostname — the origin the browser sends is whatever
 * address the user typed, which by definition is not the `APP_URL` baked into
 * the config. The result is a hard `INVALID_ORIGIN` on the very first screen a
 * user sees, the registration form.
 *
 * So the auth config trusts the request's own origin **when that origin is on a
 * private network**. That is safe, and the reasoning matters:
 *
 * The `Origin` header is set by the browser and cannot be forged by page
 * JavaScript. A hostile page on the public internet therefore always sends its
 * own public origin, which this module rejects. Reaching a private origin would
 * require already serving content from inside the network. DNS-rebinding does
 * not help either: the rebinding page still runs on its own public origin, so
 * the header it produces stays public.
 *
 * Everything here is pure and synchronous so it can be unit tested without a
 * server, which matters because this is security-relevant logic.
 */

/** IPv4 ranges that are never routable on the public internet. */
const PRIVATE_IPV4 = [
  { cidr: [0, 0, 0, 0], bits: 8 }, // "this network"
  { cidr: [10, 0, 0, 0], bits: 8 }, // RFC 1918
  { cidr: [100, 64, 0, 0], bits: 10 }, // CGNAT — also used by Tailscale
  { cidr: [127, 0, 0, 0], bits: 8 }, // loopback
  { cidr: [169, 254, 0, 0], bits: 16 }, // link-local
  { cidr: [172, 16, 0, 0], bits: 12 }, // RFC 1918
  { cidr: [192, 168, 0, 0], bits: 16 }, // RFC 1918
];

function ipv4ToInt(parts: number[]): number {
  // `>>> 0` keeps the result an unsigned 32-bit integer.
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

/** A single DNS label: alphanumeric and hyphens, not starting or ending with one. */
const HOSTNAME_LABEL = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

function parseIpv4(value: string): number[] | null {
  const parts = value.split('.');
  if (parts.length !== 4) return null;

  const octets: number[] = [];
  for (const part of parts) {
    // Reject "01", "+1", "1e2" and anything else that is not a plain 0-255.
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number.parseInt(part, 10);
    if (n > 255) return null;
    // Leading zeros are ambiguous (octal in some parsers, so "010" could mean 8).
    if (part.length > 1 && part.startsWith('0')) return null;
    octets.push(n);
  }
  return octets;
}

function inCidr(ip: number, base: number[], bits: number): boolean {
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (ip & mask) === (ipv4ToInt(base) & mask);
}

function isPrivateIpv4(value: string): boolean {
  const octets = parseIpv4(value);
  if (!octets) return false;
  const ip = ipv4ToInt(octets);
  return PRIVATE_IPV4.some((range) => inCidr(ip, range.cidr, range.bits));
}

function isPrivateIpv6(value: string): boolean {
  const host = value.toLowerCase().split('%')[0]; // drop a zone index such as %eth0

  if (host === '::1' || host === '::') return true;
  // Unique local addresses fc00::/7 and link-local fe80::/10.
  if (/^f[cd][0-9a-f]{0,2}:/.test(host)) return true;
  if (/^fe[89ab][0-9a-f]?:/.test(host)) return true;
  // IPv4-mapped (::ffff:192.168.0.1) — check the embedded address too.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(host);
  if (mapped) return isPrivateIpv4(mapped[1]);
  return false;
}

/**
 * True when `hostname` can only be reached from the local network or the local
 * machine. Accepts a bare hostname, a `host:port` pair, or a bracketed IPv6
 * host such as `[fe80::1]:3000`.
 */
export function isLocalNetworkHost(hostname: string): boolean {
  if (!hostname) return false;

  let host = hostname.trim().toLowerCase();

  // Strip a bracketed IPv6 literal and an optional port.
  const bracketed = /^\[([^\]]+)\](?::(\d+))?$/.exec(host);
  if (bracketed) {
    host = bracketed[1];
  } else {
    // Only strip a port when what follows the colon is actually numeric. A
    // looser rule would turn "http://example.com" into "http", which then looks
    // like a bare LAN hostname and would be trusted.
    const withPort = /^([^:]+):(\d+)$/.exec(host);
    if (withPort) host = withPort[1];
  }

  if (!host) return false;

  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  // mDNS, the home.arpa special-use domain, and common internal TLDs.
  if (host.endsWith('.local') || host.endsWith('.home.arpa') || host.endsWith('.internal')) return true;

  const looksLikeIpv6 = host.includes(':');
  if (looksLikeIpv6) return isPrivateIpv6(host);

  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return isPrivateIpv4(host);

  // A bare single-label hostname such as `nas`, `server`, or `tasktick` is only
  // resolvable via the local DNS suffix, never from the public internet — but
  // only if it is a syntactically valid hostname. Without this check, arbitrary
  // junk with no dot ("not a host") would be treated as a LAN name.
  if (!host.includes('.') && !host.includes(':')) return HOSTNAME_LABEL.test(host);

  return false;
}

/** True when an absolute origin URL (`https://host:port`) is private/loopback. */
export function isLocalNetworkOrigin(origin: string | null | undefined): boolean {
  if (!origin) return false;

  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }

  // Only web schemes can be produced by a browser page.
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;

  return isLocalNetworkHost(url.host);
}

/**
 * The `Origin` header of a request, normalised to a bare origin.
 *
 * Returns null for the literal string `"null"`, which browsers send for
 * sandboxed iframes and `file://` documents. Treating that as an origin would
 * make it match itself and defeat the check, so it is rejected here.
 */
export function originFromRequest(request: Request | null | undefined): string | null {
  const raw = request?.headers?.get?.('origin');
  if (!raw || raw === 'null') return null;

  try {
    return new URL(raw).origin;
  } catch {
    return null;
  }
}

/** Splits a comma-separated origin list, trimming and dropping empties. */
export function parseOriginList(value: string | null | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}
