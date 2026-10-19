import { describe, expect, it } from 'vitest';
import { appChangedFiles, parsePorcelain, readSwVersion } from '../scripts/sw-version.mjs';

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

  /*
   * Only the paths a browser runs count as "the app". Before this filter, every
   * changed path was compared against the worker's absence, so a README fix
   * refused a release. With one release now cut per push to main, that would
   * have made a worker bump mandatory on every documentation change.
   */
  it('counts only the paths a browser runs as app-facing', () => {
    expect(
      appChangedFiles([
        'src/app/tasks/page.tsx',
        'public/sw.js',
        'package.json',
        'README.md',
        'tests/pwa-sw.test.ts',
        '.github/workflows/auto-increment.yml',
        'scripts/check-sw-version.mjs',
        'custom_components/tasktick/__init__.py',
      ]),
    ).toEqual(['src/app/tasks/page.tsx', 'public/sw.js', 'package.json']);
  });

  /*
   * A file moved into src/ from outside is app-facing, even though the rename
   * entry begins with the old path. `parsePorcelain` is fed the raw output so
   * the test sees exactly the string the check sees.
   */
  it('treats a rename into src/ as app-facing', () => {
    expect(appChangedFiles(parsePorcelain('R  old/thing.ts -> src/thing.ts\n'))).toEqual([
      'old/thing.ts -> src/thing.ts',
    ]);
  });

  it('still ignores a rename between two paths the browser never sees', () => {
    expect(appChangedFiles(parsePorcelain('R  docs/a.md -> docs/b.md\n'))).toEqual([]);
  });

  it('finds nothing app-facing in a docs-only release', () => {
    expect(appChangedFiles(['README.md', 'docs/setup.md', '.github/workflows/ci.yml'])).toEqual([]);
  });
});
