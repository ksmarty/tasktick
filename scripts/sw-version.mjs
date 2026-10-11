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

/**
 * The subset of changed paths that ships to a browser: the worker's own
 * directory, the client source, and the manifest that names the version.
 *
 * `check-sw-version.mjs` refuses a release whose app changed without the worker
 * moving, because a byte-identical `public/sw.js` is never installed. What it
 * must *not* refuse is a release that changed nothing a browser runs — a README
 * edit, a workflow tweak, a new test. Comparing every changed path against the
 * worker's absence made those pushes fail CI and, once version bumps became
 * automatic (one release per push to main), would have made a pointless worker
 * bump mandatory on every documentation change.
 *
 * A staged rename arrives as one entry, `old -> new` (see `parsePorcelain`), and
 * a file moved *into* `src/` from outside is app-facing even though the entry
 * begins with the old path. So both sides of the arrow are tested, not the
 * entry as a whole.
 */
export function appChangedFiles(paths) {
  const isAppPath = (path) =>
    path === 'package.json' || path.startsWith('src/') || path.startsWith('public/');

  return paths.filter((path) => path.split('->').some((side) => isAppPath(side.trim())));
}
