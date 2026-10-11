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
 * The paths a browser actually runs: `package.json` (the version), everything
 * under `src/`, and everything under `public/`. If any of those differ from the
 * last release commit and `VERSION` did not move, the release is refused.
 *
 * Anything else — docs, tests, workflows, scripts — ships nothing to a client,
 * so a release that touched only those is compared against nothing and passes.
 * That filter (`appChangedFiles`) matters more now that a release is cut
 * automatically on every push to main: without it, a README fix would fail CI
 * and demand a meaningless worker bump.
 *
 * ## Two ways this check has been useless, both fixed here
 *
 * 1. It trimmed `git status --porcelain` as a whole before splitting it, which
 *    eats the leading space of the first line and shifts it one column left. See
 *    `parsePorcelain` in `sw-version.mjs` — `public/sw.js` is usually that first
 *    line, so the check refused every release made from a working tree while
 *    reporting that the worker had not changed.
 *
 * 2. CI ran it against a `actions/checkout` default `fetch-depth: 1`. With one
 *    commit of history there is no previous tag, so `git describe HEAD^` threw
 *    and the script exited 0 with "nothing to compare". It could not fail in CI,
 *    which is the only place it was ever going to run unattended. `ci.yml` now
 *    checks out full history.
 *
 * Run with `--check` in CI (compares against the previous tag) or bare for a
 * reminder. It exits 0 when there is no previous tag to compare with, so a fresh
 * clone is never blocked.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { parsePorcelain, readSwVersion, appChangedFiles } from './sw-version.mjs';

const sh = (args) => execFileSync('git', args, { encoding: 'utf8' }).trim();

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
  ...parsePorcelain(execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' })),
].filter(Boolean);

/*
 * Only app-facing paths are compared. A release that touched nothing a browser
 * runs — a README, a workflow, a test — needs no new worker byte and must not be
 * refused for lacking one. See `appChangedFiles`.
 */
const appChanged = appChangedFiles(changed);
if (appChanged.length === 0) {
  console.log(`[check-sw] nothing app-facing changed since ${previousTag}; nothing to compare`);
  process.exit(0);
}

const swChanged = appChanged.includes('public/sw.js');

if (!swChanged) {
  console.error(
    [
      '',
      `[check-sw] REFUSING: ${appChanged.length} app file(s) changed since ${previousTag}, but public/sw.js did not.`,
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
