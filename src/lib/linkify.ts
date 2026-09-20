/**
 * Splitting a free-text description into text and link segments.
 *
 * A calendar event's `description` is free text a user typed (or a feed
 * supplied) and it routinely carries a URL. Rendered as a single string the URL
 * is dead text, so this module finds the URLs in it and hands back segments the
 * sheet can render as real anchors.
 *
 * ## What is matched, and why so little
 *
 * The matcher accepts exactly two shapes: an explicit `http://` / `https://`
 * URL, and a bare `www.` host (read as `https://`). Bare domains are
 * deliberately **not** matched. A false positive that turns "the file is
 * report.txt" into a link is worse than a missed link, and a bare word with a
 * dot is far too common in prose; `www.` is a strong enough signal to be worth
 * the few extra links.
 *
 * ## Safety
 *
 * The href is built from the prefix the matcher itself recognised, never from
 * `new URL(candidate).protocol` — so the scheme is always one of `http`,
 * `https`. A `javascript:` or `data:` string can never become an anchor: it is
 * not a candidate at all, and it stays in the surrounding text run.
 *
 * Punctuation a sentence glues onto the end of a URL (`see https://example.com.`)
 * is trimmed off the match and left in the following text segment, and brackets
 * are excluded from the URL body so `(https://example.com)` links only the URL.
 *
 * Every function here is pure; nothing performs I/O.
 */

/** One piece of a description: literal text, or a URL worth an anchor. */
export type LinkifySegment =
  | { kind: 'text'; value: string }
  | { kind: 'link'; value: string; href: string };

/**
 * A URL candidate: the two schemes, then everything up to whitespace or a
 * character that ends a URL in running prose. `(`/`)` and the other brackets
 * are excluded so a URL wrapped in parentheses does not swallow them.
 */
const CANDIDATE = /\b(?:https?:\/\/|www\.)[^\s<>"'`()[\]{}]+/gi;

/** Sentence punctuation that may be glued to a URL's tail. */
const TRAILING_PUNCTUATION = /[.,;:!?]+$/;

/**
 * The absolute href for a candidate, or `null` when it is not a usable URL.
 *
 * The scheme is chosen here, from the prefix the matcher recognised — this is
 * what keeps a hostile string from deciding its own protocol.
 */
function toHref(candidate: string): string | null {
  if (/^https?:\/\//i.test(candidate)) {
    return /^https?:\/\/[^\s/?#]+/i.test(candidate) ? candidate : null;
  }
  if (/^www\./i.test(candidate)) {
    return /^www\.[^\s/?#]+/i.test(candidate) ? `https://${candidate}` : null;
  }
  return null;
}

/**
 * Split `text` into segments. Text without a usable URL comes back as a single
 * `text` segment, so a caller can render it without special-casing.
 */
export function linkify(text: string): LinkifySegment[] {
  const segments: LinkifySegment[] = [];
  let cursor = 0;

  for (const match of text.matchAll(CANDIDATE)) {
    const start = match.index ?? 0;
    const value = match[0].replace(TRAILING_PUNCTUATION, '');
    const href = toHref(value);
    // Not a real URL (e.g. `https://` with no host): leave it in the text run.
    if (href === null) continue;
    if (start > cursor) segments.push({ kind: 'text', value: text.slice(cursor, start) });
    segments.push({ kind: 'link', value, href });
    cursor = start + value.length;
  }

  if (cursor < text.length) segments.push({ kind: 'text', value: text.slice(cursor) });
  if (segments.length === 0) segments.push({ kind: 'text', value: text });
  return segments;
}
