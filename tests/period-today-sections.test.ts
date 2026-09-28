/**
 * The Today-log sections: which ones are on, and what "off" means.
 *
 * The user asked for two things that meet in this module — a per-category switch,
 * and body signs off by default — and the failure they would both produce is the
 * same one: a *stored* default that disagrees with the default a missing value
 * gets. A new user's row is written with the schema's default; an existing user's
 * row was written before the column existed; a settings response read by an older
 * client has no field at all. All three must mean the same thing, so the reading
 * rule is asserted for all three here, at the level of the payload.
 *
 * The settings *storage* is pinned from source as well (the repo mapper and the
 * generated migration), because `src/server/repos/period.ts` cannot be executed
 * in this environment — and the one thing that must not drift is `?? false`.
 */
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_PERIOD_SETTINGS } from '@/server/repos/period';
import { TODAY_CATEGORIES } from '@/lib/period-types';
import {
  SHOW_ALL_TODAY_CATEGORIES,
  TODAY_CATEGORY_HINT,
  TODAY_CATEGORY_LABEL,
  allTodayCategoriesHidden,
  isTodayCategoryVisible,
  visibleTodayCategories,
  withTodayCategoryVisible,
  type TodayLogSettings,
} from '@/components/period/today-categories';

function source(relative: string): string {
  return readFileSync(new URL(`../src/${relative}`, import.meta.url), 'utf8');
}

/** A settings payload that never carried the field at all (an older server). */
const LEGACY_PAYLOAD = { enabled: true } as unknown as TodayLogSettings;

const NOTHING_HIDDEN: TodayLogSettings = { bodySigns: false, hiddenTodayCategories: [] };

describe('the defaults', () => {
  it('shows every ordinary section and hides body signs with no settings at all', () => {
    const visible = visibleTodayCategories(undefined);
    expect(visible).toEqual(TODAY_CATEGORIES.filter((category) => category !== 'bodySigns'));
    expect(visible).not.toContain('bodySigns');
    // A form that flashed empty while the settings read was in flight would be a
    // worse first impression than one that appears complete.
    expect(allTodayCategoriesHidden(undefined)).toBe(false);
  });

  it('reads a payload with the field missing as body signs off', () => {
    expect(isTodayCategoryVisible(LEGACY_PAYLOAD, 'bodySigns')).toBe(false);
    // And as nothing hidden, so an upgraded client cannot silently hide sections
    // from a user who never hid one.
    expect(visibleTodayCategories(LEGACY_PAYLOAD)).toHaveLength(TODAY_CATEGORIES.length - 1);
  });

  it('keeps body signs off for a legacy *row*, where the column is empty', () => {
    expect(isTodayCategoryVisible({ bodySigns: undefined, hiddenTodayCategories: undefined } as unknown as TodayLogSettings, 'bodySigns')).toBe(false);
  });

  it("is off in the server’s own defaults, so the row is written off", () => {
    expect(DEFAULT_PERIOD_SETTINGS.bodySigns).toBe(false);
    expect(DEFAULT_PERIOD_SETTINGS.hiddenTodayCategories).toEqual([]);
  });

  it('maps a missing column to off in the settings response, not to undefined', () => {
    const repo = source('server/repos/period.ts');
    // The response is rebuilt field by field, so a column added now would be
    // absent from an older client's payload; `?? false` is what makes that off.
    expect(repo).toContain('bodySigns: row.bodySigns ?? false,');
    expect(repo).toContain('hiddenTodayCategories: toTodayCategories(row.hiddenTodayCategories),');
    // And the migration that gives every existing row the same answer.
    const migration = readFileSync(
      new URL('../drizzle/sqlite/0006_pink_nova.sql', import.meta.url),
      'utf8',
    );
    expect(migration).toContain('ADD `body_signs` integer DEFAULT false NOT NULL');
  });
});

describe('one category at a time', () => {
  it('hides exactly the category that was switched off', () => {
    const settings: TodayLogSettings = { bodySigns: false, hiddenTodayCategories: ['mood'] };
    expect(isTodayCategoryVisible(settings, 'mood')).toBe(false);
    for (const category of TODAY_CATEGORIES) {
      if (category === 'mood' || category === 'bodySigns') continue;
      expect(isTodayCategoryVisible(settings, category)).toBe(true);
    }
  });

  it('writes body signs as a boolean and everything else as the hidden list', () => {
    expect(withTodayCategoryVisible(NOTHING_HIDDEN, 'bodySigns', true)).toEqual({ bodySigns: true });
    expect(withTodayCategoryVisible(NOTHING_HIDDEN, 'notes', false)).toEqual({
      hiddenTodayCategories: ['notes'],
    });
    // Stored in the contract's order, not the order they were tapped in, so two
    // users who hid the same sections have identical rows.
    const one = withTodayCategoryVisible(NOTHING_HIDDEN, 'notes', false);
    const two = withTodayCategoryVisible(
      { bodySigns: false, hiddenTodayCategories: one.hiddenTodayCategories! },
      'flow',
      false,
    );
    expect(two.hiddenTodayCategories).toEqual(['flow', 'notes']);
  });

  it('turns a category back on, and cannot double-add it', () => {
    const hidden: TodayLogSettings = { bodySigns: false, hiddenTodayCategories: ['flow', 'flow'] };
    expect(withTodayCategoryVisible(hidden, 'flow', true)).toEqual({ hiddenTodayCategories: [] });
    const again = withTodayCategoryVisible(
      { bodySigns: false, hiddenTodayCategories: ['mood'] },
      'mood',
      false,
    );
    expect(again.hiddenTodayCategories).toEqual(['mood']);
  });

  it('never writes body signs into the hidden list', () => {
    const patch = withTodayCategoryVisible(NOTHING_HIDDEN, 'bodySigns', false);
    expect(patch.hiddenTodayCategories).toBeUndefined();
    expect(patch.bodySigns).toBe(false);
  });
});

describe('everything off', () => {
  it('is reachable, and is detectable so the screen can offer a way back', () => {
    const everything: TodayLogSettings = { bodySigns: false, hiddenTodayCategories: [...TODAY_CATEGORIES] };
    expect(allTodayCategoriesHidden(everything)).toBe(true);
    expect(visibleTodayCategories(everything)).toEqual([]);
  });

  it('is undone by showing everything again — without switching body signs on', () => {
    const everything: TodayLogSettings = { bodySigns: false, hiddenTodayCategories: [...TODAY_CATEGORIES] };
    const restored: TodayLogSettings = {
      bodySigns: everything.bodySigns,
      hiddenTodayCategories: SHOW_ALL_TODAY_CATEGORIES.hiddenTodayCategories!,
    };
    expect(allTodayCategoriesHidden(restored)).toBe(false);
    // "Show my sections again" is not "start asking me for an LH test".
    expect(SHOW_ALL_TODAY_CATEGORIES.bodySigns).toBeUndefined();
    expect(isTodayCategoryVisible(restored, 'bodySigns')).toBe(false);
  });
});

describe('the copy', () => {
  it('has a label and a hint for every category in the contract', () => {
    for (const category of TODAY_CATEGORIES) {
      expect(TODAY_CATEGORY_LABEL[category], category).toBeTruthy();
      expect(TODAY_CATEGORY_HINT[category], category).toBeTruthy();
    }
  });

  it('names the body-sign observations and says nothing is missing without them', () => {
    const hint = TODAY_CATEGORY_HINT.bodySigns;
    for (const term of ['mucus', 'LH', 'ovulation pain']) {
      expect(hint, term).toContain(term);
    }
    // The user's own reason, honoured in the copy: a person who has never heard
    // of an LH test must not feel they are missing something.
    expect(hint).toContain('nothing is missing');
  });

  it("keeps the section module’s file where the screen imports it from", () => {
    expect(existsSync(new URL('../src/components/period/TodaySectionsSettings.tsx', import.meta.url))).toBe(true);
  });
});
