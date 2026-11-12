/**
 * Turns a short maps link into a place.
 *
 * `https://maps.app.goo.gl/GfEZMWPsWs9gcjPf9` is what Google's Share button
 * produces, and by itself it says nothing: the id resolves, on a real request,
 * to a long `/maps/place/…/data=!3d…!4d…` URL that carries the coordinates — or,
 * just as often, to a `?q=<place name>` search that carries a name and no pin. The
 * client cannot ask for that URL — a cross-origin redirect is opaque to `fetch`
 * and would be blocked as CORS anyway — so the server does it, and only ever
 * reads the `Location` header.
 *
 * ## Why this is not a generic "fetch this URL" endpoint
 *
 * It is a fetch of a URL the user supplied, which is exactly the class of
 * request `ical-fetch.ts` guards, and it reuses that guard rather than copying
 * it: `parseFeedUrl` refuses anything that is not http(s) with no credentials,
 * `assertPublicHost` resolves the name and refuses private/loopback/link-local
 * addresses per hop, redirects are followed by hand so each hop is checked, and
 * the **final** URL must still be a Google Maps URL. That last check is what
 * keeps the endpoint from becoming a reader for arbitrary hosts: if a short
 * link were to be redirected somewhere else entirely, nothing is returned.
 *
 * ## Why the answer is cached
 *
 * A short link never changes — the id is the mapping. One hour in a small
 * in-process map means a sheet reopened a dozen times costs one outbound request
 * rather than twelve, and the cache is per process because the value is derived
 * from a third party, not from anything this app owns.
 */
import { isGoogleMapsHost, googleMapsPlace, parseLinkUrl } from '@/lib/links';
import { assertPublicHost, parseFeedUrl } from './ical-fetch';

/** Five seconds: a redirect chain is two or three hops of a HEAD-sized answer. */
const RESOLVE_TIMEOUT_MS = 5_000;

/*
 * Six, not three: the measured chain from a share-sheet link is
 * `maps.app.goo.gl` -> `maps.google.com?q=…` -> `maps.google.com/maps?q=…` ->
 * `www.google.com/maps?q=…` -> 200, and stopping early threw away an answer that
 * was one hop away. The hop count is a bound on work, not a safety setting — the
 * host guard runs per hop and the final URL is checked either way.
 */
const MAX_HOPS = 6;

const CACHE_TTL_MS = 60 * 60 * 1000;
const CACHE_LIMIT = 500;

/**
 * What a short link turned out to be.
 *
 * A shared place link is not always a pin. The sample this feature was built
 * against resolves to `?q=Imagine+Cinemas+Carlton,+20+Carlton+St.,+Toronto` — a
 * *search*, with no `@lat,lng` and no `!3d!4d` — so the strongest answer the
 * chain can give is the place's name. Returning `null` there would have been
 * technically true (no coordinates) and useless (the name was right in the URL).
 * Either field may stand alone; both `null` means nothing was found.
 */
export interface ResolvedPlace {
  name: string | null;
  latitude: number | null;
  longitude: number | null;
}

interface CacheEntry {
  at: number;
  value: ResolvedPlace;
}

/*
 * Only successes are cached. A failure is usually about this moment — a link
 * checked while the operator's link was down, a DNS blip — and remembering it for
 * an hour would turn one bad second into a permanently unmapped row. A short link
 * that resolves resolves the same way forever, which is what makes the entry safe.
 */
const cache = new Map<string, CacheEntry>();

function cached(key: string): { hit: true; value: ResolvedPlace } | { hit: false } {
  const entry = cache.get(key);
  if (!entry) return { hit: false };
  if (Date.now() - entry.at > CACHE_TTL_MS) {
    cache.delete(key);
    return { hit: false };
  }
  return { hit: true, value: entry.value };
}

function remember(key: string, value: ResolvedPlace): void {
  if (cache.size >= CACHE_LIMIT) {
    // Oldest insertion first: `Map` keeps that order and the values are alike.
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }
  cache.set(key, { at: Date.now(), value });
}

/**
 * The place a short maps link points at, or `null` when it points nowhere usable.
 *
 * The answer may be a name without a pin: an ordinary `/maps/place/Name` link
 * with no `!3d!4d` blob and no `@lat,lng` is a search, and Google's keyless embed
 * frames a name as readily as a coordinate (see `mapsEmbedUrl`).
 *
 * `null` is not an error:
 * A short link that cannot be resolved (offline, refused, redirected off Google)
 * is also `null` — the row keeps being a link, which is the safe failure.
 */
export async function resolveShortMapsLink(
  rawUrl: string,
  deps: { fetchImpl?: typeof fetch; assertHost?: (hostname: string) => Promise<void> } = {},
): Promise<ResolvedPlace | null> {
  let start: URL;
  try {
    start = parseFeedUrl(rawUrl);
  } catch {
    return null;
  }
  if (!isGoogleMapsHost(start)) return null;

  const key = start.toString();
  const known = cached(key);
  if (known.hit) return known.value;

  const doFetch = deps.fetchImpl ?? fetch;
  // Injected so a test can resolve a fake host without asking real DNS whether
  // `maps.app.goo.gl` exists.
  const assertHost = deps.assertHost ?? assertPublicHost;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), RESOLVE_TIMEOUT_MS);

  let current = start;
  let value: ResolvedPlace | null = null;
  try {
    for (let hop = 0; hop < MAX_HOPS; hop += 1) {
      await assertHost(current.hostname);
      const response = await doFetch(current.toString(), {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          // A phone browser's own UA: the short-link service answers differently
          // to a client it does not recognise, and a bot UA gets a consent page.
          'User-Agent':
            'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
          Accept: 'text/html',
        },
      });

      // The body is never read: the coordinates are in the URL, and a maps page
      // is megabytes of script. Cancelling releases the socket.
      try {
        await response.body?.cancel();
      } catch {
        // Already consumed or unsupported — nothing to release.
      }

      const location = response.headers.get('location');
      if (response.status >= 300 && response.status < 400 && location) {
        const next = new URL(location, current);
        if (next.protocol !== 'http:' && next.protocol !== 'https:') break;
        if (next.username || next.password) break;
        current = next;
        continue;
      }
      break;
    }

    // The final destination must still be Google Maps: a short link that ends
    // anywhere else is not a place, and this is what keeps the endpoint from
    // being a way to read an arbitrary host through a redirect.
    const finalUrl = parseLinkUrl(current.toString());
    if (!finalUrl || !isGoogleMapsHost(finalUrl)) return null;

    const place = googleMapsPlace(finalUrl, false);
    const name = place.name?.trim() || null;
    // Coordinates first — a pin beats a name — then the name alone. Nothing at
    // all means the chain ended somewhere we cannot frame.
    value =
      place.latitude !== null && place.longitude !== null
        ? { name, latitude: place.latitude, longitude: place.longitude }
        : name
          ? { name, latitude: null, longitude: null }
          : null;
    if (!value) return null;
  } catch {
    // Network, DNS, blocked address, timeout: all the same answer to the client.
    return null;
  } finally {
    clearTimeout(timeout);
  }

  if (value) remember(key, value);
  return value;
}

/** Empties the cache. For tests: the map outlives a single case on purpose. */
export function resetResolveCache(): void {
  cache.clear();
}
