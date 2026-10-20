/**
 * The settings search, and the section table it searches.
 *
 * The navigation shell that renders this is a client component built on Radix, so
 * it cannot be rendered in this repo (no jsdom, no testing-library). Everything
 * worth checking is therefore a pure function over the section table — which is
 * why the table moved out of `SettingsTabs.tsx` into `sections.ts`.
 *
 * The last test is the one that keeps the rest honest: it walks the real section
 * table and asserts every section has a route and that no two share one, so a
 * section added without a page fails here instead of 404ing in the navigation.
 */
import { describe, expect, it } from 'vitest';
import { searchSettings } from '@/components/settings/filter';
import { SECTION_GROUPS, TAB_HREF, sectionForPath } from '@/components/settings/sections';

describe('searchSettings', () => {
  it('finds a section by its label', () => {
    const [first] = searchSettings(SECTION_GROUPS, TAB_HREF, 'notif');
    expect(first?.value).toBe('notifications');
    expect(first?.href).toBe('/settings/notifications');
    expect(first?.group).toBe('Scheduling');
  });

  it('finds a section by a word nobody would guess the label from', () => {
    // The reason `keywords` exists: the section is called Date & time.
    expect(searchSettings(SECTION_GROUPS, TAB_HREF, 'timezone')[0]?.value).toBe('date-time');
    expect(searchSettings(SECTION_GROUPS, TAB_HREF, 'push')[0]?.value).toBe('notifications');
    expect(searchSettings(SECTION_GROUPS, TAB_HREF, 'backup')[0]?.value).toBe('data');
    expect(searchSettings(SECTION_GROUPS, TAB_HREF, 'pomodoro')[0]?.value).toBe('focus');
  });

  it('ranks a label hit above a keyword hit', () => {
    // `data` is a label, and Data's own keywords also include "export"; a query of
    // "data" must not be overtaken by a keyword match from another section.
    const hits = searchSettings(SECTION_GROUPS, TAB_HREF, 'data');
    expect(hits[0]?.value).toBe('data');
  });

  it('is case-insensitive and ignores surrounding space', () => {
    expect(searchSettings(SECTION_GROUPS, TAB_HREF, '  APPEARANCE  ')[0]?.value).toBe('appearance');
  });

  it('matches nothing for an empty query rather than everything', () => {
    expect(searchSettings(SECTION_GROUPS, TAB_HREF, '')).toEqual([]);
    expect(searchSettings(SECTION_GROUPS, TAB_HREF, '   ')).toEqual([]);
  });

  it('matches nothing for a query that names nothing', () => {
    expect(searchSettings(SECTION_GROUPS, TAB_HREF, 'zebra')).toEqual([]);
  });

  it('hides the admin section from accounts that are not administrators', () => {
    expect(searchSettings(SECTION_GROUPS, TAB_HREF, 'admin', false)).toEqual([]);
    expect(searchSettings(SECTION_GROUPS, TAB_HREF, 'admin', true)[0]?.value).toBe('admin');
  });

  it('keeps the declared order for equally good hits', () => {
    // "a" is a prefix of Account, Appearance and API, and inside several keywords;
    // the order must be the table's order, not whatever the sort happened to do.
    const hits = searchSettings(SECTION_GROUPS, TAB_HREF, 'a');
    const account = hits.findIndex((hit) => hit.value === 'account');
    const appearance = hits.findIndex((hit) => hit.value === 'appearance');
    expect(account).toBeLessThan(appearance);
  });
});

describe('the section table', () => {
  it('has a route for every section, and a unique route for each', () => {
    const routes = SECTION_GROUPS.flatMap((group) =>
      group.sections.map((section) => ({
        value: section.value,
        href: (TAB_HREF as Record<string, string | undefined>)[section.value],
      })),
    );
    const missing = routes.filter((route) => !route.href);
    expect(missing).toEqual([]);
    expect(new Set(routes.map((route) => route.href)).size).toBe(routes.length);
  });

  it('includes the tags section, which is how tags are reached on a phone', () => {
    expect(TAB_HREF.tags).toBe('/settings/tags');
    expect(searchSettings(SECTION_GROUPS, TAB_HREF, 'tag')[0]?.value).toBe('tags');
  });

  it('maps a pathname back to its section, including the legacy alias', () => {
    expect(sectionForPath('/settings')).toBe('account');
    expect(sectionForPath('/settings/tags')).toBe('tags');
    expect(sectionForPath('/settings/tags/')).toBe('tags');
    expect(sectionForPath('/settings/advanced')).toBe('focus');
    expect(sectionForPath('/settings/nope')).toBeNull();
  });
});
