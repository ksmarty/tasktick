import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildAdvertisement, MDNS_FQDN, MDNS_SERVICE_TYPE } from '@/server/mdns';

const base = {
  appUrl: 'https://tasks.notato.xyz',
  version: '0.41.1',
  hostname: 'tasktick-box',
  appUrlIsDefault: false,
};

describe('mDNS advertisement', () => {
  it('carries the browsable origin in TXT, not the host the process runs on', () => {
    const advertisement = buildAdvertisement(base);

    // The whole point: behind a reverse proxy the container's own address is
    // wrong, so the integration has to be handed the address the user browses to.
    expect(advertisement?.txt.url).toBe('https://tasks.notato.xyz');
    expect(advertisement?.host).toBe('tasktick-box');
    expect(advertisement?.txt.url).not.toContain('tasktick-box');
  });

  it('derives the port from the origin, defaulting per scheme', () => {
    expect(buildAdvertisement({ ...base, appUrl: 'https://tasks.example.com' })?.port).toBe(443);
    expect(buildAdvertisement({ ...base, appUrl: 'http://tasks.example.com' })?.port).toBe(80);
    expect(buildAdvertisement({ ...base, appUrl: 'http://192.168.1.9:8080' })?.port).toBe(8080);
  });

  it('publishes the graphql path so the integration does not hardcode it', () => {
    expect(buildAdvertisement(base)?.txt.path).toBe('/api/graphql');
  });

  it('refuses to advertise the default APP_URL', () => {
    expect(buildAdvertisement({ ...base, appUrl: 'http://localhost:3000', appUrlIsDefault: true })).toBeNull();
  });

  it('refuses localhost even when it was set explicitly', () => {
    // Reachable from the Home Assistant host and nowhere else, which is no more
    // useful than the default it would have been derived from.
    expect(buildAdvertisement({ ...base, appUrl: 'http://localhost:3000' })).toBeNull();
    expect(buildAdvertisement({ ...base, appUrl: 'http://127.0.0.1:3000' })).toBeNull();
  });

  it('refuses a URL it cannot parse rather than publishing nonsense', () => {
    expect(buildAdvertisement({ ...base, appUrl: 'not a url' })).toBeNull();
  });

  it('keeps its service type in step with the integration manifest', () => {
    // The two halves of discovery live in different languages and different
    // directories, so the only thing that can catch them drifting apart is a
    // check that reads both. Without it the advertisement is published and
    // silently never matched.
    const manifest = JSON.parse(
      readFileSync(new URL('../integrations/home-assistant/custom_components/tasktick/manifest.json', import.meta.url), 'utf8'),
    ) as { zeroconf?: string[] };

    expect(manifest.zeroconf).toEqual([MDNS_FQDN]);
    expect(MDNS_FQDN).toBe(`_${MDNS_SERVICE_TYPE}._tcp.local.`);
  });
});
