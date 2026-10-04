/**
 * The pickers' filter predicate.
 *
 * The pickers themselves are drawers, and this suite runs in the `node`
 * environment with no DOM, so what is checked here is the one piece of the
 * filtering that is a pure function: which names survive a query. Whether a row
 * renders, and whether "No calendar" is offered, is verified in a browser — see
 * the note in `AGENTS.md` about tests that cannot fail.
 */
import { describe, expect, it } from 'vitest';
import { matchesFilter } from '@/lib/utils';

describe('matchesFilter', () => {
  it('matches on a substring, not just a prefix', () => {
    expect(matchesFilter('Provincial Holidays', 'holi')).toBe(true);
    expect(matchesFilter('Provincial Holidays', 'prov')).toBe(true);
  });

  it('ignores case on both sides', () => {
    expect(matchesFilter('Federal Holidays', 'FEDERAL')).toBe(true);
    expect(matchesFilter('federal holidays', 'FeDeRaL')).toBe(true);
  });

  it('ignores surrounding whitespace in the query', () => {
    expect(matchesFilter('Federal Holidays', '  federal  ')).toBe(true);
  });

  it('treats an empty query as "everything", including an all-whitespace one', () => {
    expect(matchesFilter('Federal Holidays', '')).toBe(true);
    expect(matchesFilter('Federal Holidays', '   ')).toBe(true);
  });

  it('rejects a name that does not contain the query', () => {
    expect(matchesFilter('Federal Holidays', 'provincial')).toBe(false);
    expect(matchesFilter('Federal Holidays', 'holidayz')).toBe(false);
  });
});
