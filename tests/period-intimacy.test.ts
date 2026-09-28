/**
 * Protected vs unprotected: the model, the mapping, and the old boolean's fate.
 *
 * The user asked for the two to be told apart, and this is the part of that
 * request with a data-migration risk in it: thousands of rows may already say
 * "sex happened" and nothing more. The decisions this file pins are:
 *
 *  · the field is an **enum, not a second boolean**, so the impossible state
 *    ("protected and unprotected") cannot be stored;
 *  · `null` means **not stated**, and that is what every row written by the
 *    previous version reads as — no backfill, because the old boolean carried no
 *    protection information and either value would be invented;
 *  · setting a level implies the fact (you cannot record protected sex on a day
 *    that says sex did not happen), while clearing the level alone does not erase
 *    the fact;
 *  · a day holds a **list** of occurrences now, one level each, and the old
 *    boolean + single level are derived from it — a legacy row becomes one
 *    occurrence on read, which is the migration.
 *
 * The repository is pinned from source because it cannot be executed here, and
 * the migrations are read as text for the one thing that must *not* be in them: an
 * UPDATE that fills the columns in.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { updatePeriodDayLogSchema, updatePeriodSettingsSchema } from '@/lib/period-schemas';
import { INTIMACY_PROTECTION } from '@/lib/period-types';
import { hasUnstatedProtection, intimacyLabel } from '@/components/period/intimacy';

function source(relative: string): string {
  return readFileSync(new URL(`../src/${relative}`, import.meta.url), 'utf8');
}

const repo = source('server/repos/period.ts');

/** The three states a day can be in, as the day detail words them. */
const day = (intimacy: boolean, intimacyProtection: 'protected' | 'unprotected' | null) => ({
  intimacy,
  intimacyProtection,
});

/** The same, plus the occurrence list the form and the repository now carry. */
const dayWith = (
  intimacy: boolean,
  intimacyProtection: 'protected' | 'unprotected' | null,
  intimacyOccurrences: ('protected' | 'unprotected' | null)[],
) => ({ intimacy, intimacyProtection, intimacyOccurrences });

describe('the model', () => {
  it('is an enum of exactly the two states a user can record', () => {
    expect(INTIMACY_PROTECTION).toEqual(['protected', 'unprotected']);
    // "Not stated" is `null`, deliberately not a value: it is the absence of an
    // answer, and offering it as a chip would invite a user to pick it.
    expect(INTIMACY_PROTECTION).not.toContain('unspecified');
  });

  it('accepts a level, or an explicit null, and refuses anything else', () => {
    expect(updatePeriodDayLogSchema.safeParse({ intimacyProtection: 'protected' }).success).toBe(true);
    expect(updatePeriodDayLogSchema.safeParse({ intimacyProtection: 'unprotected' }).success).toBe(true);
    expect(updatePeriodDayLogSchema.safeParse({ intimacyProtection: null }).success).toBe(true);
    expect(updatePeriodDayLogSchema.safeParse({ intimacyProtection: 'unspecified' }).success).toBe(false);
    // Still a strict object: a typo must not be silently ignored.
    expect(updatePeriodDayLogSchema.safeParse({ intimacyy: true }).success).toBe(false);
  });

  it('accepts several occurrences, each a level or an explicit null', () => {
    expect(updatePeriodDayLogSchema.safeParse({ intimacyOccurrences: ['protected', 'unprotected'] }).success).toBe(true);
    expect(updatePeriodDayLogSchema.safeParse({ intimacyOccurrences: [null] }).success).toBe(true);
    expect(updatePeriodDayLogSchema.safeParse({ intimacyOccurrences: [] }).success).toBe(true);
    expect(updatePeriodDayLogSchema.safeParse({ intimacyOccurrences: ['unspecified'] }).success).toBe(false);
  });
});

describe('what a day reads as', () => {
  it('spells out both levels', () => {
    expect(intimacyLabel(day(true, 'protected'))).toBe('Protected');
    expect(intimacyLabel(day(true, 'unprotected'))).toBe('Unprotected');
  });

  it('does not turn a legacy row into a lie in either direction', () => {
    // Recorded before protection was a field: not "No", and not "Yes" either.
    expect(intimacyLabel(day(true, null))).toBe('Recorded (not stated)');
    expect(hasUnstatedProtection(day(true, null))).toBe(true);
    // Nothing recorded at all is the only state that reads as nothing.
    expect(intimacyLabel(day(false, null))).toBeNull();
    expect(intimacyLabel(null)).toBeNull();
    expect(intimacyLabel(undefined)).toBeNull();
  });

  it('does not flag a complete record as unstated', () => {
    expect(hasUnstatedProtection(day(true, 'protected'))).toBe(false);
    expect(hasUnstatedProtection(day(false, null))).toBe(false);
  });

  it('counts several occurrences rather than pretending one level describes them', () => {
    expect(
      intimacyLabel(dayWith(true, null, ['protected', 'unprotected'])),
    ).toBe('2 occurrences (1 protected, 1 unprotected)');
    expect(intimacyLabel(dayWith(true, null, [null, 'protected']))).toBe(
      '2 occurrences (1 protected, 1 not stated)',
    );
    // A single occurrence still reads as its level, whichever field carries it.
    expect(intimacyLabel(dayWith(true, 'protected', ['protected']))).toBe('Protected');
    // "Unstated" is about the occurrence, not about the summary field being null
    // because the kinds differ.
    expect(hasUnstatedProtection(dayWith(true, null, [null, 'protected']))).toBe(true);
    expect(hasUnstatedProtection(dayWith(true, null, ['protected', 'unprotected']))).toBe(false);
  });
});

describe('the storage', () => {
  it('carries the occurrence list out of the row, and migrates a legacy row on read', () => {
    // The list is authoritative when the column has one.
    expect(repo).toContain('row.intimacyOccurrences != null');
    // A row written before the column existed becomes one occurrence derived from
    // the old boolean — the existing single value is preserved, never dropped.
    expect(repo).toContain('? [row.intimacyProtection ?? null]');
    // And the single level the CSV and the day detail read is derived from the list.
    expect(repo).toContain('intimacyProtection: occurrences.length === 1 ? occurrences[0] : null,');
  });

  it('maps the list onto the form value, where a missing line compiles silently', () => {
    // `DayLogValue`'s fields are all optional, so forgetting this mapping does not
    // fail the typecheck — it renders every recorded day as "not stated".
    expect(source('components/period/data.ts')).toContain(
      'intimacyOccurrences: log?.intimacyOccurrences ?? [],',
    );
  });

  it('treats a protection level as the statement that it happened', () => {
    expect(repo).toContain('occurrences = [input.intimacyProtection];');
    // Absent list: the older pair is mapped onto it, so a caller that predates
    // the list (the CSV importer) keeps working.
    expect(repo).toContain(
      'occurrences = input.intimacy ? (storedOccurrences.length > 0 ? storedOccurrences : [null]) : [];',
    );
  });

  it('never invents a value for existing rows', () => {
    const migration = readFileSync(new URL('../drizzle/sqlite/0006_pink_nova.sql', import.meta.url), 'utf8');
    // The column is added empty and stays empty: the old boolean said nothing
    // about protection, so a backfill would be a fabricated fact. This is the pin
    // that fails if somebody "helpfully" adds the UPDATE later.
    expect(migration).toContain('ADD `intimacy_protection` text');
    expect(migration).not.toMatch(/UPDATE\s+`?period_day_logs`?\s+SET/i);
    // And the default is genuinely absent, not `false`-ish.
    expect(migration).not.toMatch(/intimacy_protection.*DEFAULT/i);

    // The occurrence list is added empty for the same reason: the read derives
    // one occurrence from the old boolean, so nothing needs writing back.
    const occurrences = readFileSync(new URL('../drizzle/sqlite/0007_crazy_solo.sql', import.meta.url), 'utf8');
    expect(occurrences).toContain('ADD `intimacy_occurrences` text');
    expect(occurrences).not.toMatch(/UPDATE\s+`?period_day_logs`?\s+SET/i);
  });

  it('keeps the old boolean working for the CSV and the calendar', () => {
    // The `intimacy` column stays: it is the CSV's vocabulary and the day
    // detail's "did anything happen" flag, derived from the list.
    expect(repo).toContain('intimacy: occurrences.length > 0,');
  });
});

describe('the settings fields that came with it', () => {
  it('accepts the two toggles and refuses an unknown section', () => {
    expect(updatePeriodSettingsSchema.safeParse({ bodySigns: true }).success).toBe(true);
    expect(updatePeriodSettingsSchema.safeParse({ hiddenTodayCategories: ['mood', 'notes'] }).success).toBe(true);
    expect(updatePeriodSettingsSchema.safeParse({ hiddenTodayCategories: [] }).success).toBe(true);
    expect(updatePeriodSettingsSchema.safeParse({ hiddenTodayCategories: ['moods'] }).success).toBe(false);
    // Still strict, so a section name from a newer build is rejected loudly
    // rather than stored and silently ignored.
    expect(updatePeriodSettingsSchema.safeParse({ showBodySigns: true }).success).toBe(false);
  });

  it('is typed as a real settings patch rather than a bag of anything', () => {
    const schema = updatePeriodSettingsSchema as unknown as z.ZodTypeAny;
    expect(schema.safeParse({ bodySigns: 'yes' }).success).toBe(false);
  });
});
