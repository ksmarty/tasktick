/**
 * Pure helpers for `check-sw-version.mjs`, split out so they can be tested.
 *
 * They live here rather than inside the script because that script shells out to
 * git at import time — a test importing it would run git in whatever repository
 * happened to be around. The parsing below is the part worth pinning.
 */

/** Reads the `VERSION` constant out of a service worker's source. */
export function readSwVersion(text) {
  const match = text.match(/const VERSION = '([^']+)'/);
  if (!match) throw new Error('no VERSION constant in public/sw.js');
  return match[1];
}

/**
 * The paths `git status --porcelain` reports, as plain paths.
 *
 * Porcelain's first two columns are status codes, so a path starts at index 3 —
 * and the leading space of the FIRST line is part of that format. Trimming the
 * output as a whole before splitting drops that space and shifts the first line
 * one column left, so ` M public/sw.js` parses as `ublic/sw.js`.
 *
 * That is not a cosmetic bug. `public/sw.js` sorts before `scripts/` and `src/`,
 * so when it is modified it is almost always the *first* line of the porcelain
 * output — meaning the one file this check exists to guard was the one file it
 * could not see. The check then refused every release with a working tree
 * ("public/sw.js did not change") while still passing in CI, where the tree is
 * clean and only the committed diff is compared.
 */
export function parsePorcelain(text) {
  return text
    .split('\n')
    .map((line) => line.slice(3).trim())
    .filter(Boolean);
}
