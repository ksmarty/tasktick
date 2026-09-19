/**
 * Turning a stored URL into something a detail sheet can show.
 *
 * The task and event records both carry a free-text `url`. Rendering it raw is
 * unreadable — `https://www.google.com/maps/place/Eiffel+Tower/@48.8583701,2.2944813,17z`
 * is a long line that says nothing at a glance — so this module reduces it to a
 * readable label (host + trimmed path) and, when the URL is a maps link, parses
 * the place name and coordinates out of it.
 *
 * ## What is parsed, and what is not
 *
 * The *long* forms carry their data in the path and query string, so they are
 * parsed locally with no network call:
 *
 *  - Google: `/maps/place/<Name>/@lat,lng`, `/maps/search/<query>`, `?q=`,
 *    `?ll=`, `?center=`, and the `@lat,lng` fragment.
 *  - Apple: `/place?...&name=&ll=`, and `?q=` / `?address=` / `?ll=`.
 *
 * The *short* forms — `maps.app.goo.gl/<id>` and `goo.gl/maps/<id>` — are
 * redirects. The id is opaque, so the only way to learn the place is to follow
 * the redirect, which means the server fetching a URL the user supplied. That is
 * the same class of request `ical-fetch.ts` guards so carefully (scheme, DNS
 * resolution, private-address refusal, hand-followed redirects), and it is a
 * network call, not a parse. It is deliberately **not** done here: the short link
 * is still shown and still opens (the plain `https://` URL is a universal link,
 * which iOS hands to the installed app and falls back to the web otherwise), it
 * simply has no parsed place beside it. See the report.
 *
 * Nothing in this module performs I/O; every function is pure.
 */

export type MapsProvider = 'google' | 'apple';

export interface MapsPlace {
  provider: MapsProvider;
  /** The place name parsed from the long URL, when it carries one. */
  name: string | null;
  latitude: number | null;
  longitude: number | null;
  /** True for the redirect/short forms, which carry no readable place. */
  shortLink: boolean;
}

export interface LinkPreview {
  /** The http(s) URL to open. Always the stored https form. */
  href: string;
  /** Readable text: the parsed place name, else host + trimmed path. */
  display: string;
  /** The parsed place, only for a maps link. */
  place: MapsPlace | null;
}

/**
 * Parse a user-stored URL.
 *
 * A bare host (`example.com/x`) is accepted and read as `https://`: the field
 * the user typed into says `https://…`, but nothing stops them omitting it, and
 * refusing to preview an otherwise fine link would be pedantic. Non-http(s)
 * schemes are refused so a `javascript:` or `data:` value can never become an
 * `href`.
 */
export function parseLinkUrl(input: string): URL | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    try {
      url = new URL(`https://${trimmed}`);
    } catch {
      return null;
    }
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (!url.hostname) return null;
  // Credentials would be shown in the address bar and are not a preview.
  if (url.username || url.password) return null;
  return url;
}

/** Host without a leading `www.`. */
function bareHost(url: URL): string {
  return url.hostname.toLowerCase().replace(/^www\./, '');
}

function isGoogleMapsHost(url: URL): boolean {
  const host = bareHost(url);
  if (host === 'maps.app.goo.gl') return true;
  if (host === 'maps.google.com') return true;
  if (host === 'goo.gl') return /^\/maps(?:\/|$)/i.test(url.pathname);
  // google.<tld> only counts when the path is the maps app, so a plain
  // google.com search link is not mistaken for a place.
  if (/^google\.[a-z.]+$/.test(host)) return /^\/maps(?:\/|$)/i.test(url.pathname);
  return false;
}

function isAppleMapsHost(url: URL): boolean {
  const host = bareHost(url);
  if (host === 'maps.apple.com') return true;
  if (host === 'apple.co') return /^\/maps(?:\/|$)/i.test(url.pathname);
  return false;
}

/**
 * True when a string is explicitly an http(s) URL.
 *
 * Stricter than `parseLinkUrl` on purpose: a location of "Paris" would parse as
 * the host `paris`, but it is a place name, not a link, and must stay text.
 */
export function isHttpUrl(input: string): boolean {
  return /^https?:\/\//i.test(input.trim());
}

/** True when the URL names Google Maps or Apple Maps. */
export function isMapsUrl(input: string): boolean {
  const url = parseLinkUrl(input);
  if (!url) return false;
  return isGoogleMapsHost(url) || isAppleMapsHost(url);
}

/** `lat,lng` with both numbers in range. */
function parseCoordinates(text: string | null | undefined): { lat: number; lng: number } | null {
  if (!text) return null;
  const match = text.trim().match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
  if (!match) return null;
  const lat = Number(match[1]);
  const lng = Number(match[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

/** A path segment read back as a human label. */
function decodeSegment(segment: string): string | null {
  let decoded = segment;
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    // A malformed percent-escape is left as it came rather than throwing.
  }
  const text = decoded.replace(/\+/g, ' ').trim();
  return text || null;
}

function googleMapsPlace(url: URL, shortLink: boolean): MapsPlace {
  let name: string | null = null;
  let coords: { lat: number; lng: number } | null = null;

  const placeMatch = url.pathname.match(/\/maps\/place\/([^/]+)/i);
  if (placeMatch) name = decodeSegment(placeMatch[1]);

  if (!name) {
    const searchMatch = url.pathname.match(/\/maps\/search\/([^/]+)/i);
    if (searchMatch) name = decodeSegment(searchMatch[1]);
  }

  // The `@lat,lng,zoom` marker sits in the path or the hash depending on the
  // share sheet that produced the link.
  const atMatch = `${url.pathname}${url.hash}`.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  if (atMatch) coords = parseCoordinates(`${atMatch[1]},${atMatch[2]}`);

  const query = url.searchParams.get('q') ?? url.searchParams.get('query');
  if (query) {
    const fromQuery = parseCoordinates(query);
    if (fromQuery) coords ??= fromQuery;
    else if (!name) name = query.trim() || null;
  }

  const center = url.searchParams.get('ll') ?? url.searchParams.get('center');
  if (center) coords ??= parseCoordinates(center);

  return {
    provider: 'google',
    name,
    latitude: coords?.lat ?? null,
    longitude: coords?.lng ?? null,
    shortLink,
  };
}

function appleMapsPlace(url: URL): MapsPlace {
  let name = url.searchParams.get('name') ?? url.searchParams.get('q') ?? url.searchParams.get('address');
  let coords =
    parseCoordinates(url.searchParams.get('ll')) ??
    parseCoordinates(url.searchParams.get('sll')) ??
    parseCoordinates(url.searchParams.get('coordinate')) ??
    parseCoordinates(url.searchParams.get('center'));

  if (name) {
    const asCoords = parseCoordinates(name);
    if (asCoords) {
      coords ??= asCoords;
      name = null;
    }
  }

  const trimmed = name?.trim() || null;
  return {
    provider: 'apple',
    name: trimmed,
    latitude: coords?.lat ?? null,
    longitude: coords?.lng ?? null,
    shortLink: false,
  };
}

function parseMapsPlace(url: URL): MapsPlace | null {
  if (isGoogleMapsHost(url)) {
    const host = bareHost(url);
    const shortLink = host === 'maps.app.goo.gl' || (host === 'goo.gl' && /^\/maps\//i.test(url.pathname));
    return googleMapsPlace(url, shortLink);
  }
  if (isAppleMapsHost(url)) return appleMapsPlace(url);
  return null;
}

/**
 * A readable label for a URL: `host/path`, with `www.` dropped and the path's
 * trailing slash trimmed. The query is intentionally left off — the path is
 * what identifies the page, and a tracking-laden query would defeat the point.
 */
export function describeLink(input: string): string | null {
  const url = parseLinkUrl(input);
  if (!url) return null;
  const host = bareHost(url);
  const path = url.pathname.replace(/\/+$/, '');
  const label = path && path !== '/' ? `${host}${path}` : host;
  return label.length > 56 ? `${label.slice(0, 55)}…` : label;
}

/**
 * Everything a detail sheet needs to render a URL, or `null` when the value is
 * not a usable http(s) link.
 */
export function linkPreview(input: string): LinkPreview | null {
  const url = parseLinkUrl(input);
  if (!url) return null;
  const place = parseMapsPlace(url);
  return {
    href: url.toString(),
    display: place?.name ?? describeLink(input) ?? url.toString(),
    place,
  };
}
