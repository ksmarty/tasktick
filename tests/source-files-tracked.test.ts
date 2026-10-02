/**
 * Every file the suite reads must exist in a fresh clone.
 *
 * `tests/period-nav.test.ts` asserts the period routes exist as files on disk,
 * which is a real check — but it read `src/app/(app)/period/settings/data/page.tsx`
 * from the working tree only. That file was present here and absent in CI, because
 * `.gitignore` had a bare `data/` rule: a pattern without a leading slash matches a
 * directory at *any* depth, so a genuine source route was silently ignored and never
 * committed. The route 404'd in production and the suite went red on a fresh
 * checkout while staying green locally — the worst shape a failure can take.
 *
 * So the invariant is stated once, for the whole tree: nothing under `src/` may be
 * untracked or ignored. A new source file that has not been `git add`ed fails here,
 * which is the point — CI only ever has what is committed.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

function git(...args: string[]): string[] {
  const out = execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' });
  return out.split('\n').filter((line) => line.length > 0);
}

describe('a fresh clone contains every source file the tests read', () => {
  it('has no untracked source file (git add it)', () => {
    expect(git('ls-files', '--others', '--exclude-standard', '--', 'src')).toEqual([]);
  });

  it('has no ignored source file (a .gitignore pattern is swallowing it)', () => {
    // The reported bug: `src/app/(app)/period/settings/data/` matched a bare `data/`.
    expect(git('ls-files', '--others', '--ignored', '--exclude-standard', '--', 'src')).toEqual([]);
  });

  it('keeps the local-state rule anchored, so no source directory can match it', () => {
    // `.gitignore` may ignore `/data/` (the SQLite directory at the repo root) but
    // never a bare `data/`, which would match a source route again.
    const ignore = readFileSync(new URL('../.gitignore', import.meta.url), 'utf8');
    const dataRules = ignore
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => /(^|\/)data\/?$/.test(line));
    expect(dataRules).toContain('/data/');
    expect(dataRules).not.toContain('data/');
  });
});
