/**
 * The settings navigation contract.
 *
 * The shell was restructured from a vertical list of nine sections to three
 * pinned primary groups plus a sub-tablist. There is no jsdom here, so — as with
 * the other settings tests — the contract is pinned structurally: the primary
 * row is navigation links, the sub row is a single (non-nested) tablist, the
 * Admin section is filtered for non-administrators, and the navigation sits
 * outside the one scroll pane so it can stay pinned.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function read(relativeToSrc: string): string {
  return readFileSync(new URL(`../src/${relativeToSrc}`, import.meta.url), 'utf8');
}

const TABS = read('components/settings/SettingsTabs.tsx');
/*
 * The section table lives in its own module so it can be exercised by
 * `settings-search.test.ts` — this repo has no jsdom, so anything defined inside
 * the client shell is only testable as source text.
 */
const SECTIONS = read('components/settings/sections.ts');
const LAYOUT = read('app/(app)/settings/layout.tsx');
const SCROLL = read('components/settings/SettingsScroll.tsx');

describe('the settings primary navigation', () => {
  it('is three groups of links, not a second tablist', () => {
    expect(SECTIONS).toContain("label: 'Personal'");
    expect(SECTIONS).toContain("label: 'Scheduling'");
    expect(SECTIONS).toContain("label: 'Advanced'");
    expect(TABS).toContain('data-settings-primary');
    // The accessible names are props of the shared shell.
    expect(TABS).toContain('primaryLabel="Settings groups"');
    expect(TABS).toContain('subLabel="Settings sections"');
    expect(TABS).toContain('<Link');
    expect(TABS).toContain("aria-current={current ? 'page' : undefined}");
  });

  it('keeps exactly one tablist, so the two rows cannot nest', () => {
    expect(TABS).toContain('<TabsList');
    expect(TABS).toContain('<TabsTrigger');
    expect(TABS).toContain('<TabsContent');
    expect(TABS.match(/<TabsList\b/g)?.length).toBe(1);
    // The panel is the scroll pane, so it is a genuine tab -> tabpanel pair.
    expect(TABS).toContain('<SettingsScroll>{children}</SettingsScroll>');
  });

  it('filters Admin for non-administrators and drops an emptied group', () => {
    expect(SECTIONS).toContain('adminOnly: true');
    expect(TABS).toContain('!section.adminOnly || isAdmin');
    expect(TABS).toContain('.filter((group) => group.sections.length > 0)');
  });
});

describe('the settings shell', () => {
  it('publishes the one header and renders the shell once', () => {
    expect(LAYOUT).toContain('<PageHeader title={SETTINGS_TITLE} />');
    expect(LAYOUT).toContain('<SettingsTabs>{children}</SettingsTabs>');
  });

  it('keeps the single full-height scroller and its edge fade', () => {
    expect(SCROLL).toContain('useShellPane({ fullHeight: true })');
    expect(SCROLL).toContain('fade-y');
    expect(SCROLL).toContain('min-h-0 flex-1 overflow-y-auto');
  });

  it('resolves deep links, including the legacy advanced alias', () => {
    expect(SECTIONS).toContain("if (path === '/settings/advanced') return 'focus';");
    expect(SECTIONS).toContain('href === path');
    // The shell must use that resolver rather than keeping a second copy of it.
    expect(TABS).toContain('sectionForPath(pathname)');
  });

  it('finds a setting by name, not only by its group', () => {
    // The search is over the sections themselves; it lives in `filter.ts` and is
    // exercised properly in `settings-search.test.ts`. Here the point is that the
    // navigation actually renders it.
    expect(TABS).toContain('searchSettings(visibleGroups, href, query, isAdmin)');
    expect(TABS).toContain('aria-label="Find a setting"');
  });

  it('is one shared shell, not a second pattern', () => {
    // The app wrapper configures the generic nav, so the pinned two-row
    // arrangement exists once.
    expect(TABS).toContain('export function SettingsNav(');
    expect(TABS).toContain('<SettingsNav');
  });
});
