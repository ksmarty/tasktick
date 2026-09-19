/**
 * The guard that stops a subscription from being used to reach the server's own
 * network.
 *
 * A self-hosted app is usually behind a router, next to a NAS, and may be on a
 * cloud host where `169.254.169.254` hands out credentials. A feature that
 * fetches any URL a user types turns "add a calendar" into "make the server read
 * an internal endpoint and show me the response". These tests pin the check that
 * prevents it, because the failure mode is silent: everything still works, the
 * user just gets somebody else's data.
 */
import { describe, expect, it } from 'vitest';
import {
  FeedError,
  assertPublicHost,
  fetchFeed,
  isBlockedAddress,
  parseFeedUrl,
} from '@/server/services/ical-fetch';

describe('parseFeedUrl', () => {
  it('accepts http and https', () => {
    expect(parseFeedUrl('https://example.com/cal.ics').hostname).toBe('example.com');
    expect(parseFeedUrl('http://example.com/cal.ics').protocol).toBe('http:');
  });

  it('rewrites webcal to https, because that is what calendars hand out', () => {
    // Every calendar app offers a `webcal://` link for subscriptions and it is
    // not a real scheme — it means "fetch this over HTTP".
    expect(parseFeedUrl('webcal://example.com/cal.ics').protocol).toBe('https:');
    expect(parseFeedUrl('webcals://example.com/cal.ics').protocol).toBe('https:');
  });

  it('refuses other schemes', () => {
    for (const bad of ['file:///etc/passwd', 'gopher://example.com', 'data:text/plain,hi']) {
      expect(() => parseFeedUrl(bad)).toThrow(FeedError);
    }
  });

  it('refuses credentials embedded in the URL', () => {
    // They would be echoed back to the client and written into logs.
    expect(() => parseFeedUrl('https://user:pass@example.com/cal.ics')).toThrow(FeedError);
  });

  it('refuses an empty or hostless URL', () => {
    expect(() => parseFeedUrl('   ')).toThrow(FeedError);
    expect(() => parseFeedUrl('https://')).toThrow(FeedError);
  });
});

describe('isBlockedAddress', () => {
  it('blocks loopback, private, link-local and metadata addresses', () => {
    const blocked = [
      '127.0.0.1',
      '127.1.2.3',
      '10.0.0.1',
      '172.16.0.1',
      '172.31.255.255',
      '192.168.1.1',
      '169.254.169.254', // cloud metadata
      '100.64.0.1', // CGNAT
      '0.0.0.0',
      '224.0.0.1',
      '255.255.255.255',
    ];
    for (const address of blocked) {
      expect(isBlockedAddress(address), address).toBe(true);
    }
  });

  it('allows ordinary public addresses', () => {
    for (const address of ['1.1.1.1', '8.8.8.8', '172.32.0.1', '192.169.0.1', '100.128.0.1']) {
      expect(isBlockedAddress(address), address).toBe(false);
    }
  });

  it('blocks IPv6 loopback, link-local and unique-local', () => {
    for (const address of ['::1', '::', 'fe80::1', 'fc00::1', 'fd12:3456::1', 'ff02::1']) {
      expect(isBlockedAddress(address), address).toBe(true);
    }
  });

  it('blocks an IPv4 target hidden inside an IPv6 address', () => {
    // The classic way an IPv6-only check leaks: `::ffff:127.0.0.1` is loopback
    // wearing a different hat.
    expect(isBlockedAddress('::ffff:127.0.0.1')).toBe(true);
    expect(isBlockedAddress('::ffff:169.254.169.254')).toBe(true);
    expect(isBlockedAddress('::ffff:10.0.0.1')).toBe(true);
    expect(isBlockedAddress('::ffff:8.8.8.8')).toBe(false);
  });

  it('treats anything that is not an address as blocked', () => {
    // A hostname reaching this function means a caller forgot to resolve it.
    // Failing closed is the only safe answer.
    expect(isBlockedAddress('example.com')).toBe(true);
    expect(isBlockedAddress('')).toBe(true);
  });
});

describe('assertPublicHost', () => {
  it('rejects an IP literal in a private range without a lookup', async () => {
    await expect(assertPublicHost('127.0.0.1')).rejects.toThrow(FeedError);
    await expect(assertPublicHost('169.254.169.254')).rejects.toThrow(FeedError);
    await expect(assertPublicHost('::1')).rejects.toThrow(FeedError);
  });

  it('resolves a hostname and rejects it when it maps inward', async () => {
    // `localhost` is the canonical case: harmless-looking text, loopback in fact.
    await expect(assertPublicHost('localhost')).rejects.toThrow(FeedError);
  });
});

describe('fetchFeed', () => {
  it('refuses to fetch a private address even when handed a stub fetch', async () => {
    // The point: the guard runs before the request is made, so it cannot be
    // bypassed by a fetch implementation that would happily follow it.
    let called = false;
    const stub = (async () => {
      called = true;
      return new Response('BEGIN:VCALENDAR\nEND:VCALENDAR', { status: 200 });
    }) as unknown as typeof fetch;

    await expect(fetchFeed('http://127.0.0.1:8080/cal.ics', null, { fetchImpl: stub })).rejects.toThrow(
      FeedError,
    );
    expect(called).toBe(false);
  });

  it('re-checks the address on every redirect hop', async () => {
    // A public URL that redirects inward is the standard bypass; the hop must be
    // checked, not just the URL the user typed.
    let calls = 0;
    const stub = (async () => {
      calls += 1;
      return new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/' } });
    }) as unknown as typeof fetch;

    await expect(
      fetchFeed('https://1.1.1.1/cal.ics', null, { fetchImpl: stub }),
    ).rejects.toMatchObject({ code: 'blocked-address' });
    expect(calls).toBe(1);
  });

  it('returns the body and etag for a good response', async () => {
    const body = 'BEGIN:VCALENDAR\nVERSION:2.0\nEND:VCALENDAR';
    const stub = (async () =>
      new Response(body, { status: 200, headers: { etag: '"abc"' } })) as unknown as typeof fetch;

    const feed = await fetchFeed('https://1.1.1.1/cal.ics', null, { fetchImpl: stub });
    expect(feed.body).toBe(body);
    expect(feed.etag).toBe('"abc"');
    expect(feed.notModified).toBe(false);
  });

  it('reports a 304 as not modified, which is what makes polling cheap', async () => {
    const stub = (async () => new Response(null, { status: 304 })) as unknown as typeof fetch;
    const feed = await fetchFeed('https://1.1.1.1/cal.ics', '"abc"', { fetchImpl: stub });
    expect(feed.notModified).toBe(true);
  });

  it('sends the etag only on the first hop', async () => {
    const seen: (string | null)[] = [];
    const stub = (async (_url: string, init: RequestInit) => {
      seen.push(new Headers(init.headers).get('if-none-match'));
      return new Response(null, { status: 302, headers: { location: 'https://1.1.1.1/next.ics' } });
    }) as unknown as typeof fetch;

    await fetchFeed('https://1.1.1.1/cal.ics', '"abc"', { fetchImpl: stub }).catch(() => undefined);
    expect(seen[0]).toBe('"abc"');
    expect(seen[1]).toBeNull();
  });

  it('refuses a response larger than the cap', async () => {
    const huge = 'x'.repeat(9 * 1024 * 1024);
    const stub = (async () => new Response(huge, { status: 200 })) as unknown as typeof fetch;
    await expect(fetchFeed('https://1.1.1.1/cal.ics', null, { fetchImpl: stub })).rejects.toMatchObject({
      code: 'too-large',
    });
  });

  it('gives up after too many redirects', async () => {
    let n = 0;
    const stub = (async () => {
      n += 1;
      return new Response(null, { status: 302, headers: { location: `https://1.1.1.1/hop${n}.ics` } });
    }) as unknown as typeof fetch;
    await expect(fetchFeed('https://1.1.1.1/cal.ics', null, { fetchImpl: stub })).rejects.toMatchObject({
      code: 'too-many-redirects',
    });
  });

  it('surfaces an http error rather than an empty calendar', async () => {
    const stub = (async () => new Response('nope', { status: 404 })) as unknown as typeof fetch;
    await expect(fetchFeed('https://1.1.1.1/cal.ics', null, { fetchImpl: stub })).rejects.toMatchObject({
      code: 'http-error',
    });
  });
});
