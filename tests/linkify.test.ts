/**
 * Linkifying a description.
 *
 * The cases here are the ones the brief named, plus the safety one that matters
 * most: a hostile string must never become an anchor. `linkify` is pure, so it
 * runs in node without a renderer.
 */
import { describe, expect, it } from 'vitest';
import { linkify } from '../src/lib/linkify';

/** All hrefs the splitter produced. */
function hrefs(text: string): string[] {
  return linkify(text)
    .filter((segment): segment is Extract<ReturnType<typeof linkify>[number], { kind: 'link' }> => segment.kind === 'link')
    .map((segment) => segment.href);
}

/** All link texts the splitter produced. */
function linkTexts(text: string): string[] {
  return linkify(text)
    .filter((segment): segment is Extract<ReturnType<typeof linkify>[number], { kind: 'link' }> => segment.kind === 'link')
    .map((segment) => segment.value);
}

describe('linkify — where the URL sits', () => {
  it('links a URL at the start of the string', () => {
    expect(linkify('https://example.com is the site')).toEqual([
      { kind: 'link', value: 'https://example.com', href: 'https://example.com' },
      { kind: 'text', value: ' is the site' },
    ]);
  });

  it('links a URL mid-sentence', () => {
    expect(linkify('read https://example.com now')).toEqual([
      { kind: 'text', value: 'read ' },
      { kind: 'link', value: 'https://example.com', href: 'https://example.com' },
      { kind: 'text', value: ' now' },
    ]);
  });

  it('links a URL at the end of the string', () => {
    expect(linkify('go to https://example.com')).toEqual([
      { kind: 'text', value: 'go to ' },
      { kind: 'link', value: 'https://example.com', href: 'https://example.com' },
    ]);
  });

  it('links two URLs in a row', () => {
    expect(linkify('https://a.example https://b.example')).toEqual([
      { kind: 'link', value: 'https://a.example', href: 'https://a.example' },
      { kind: 'text', value: ' ' },
      { kind: 'link', value: 'https://b.example', href: 'https://b.example' },
    ]);
  });

  it('keeps a query string and a fragment in the link', () => {
    expect(linkify('https://example.com/path?q=one&x=2#section')).toEqual([
      {
        kind: 'link',
        value: 'https://example.com/path?q=one&x=2#section',
        href: 'https://example.com/path?q=one&x=2#section',
      },
    ]);
  });

  it('leaves a URL inside parentheses to link only the URL', () => {
    expect(linkify('(https://example.com)')).toEqual([
      { kind: 'text', value: '(' },
      { kind: 'link', value: 'https://example.com', href: 'https://example.com' },
      { kind: 'text', value: ')' },
    ]);
  });
});

describe('linkify — trailing punctuation', () => {
  it('does not make a full stop part of the link', () => {
    expect(linkify('see https://example.com.')).toEqual([
      { kind: 'text', value: 'see ' },
      { kind: 'link', value: 'https://example.com', href: 'https://example.com' },
      { kind: 'text', value: '.' },
    ]);
  });

  it('trims a comma and a semicolon too', () => {
    expect(linkTexts('a https://example.com, b https://example.org;')).toEqual([
      'https://example.com',
      'https://example.org',
    ]);
  });
});

describe('linkify — bare www hosts', () => {
  it('reads a www host as https', () => {
    expect(linkify('by www.officeholidays.com')).toEqual([
      { kind: 'text', value: 'by ' },
      { kind: 'link', value: 'www.officeholidays.com', href: 'https://www.officeholidays.com' },
    ]);
  });

  it('does not link a bare domain with no www', () => {
    expect(linkify('open report.txt or example.com')).toEqual([
      { kind: 'text', value: 'open report.txt or example.com' },
    ]);
  });
});

describe('linkify — hostile strings never become anchors', () => {
  it('leaves javascript: as plain text', () => {
    expect(linkify('javascript:alert(1)')).toEqual([
      { kind: 'text', value: 'javascript:alert(1)' },
    ]);
  });

  it('leaves a data: URL as plain text', () => {
    expect(linkify('data:text/html;base64,AAAA')).toEqual([
      { kind: 'text', value: 'data:text/html;base64,AAAA' },
    ]);
  });

  it('only ever emits http(s) hrefs, even when the text smuggles one in', () => {
    // The scheme is picked by the matcher, not by whatever the string starts
    // with, so this can only ever link the embedded https URL.
    for (const href of hrefs("javascript:fetch('https://evil.example')")) {
      expect(href.startsWith('http://') || href.startsWith('https://')).toBe(true);
      expect(href.startsWith('javascript:')).toBe(false);
    }
  });

  it('ignores an http scheme with no host', () => {
    expect(linkify('https:// is not a link')).toEqual([
      { kind: 'text', value: 'https:// is not a link' },
    ]);
  });
});

describe('linkify — no links', () => {
  it('returns one text segment for prose without a URL', () => {
    expect(linkify('just some words')).toEqual([{ kind: 'text', value: 'just some words' }]);
  });

  it('returns one empty text segment for an empty string', () => {
    expect(linkify('')).toEqual([{ kind: 'text', value: '' }]);
  });
});
