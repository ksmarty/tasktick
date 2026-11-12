/**
 * Maps links, from a pasted URL to a pin on a map.
 *
 * Three layers, each with its own failure: the parser (what a URL means, no I/O),
 * the resolver (what a short link points at, one guarded request) and the embed
 * URL (what the sheet frames). The parser is the one used everywhere — the task
 * editor, the event's location, the sheet's row — so the `!3d!4d` case is the one
 * worth pinning: it is what Google's own Share sheet produces from a phone, and
 * without it a link pasted that way is a place with no coordinates.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  googleMapsPlace,
  linkPreview,
  mapsEmbedUrl,
  needsMapResolution,
  parseLinkUrl,
} from '@/lib/links';
import { resetResolveCache, resolveShortMapsLink } from '@/server/services/link-resolve';

const SHORT = 'https://maps.app.goo.gl/GfEZMWPsWs9gcjPf9?g_st=ic';

/** What the short link redirects to, as Google answers it. */
const LONG =
  'https://www.google.com/maps/place/Eiffel+Tower/@48.8583701,2.2944813,17z/data=!4m6!3m5!1s0x0!3d48.8583701!4d2.2944813';

/**
 * A fetch that redirects the short host and answers everything else with an empty
 * 200 — a redirect loop would otherwise look like a successful resolution, since
 * the final URL is still a maps URL.
 */
function redirectingFetch(location: string | null) {
  const calls: string[] = [];
  const impl = (async (input: string | URL | Request) => {
    const href = String(input);
    calls.push(href);
    if (location && new URL(href).hostname === 'maps.app.goo.gl') {
      const headers = new Headers();
      headers.set('location', location);
      return new Response(null, { status: 302, headers });
    }
    return new Response(null, { status: 200 });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const allowAll = async () => {};

beforeEach(() => {
  resetResolveCache();
});

describe('a maps link pasted from the share sheet', () => {
  it('reads the !3d/!4d pin, which is the only coordinates a place link carries', () => {
    const preview = linkPreview(LONG);
    expect(preview?.place).toMatchObject({
      provider: 'google',
      name: 'Eiffel Tower',
      latitude: 48.8583701,
      longitude: 2.2944813,
    });
    expect(preview?.place?.shortLink).toBe(false);
  });

  it('still reads the visible @lat,lng marker when it is there', () => {
    const place = googleMapsPlace(parseLinkUrl('https://maps.google.com/maps/@51.5007,-0.1246,15z')!, false);
    expect(place.latitude).toBeCloseTo(51.5007);
    expect(place.longitude).toBeCloseTo(-0.1246);
  });

  /*
   * The blob is the pin Google marked; `q` is the text of the search that found
   * it. A place link carries both, and the pin is the one that does not move when
   * the search phrase is edited.
   */
  it('prefers the data blob over a search query when both are present', () => {
    const place = googleMapsPlace(
      parseLinkUrl('https://www.google.com/maps?q=48.8584,2.2945&data=!3d51.5007!4d-0.1246')!,
      false,
    );
    expect(place.latitude).toBeCloseTo(51.5007);
    expect(place.longitude).toBeCloseTo(-0.1246);
  });
});

describe('needsMapResolution', () => {
  it('is true only for a short link that carries no coordinates', () => {
    const short = linkPreview(SHORT);
    expect(short?.place?.shortLink).toBe(true);
    expect(short?.place?.latitude).toBeNull();
    expect(needsMapResolution(short?.place ?? null)).toBe(true);
  });

  it('is false once the coordinates are known', () => {
    expect(needsMapResolution(linkPreview(LONG)?.place ?? null)).toBe(false);
  });

  it('is false for an Apple Maps link — only Google short links are resolvable', () => {
    const apple = linkPreview('https://maps.apple.com/?ll=48.8584,2.2945&name=Eiffel+Tower');
    expect(apple?.place?.provider).toBe('apple');
    expect(needsMapResolution(apple?.place ?? null)).toBe(false);
  });
});

describe('mapsEmbedUrl', () => {
  it('is the keyless embed, so it renders without an API key', () => {
    const url = new URL(mapsEmbedUrl({ latitude: 48.8583701, longitude: 2.2944813 }) ?? '');
    expect(url.origin).toBe('https://www.google.com');
    expect(url.pathname).toBe('/maps');
    expect(url.searchParams.get('q')).toBe('48.8583701,2.2944813');
    expect(url.searchParams.get('output')).toBe('embed');
  });

  it('frames a name when that is all there is to frame', () => {
    // The sample short link resolves to a `?q=<place name>` search: no pin, but a
    // name Google's own embed accepts, so the sheet still shows the location.
    const url = new URL(mapsEmbedUrl({ name: 'Imagine Cinemas Carlton, Toronto' }) ?? '');
    expect(url.searchParams.get('q')).toBe('Imagine Cinemas Carlton, Toronto');
    expect(url.searchParams.get('output')).toBe('embed');
  });

  it('is null rather than an empty frame when there is neither', () => {
    expect(mapsEmbedUrl({})).toBeNull();
    expect(mapsEmbedUrl({ name: '   ' })).toBeNull();
    // Half a pin is not a pin: without both numbers the name is the better frame.
    expect(new URL(mapsEmbedUrl({ latitude: 48.8583701, name: 'Eiffel Tower' }) ?? '').searchParams.get('q')).toBe(
      'Eiffel Tower',
    );
  });

  it('prefers the pin over the name, so the frame centres on the place', () => {
    const url = new URL(mapsEmbedUrl({ latitude: 48.8583701, longitude: 2.2944813, name: 'Eiffel Tower' }) ?? '');
    expect(url.searchParams.get('q')).toBe('48.8583701,2.2944813');
  });
});

describe('resolveShortMapsLink', () => {
  it('follows the redirect and reads the pin out of the final URL', async () => {
    const { impl, calls } = redirectingFetch(LONG);
    const place = await resolveShortMapsLink(SHORT, { fetchImpl: impl, assertHost: allowAll });
    expect(place).toEqual({ name: 'Eiffel Tower', latitude: 48.8583701, longitude: 2.2944813 });
    // Two hops: the short link, then the long URL it points at.
    expect(calls).toHaveLength(2);
    expect(calls[1]).toBe(LONG);
  });

  it('caches, because a short link never changes', async () => {
    const { impl, calls } = redirectingFetch(LONG);
    await resolveShortMapsLink(SHORT, { fetchImpl: impl, assertHost: allowAll });
    const afterFirst = calls.length;
    await resolveShortMapsLink(SHORT, { fetchImpl: impl, assertHost: allowAll });
    expect(calls).toHaveLength(afterFirst);
  });

  it('refuses a redirect that leaves Google Maps', async () => {
    const { impl } = redirectingFetch('http://127.0.0.1:8080/secret');
    expect(await resolveShortMapsLink(SHORT, { fetchImpl: impl, assertHost: allowAll })).toBeNull();
  });

  it('refuses a URL that is not a maps link at all', async () => {
    const { impl, calls } = redirectingFetch(LONG);
    expect(await resolveShortMapsLink('https://example.com/maps', { fetchImpl: impl, assertHost: allowAll })).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('answers the name when the chain ends on a search with no pin', async () => {
    // Measured behaviour of the sample link: the chain ends at
    // `?q=Imagine+Cinemas+Carlton,...` — no `@lat,lng`, no `!3d!4d`. The name is
    // still a location, so it is the answer; discarding it left the sheet blank.
    const { impl } = redirectingFetch('https://www.google.com/maps/search/coffee');
    expect(await resolveShortMapsLink(SHORT, { fetchImpl: impl, assertHost: allowAll })).toEqual({
      name: 'coffee',
      latitude: null,
      longitude: null,
    });
  });

  it('answers null when the chain ends somewhere with no place at all', async () => {
    const { impl } = redirectingFetch('https://www.google.com/maps');
    expect(await resolveShortMapsLink(SHORT, { fetchImpl: impl, assertHost: allowAll })).toBeNull();
  });

  it('answers null rather than throwing when the host is blocked', async () => {
    const { impl } = redirectingFetch(LONG);
    const blocked = async () => {
      throw new Error('blocked-address');
    };
    expect(await resolveShortMapsLink(SHORT, { fetchImpl: impl, assertHost: blocked })).toBeNull();
  });
});
