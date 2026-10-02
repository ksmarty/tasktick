import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { affectsFor, hasRule } from '@/lib/offline-rules';

/**
 * The invalidation contract, pinned.
 *
 * Every bug this file guards against looked identical from the outside: a screen
 * saved something, went on showing pre-save data, and only corrected itself on a
 * second interaction. The cause was always the same — the write named a prefix
 * list that omitted a read the write had changed. A missing prefix is not an
 * error, so nothing failed and nothing logged; the drift was invisible until a
 * person noticed the UI was lying.
 *
 * Two things are enforced here:
 *
 * 1. Every route the client writes to has a rule in `AFFECTS`.
 * 2. Every file that writes through `api.*` takes its prefix list from that table
 *    (`affectsFor(...)` or a constant derived from it), rather than hand-copying
 *    prefixes that can drift.
 */

const ROOT = new URL('..', import.meta.url).pathname;

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

/**
 * `api.post('/api/tasks')`, `` api.patch(`/api/habits/${id}`) `` and friends.
 *
 * Whitespace between the pieces is allowed because a call may be wrapped across
 * lines (`void api\n  .patch(...)`), and a scan that missed those would call a
 * file compliant because it never looked at it.
 */
const WRITE_CALL = /api\s*\.\s*(post|patch|put|delete)(?:<[^>]*>)?\s*\(\s*(`[^`]*`|'[^']*'|"[^"]*")/g;

type Call = { file: string; method: string; path: string };

function clientWrites(): Call[] {
  const calls: Call[] = [];
  for (const file of sourceFiles(join(ROOT, 'src'))) {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(WRITE_CALL)) {
      calls.push({
        file: relative(ROOT, file),
        method: match[1].toUpperCase(),
        // A template literal carries an identifier; any concrete value matches
        // the same rule, so substituting one keeps the table lookup honest.
        path: match[2].slice(1, -1).replace(/\$\{[^}]*\}/g, 'placeholder'),
      });
    }
  }
  return calls;
}

/**
 * Files that write through `api.*` without asking the table themselves, and why.
 *
 * Being here is a claim that something else already covers the write, or that
 * the list genuinely cannot drift. It is not a claim that invalidation is
 * unimportant — if a rule would make the hand-written value wrong, delete the
 * entry and use `affectsFor`.
 */
const EXEMPT = new Map<string, string>([
  [
    'src/components/period/data.ts',
    'The period row is the single self-prefix, and PERIOD_PREFIX doubles as the key every period reader passes to useResource — it is a read key that happens to equal the write set, so deriving it would read as the reverse of what it is.',
  ],
  [
    'src/components/settings/IcalSubscriptionDialog.tsx',
    'A form that never renders outside IcalSubscribeSection, which invalidates on its behalf through onSaved() using the same /api/ical rule. Deriving it here would be the second copy the table exists to remove.',
  ],
]);

describe('every client write route has a rule', () => {
  it('names each route in AFFECTS instead of falling back to its own path', () => {
    const offenders = [
      ...new Set(
        clientWrites()
          .filter((call) => !hasRule(call.path))
          .map((call) => `${call.method} ${call.path} (${call.file})`),
      ),
    ].sort();

    // A route with no rule resolves to its own pathname. That is right for a
    // self-only read and wrong for anything that reaches a second one, and the
    // difference is invisible at runtime — so every route has to say which it is.
    expect(offenders).toEqual([]);
  });
});

describe('every writer derives its prefixes', () => {
  it('uses affectsFor or a constant built from it, unless declared', () => {
    const offenders = [
      ...new Set(
        clientWrites()
          .map((call) => call.file)
          .filter((file) => !EXEMPT.has(file))
          .filter((file) => {
            const source = readFileSync(join(ROOT, file), 'utf8');
            return !source.includes('affectsFor(') && !source.includes('_WRITE_PREFIXES');
          }),
      ),
    ].sort();

    expect(offenders).toEqual([]);
  });

  it('declares each exempt file because it exists', () => {
    for (const file of EXEMPT.keys()) {
      expect(statSync(join(ROOT, file)).isFile()).toBe(true);
    }
  });
});

describe('the table resolves to the sets the screens depend on', () => {
  /**
   * Pinned values, not source strings: a row that changes shape has to change
   * here too, which is the point. These are the routes whose omissions caused
   * the reported bugs.
   */
  const PINNED: [string, string, string[]][] = [
    ['POST', '/api/habits', ['/api/habits', '/api/stats', '/api/bootstrap']],
    ['POST', '/api/habits/abc/checkin', ['/api/habits', '/api/stats', '/api/bootstrap']],
    ['POST', '/api/tasks', ['/api/tasks', '/api/bootstrap', '/api/calendar/items', '/api/lists']],
    ['POST', '/api/tasks/abc/complete', ['/api/tasks', '/api/bootstrap', '/api/calendar/items', '/api/lists']],
    ['POST', '/api/lists', ['/api/lists', '/api/bootstrap', '/api/tasks']],
    ['POST', '/api/events', ['/api/events', '/api/calendar/items', '/api/bootstrap']],
    ['POST', '/api/calendars', ['/api/calendars', '/api/calendar/items', '/api/bootstrap']],
    ['POST', '/api/focus', ['/api/focus', '/api/stats']],
    ['POST', '/api/settings', ['/api/settings', '/api/bootstrap']],
    ['POST', '/api/ical/subscriptions', ['/api/ical', '/api/calendars', '/api/calendar/items', '/api/bootstrap']],
    ['POST', '/api/ical-tokens', ['/api/ical-tokens']],
    ['POST', '/api/period/cycles', ['/api/period']],
    [
      'POST',
      '/api/caldav/accounts/abc/sync',
      ['/api/caldav/accounts', '/api/calendars', '/api/calendar/items', '/api/events', '/api/tasks', '/api/bootstrap'],
    ],
  ];

  it.each(PINNED)('%s %s resolves to its pinned set', (method, path, expected) => {
    expect(affectsFor(method, path).slice().sort()).toEqual(expected.slice().sort());
  });

  it('puts the task list and the calendar in a task write', () => {
    // The two the old hand-written lists dropped most often: completing a task
    // moves the Today counts and the calendar day cell.
    expect(affectsFor('POST', '/api/tasks/abc/complete')).toContain('/api/bootstrap');
    expect(affectsFor('POST', '/api/tasks/abc/complete')).toContain('/api/calendar/items');
  });

  it('puts the stats in a habit write', () => {
    // Checking a habit off moves the habit's chart and the stats screen, which
    // no habit component reads.
    expect(affectsFor('POST', '/api/habits/abc/checkin')).toContain('/api/stats');
  });
});
