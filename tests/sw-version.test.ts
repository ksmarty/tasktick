import { describe, expect, it } from 'vitest';
import { parsePorcelain, readSwVersion } from '../scripts/sw-version.mjs';

/*
 * These pin the two halves of `npm run verify:sw` that were wrong while the
 * check reported success — see the script's header.
 *
 * The check exists because a byte-identical `public/sw.js` is never installed:
 * the browser compares script bytes, so an existing client stays pinned to the
 * old shell and the old content-hashed chunks indefinitely. Three releases
 * shipped that way and the app the user ran was three versions old.
 */
describe('the service-worker version guard', () => {
  it('reads VERSION out of the worker source', () => {
    expect(readSwVersion("const VERSION = 'tasktick-v31';")).toBe('tasktick-v31');
    expect(() => readSwVersion('const OTHER = 1;')).toThrow(/no VERSION constant/);
  });

  /*
   * The bug: `git status --porcelain` writes ` M public/sw.js` — a space, then
   * the status code, then a space, then the path. Trimming the whole blob before
   * splitting removes the first space and shifts that line one column left, so
   * the path came out as `ublic/sw.js`. `public/sw.js` sorts before `scripts/`
   * and `src/`, so it is almost always that first line: the check could not see
   * the one file it exists to guard, and refused releases from a working tree.
   */
  it('keeps the first porcelain entry intact', () => {
    expect(parsePorcelain(' M public/sw.js\n M src/app.ts\n?? tests/new.test.ts\n')).toEqual([
      'public/sw.js',
      'src/app.ts',
      'tests/new.test.ts',
    ]);
  });

  it('tolerates a trailing newline and an empty status', () => {
    expect(parsePorcelain(' M public/sw.js\n')).toEqual(['public/sw.js']);
    expect(parsePorcelain('')).toEqual([]);
  });

  /*
   * A staged rename prints `R  old -> new`; the path still starts at index 3, so
   * the arrow form survives as one entry rather than being mangled. Pinned
   * because it is the only other shape the real output takes here.
   */
  it('keeps a rename entry whole', () => {
    expect(parsePorcelain('R  src/old.ts -> src/new.ts\n')).toEqual(['src/old.ts -> src/new.ts']);
  });
});
