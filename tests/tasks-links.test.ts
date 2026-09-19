/**
 * Link and place previews in the shared detail sheet.
 *
 * The parser is pure, so it is tested directly; the sheet is a client component
 * that cannot be rendered in node, so its preview contract is pinned from
 * source. The pins stand for behaviours asked for explicitly and otherwise
 * silently regressible:
 *
 *  - a long Google/Apple Maps link yields a place name and coordinates parsed
 *    locally, with no network call;
 *  - a short `maps.app.goo.gl` link is recognised but carries no place — it
 *    still renders and still opens;
 *  - the anchor uses the plain `https://` URL (the universal-link form) and
 *    never an invented app scheme that fails silently when the app is absent.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { describeLink, isHttpUrl, isMapsUrl, linkPreview, parseLinkUrl } from '@/lib/links';

function source(relative: string): string {
  return readFileSync(new URL(`../src/components/tasks/${relative}`, import.meta.url), 'utf8');
}

const DETAIL = source('ItemDetailSheet.tsx');

describe('parseLinkUrl', () => {
  it('accepts http(s) and a bare host, and rejects other schemes', () => {
    expect(parseLinkUrl('https://example.com/a')?.hostname).toBe('example.com');
    expect(parseLinkUrl('example.com/a')?.href).toBe('https://example.com/a');
    expect(parseLinkUrl('javascript:alert(1)')).toBeNull();
    expect(parseLinkUrl('data:text/html,hi')).toBeNull();
    expect(parseLinkUrl('   ')).toBeNull();
  });

  it('drops credentials', () => {
    expect(parseLinkUrl('https://user:pass@example.com/')).toBeNull();
  });
});

describe('isHttpUrl — a place name is not a link', () => {
  it('only accepts an explicit scheme', () => {
    expect(isHttpUrl('https://maps.apple.com/?q=Paris')).toBe(true);
    expect(isHttpUrl('Paris')).toBe(false);
    expect(isHttpUrl('123 Main St')).toBe(false);
  });
});

describe('long Google Maps links parse locally', () => {
  it('reads the place name and the @lat,lng marker', () => {
    const preview = linkPreview(
      'https://www.google.com/maps/place/Eiffel+Tower/@48.8583701,2.2944813,17z/data=!3m1',
    );
    expect(preview?.place).toMatchObject({
      provider: 'google',
      name: 'Eiffel Tower',
      latitude: 48.8583701,
      longitude: 2.2944813,
      shortLink: false,
    });
    // The place name leads the readable display.
    expect(preview?.display).toBe('Eiffel Tower');
  });

  it('reads a coordinate query and a plain-name query', () => {
    expect(linkPreview('https://maps.google.com/?q=48.8583701,2.2944813')?.place).toMatchObject({
      latitude: 48.8583701,
      longitude: 2.2944813,
    });
    expect(linkPreview('https://www.google.com/maps?q=Central+Park')?.place?.name).toBe('Central Park');
  });

  it('reads a name from the search path', () => {
    expect(linkPreview('https://www.google.com/maps/search/Big+Ben')?.place?.name).toBe('Big Ben');
  });

  it('does not mistake a non-maps google link for a place', () => {
    expect(isMapsUrl('https://www.google.com/search?q=maps')).toBe(false);
    expect(linkPreview('https://www.google.com/search?q=maps')?.place).toBeNull();
  });
});

describe('Apple Maps links parse locally', () => {
  it('reads q and ll', () => {
    const preview = linkPreview('https://maps.apple.com/?q=Golden+Gate+Bridge&ll=37.8199,-122.4783');
    expect(preview?.place).toMatchObject({
      provider: 'apple',
      name: 'Golden Gate Bridge',
      latitude: 37.8199,
      longitude: -122.4783,
    });
  });

  it('treats a coordinate-only q as coordinates, not a name', () => {
    expect(linkPreview('https://maps.apple.com/?q=37.8199,-122.4783')?.place).toMatchObject({
      name: null,
      latitude: 37.8199,
      longitude: -122.4783,
    });
  });
});

describe('short maps links', () => {
  const short = 'https://maps.app.goo.gl/3fqXTtXXZAGsKeDq6?g_st=ic';

  it('are recognised as maps links', () => {
    expect(isMapsUrl(short)).toBe(true);
  });

  it('carry no readable place, so none is invented', () => {
    const preview = linkPreview(short);
    expect(preview?.place).toMatchObject({ provider: 'google', name: null, shortLink: true });
    expect(preview?.place?.latitude).toBeNull();
    // Readable display falls back to host + path, query dropped.
    expect(preview?.display).toBe('maps.app.goo.gl/3fqXTtXXZAGsKeDq6');
    // And the link still opens — href is the original https URL.
    expect(preview?.href).toContain('https://maps.app.goo.gl/3fqXTtXXZAGsKeDq6');
  });
});

describe('describeLink', () => {
  it('renders host + trimmed path and drops the query', () => {
    expect(describeLink('https://www.example.com/a/b/?utm=1')).toBe('example.com/a/b');
  });

  it('keeps a bare host bare', () => {
    expect(describeLink('https://example.com/')).toBe('example.com');
  });

  it('is null for a value that is not a link', () => {
    expect(describeLink('not a url')).toBeNull();
  });
});

describe('ItemDetailSheet renders the preview', () => {
  it('imports the parser and uses a real anchor', () => {
    expect(DETAIL).toContain("from '@/lib/links'");
    expect(DETAIL).toContain('linkPreview(url)');
    expect(DETAIL).toContain('href={href}');
    expect(DETAIL).toContain('target="_blank"');
    expect(DETAIL).toContain('rel="noopener noreferrer"');
  });

  it('labels a parsed place and a plain link', () => {
    expect(DETAIL).toContain("'Place'");
    expect(DETAIL).toContain("'Link'");
    expect(DETAIL).toContain('coordinates');
  });

  it('previews both a task url and an event url, and a url in the location', () => {
    expect(DETAIL).toContain('{task.url ? <LinkField url={task.url} /> : null}');
    expect(DETAIL).toContain('{event.url ? <LinkField url={event.url} /> : null}');
    expect(DETAIL).toContain('<LinkField url={event.location} />');
    // A place-name location stays plain text.
    expect(DETAIL).toContain('label="Location"');
  });

  it('never invents an app scheme for maps', () => {
    // https is the universal link: iOS routes it to the app, everything else to
    // the web. A custom scheme would fail silently with no app installed.
    expect(DETAIL).not.toContain('comgooglemaps');
    expect(DETAIL).not.toContain('maps://');
  });
});
