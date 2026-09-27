#!/usr/bin/env node
/**
 * Refuses a release that changes the app but not the service worker's `VERSION`.
 *
 * ## Why this is a script and not a comment
 *
 * `public/sw.js` told every reader for months to "bump VERSION on every deploy
 * that changes a precached file", and claimed `npm run verify:sw` enforced it.
 * **No such script existed.** So nothing enforced it, and three releases shipped
 * with a byte-identical `sw.js`.
 *
 * That failure is worse than it sounds. The browser installs a new worker by
 * comparing the script bytes; identical bytes mean **no install at all**, so an
 * existing client is pinned to the old shell *and* the old content-hashed chunks
 * indefinitely. The user was running an app three versions old and reported the
 * features as broken — which is exactly what they looked like from there.
 *
 * ## What it compares
 *
 * The two files most likely to change with a release: `package.json` (the version)
 * and everything under `public/` and `src/`. If any of those differ from the last
 * release commit and `VERSION` did not move, the release is refused.
 *
 * Run with `--check` in CI (compares against the previous tag) or bare for a
 * reminder. It exits 0 when there is no previous tag to compare with, so a fresh
 * clone is never blocked.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const sh = (args) => execFileSync('git', args, { encoding: 'utf8' }).trim();

function readSwVersion(text) {
  const m = text.match(/const VERSION = '([^']+)'/);
  if (!m) throw new Error('no VERSION constant in public/sw.js');
  return m[1];
}

let previousTag;
try {
  previousTag = sh(['describe', '--tags', '--abbrev=0', 'HEAD^']);
} catch {
  console.log('[check-sw] no previous tag; nothing to compare');
  process.exit(0);
}

/*
 * Committed changes since the last tag **plus** anything in the working tree,
 * so the check is usable before the release commit exists as well as in CI.
 */
const changed = [
  ...sh(['diff', '--name-only', `${previousTag}..HEAD`]).split('\n'),
  ...sh(['status', '--porcelain'])
    .split('\n')
    .map((line) => line.slice(3).trim())
    .filter(Boolean),
].filter(Boolean);
const swChanged = changed.includes('public/sw.js');

if (!swChanged) {
  console.error(
    [
      '',
      `[check-sw] REFUSING: ${changed.length} file(s) changed since ${previousTag}, but public/sw.js did not.`,
      '',
      '  A byte-identical service worker is never installed, so existing clients stay',
      '  pinned to the old shell and the old chunks indefinitely — the release simply',
      '  never reaches them.',
      '',
      '  Fix: bump `const VERSION = \'tasktick-v<n>\';` in public/sw.js.',
      '',
    ].join('\n'),
  );
  process.exit(1);
}

const before = readSwVersion(execFileSync('git', ['show', `${previousTag}:public/sw.js`], { encoding: 'utf8' }));
const after = readSwVersion(readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8'));
if (before === after) {
  console.error(`[check-sw] REFUSING: public/sw.js changed but VERSION is still ${after}.`);
  process.exit(1);
}
console.log(`[check-sw] ok: ${before} -> ${after}`);
