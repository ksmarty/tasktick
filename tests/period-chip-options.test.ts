/**
 * The flow slider's mapping, and the configurable symptom/mood options.
 *
 * Two user asks meet here, and both fail the same way if the mapping between a
 * stored value and what the UI shows drifts: the flow slider would write a level
 * one rung off, and an option the user removed would take a recorded day's value
 * off the screen with it.
 *
 * So the two decisions are pinned as *resolved values* (imported functions), not
 * as strings in the JSX: `flowPosition` / `flowAtPosition` are what the slider
 * calls, and `valuesOutsideOptions` is what decides a value is "your own" now.
 * The settings storage is pinned from source, because the repository cannot run
 * in this environment.
 */
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { flowAtPosition, flowPosition, valuesOutsideOptions } from '@/components/period/chip-options';
import { updatePeriodDayLogSchema, updatePeriodSettingsSchema } from '@/lib/period-schemas';
import { DEFAULT_PERIOD_SETTINGS } from '@/server/repos/period';
import { PERIOD_FLOW_LEVELS, PERIOD_MOODS, PERIOD_SYMPTOMS } from '@/lib/period-types';

function source(relative: string): string {
  return readFileSync(new URL(`../src/${relative}`, import.meta.url), 'utf8');
}

describe('the flow slider maps positions to levels, one to one', () => {
  it('puts every level on its own position, in the contract order', () => {
    expect(PERIOD_FLOW_LEVELS).toEqual(['none', 'spotting', 'light', 'medium', 'heavy']);
    const positions = PERIOD_FLOW_LEVELS.map((level) => flowPosition(PERIOD_FLOW_LEVELS, level));
    // Strictly increasing, and one position per level: a collision would make two
    // levels unselectable, which a screenshot would not reveal.
    expect(positions).toEqual([0, 1, 2, 3, 4]);
    expect(new Set(positions).size).toBe(PERIOD_FLOW_LEVELS.length);
  });

  it('round-trips every position back to the same level', () => {
    for (let i = 0; i < PERIOD_FLOW_LEVELS.length; i += 1) {
      const level = flowAtPosition(PERIOD_FLOW_LEVELS, i);
      expect(level).toBe(PERIOD_FLOW_LEVELS[i]);
      expect(flowPosition(PERIOD_FLOW_LEVELS, level)).toBe(i);
    }
  });

  it('treats "not logged" as position 0 without claiming it is "none"', () => {
    // The slider sits at the start, but the level it would write is only chosen
    // when the user moves it — null and `none` are different records.
    expect(flowPosition(PERIOD_FLOW_LEVELS, null)).toBe(0);
    expect(flowAtPosition(PERIOD_FLOW_LEVELS, 0)).toBe('none');
  });

  it('refuses a position outside the levels rather than inventing one', () => {
    expect(flowAtPosition(PERIOD_FLOW_LEVELS, -1)).toBeNull();
    expect(flowAtPosition(PERIOD_FLOW_LEVELS, PERIOD_FLOW_LEVELS.length)).toBeNull();
  });

  it('writes the level through the same function the slider renders with', () => {
    const chips = source('components/period/chips.tsx');
    // The input is a native range with integer steps and an accessible value that
    // is the level's word, not the number.
    expect(chips).toContain('type="range"');
    expect(chips).toContain('step={1}');
    expect(chips).toContain('aria-valuetext={currentText}');
    expect(chips).toContain('onChange(flowAtPosition(options, Number(event.target.value)));');
  });
});

describe('a value whose option was removed is still shown', () => {
  it('reports a recorded value outside the current option list', () => {
    // The user removed `cramps` from their symptom options after recording it.
    expect(valuesOutsideOptions(['headache', 'bloating'], ['cramps', 'headache'])).toEqual(['cramps']);
  });

  it('reports nothing when every recorded value is still an option', () => {
    expect(valuesOutsideOptions(['cramps', 'headache'], ['headache'])).toEqual([]);
  });

  it('reports every recorded value when the option list is empty', () => {
    // Emptying the list is allowed; it must not empty the history.
    expect(valuesOutsideOptions([], ['cramps', 'headache'])).toEqual(['cramps', 'headache']);
  });

  it('is what the day form uses to build its "your own" row', () => {
    const form = source('components/period/DayLogForm.tsx');
    expect(form).toContain('valuesOutsideOptions(symptomOptions, symptoms)');
    expect(form).toContain('valuesOutsideOptions(moodOptions, mood)');
  });
});

describe('the options live in the settings payload', () => {
  it('defaults to the contract vocabulary, so a new user never sees an empty row', () => {
    expect(DEFAULT_PERIOD_SETTINGS.symptomOptions).toEqual([...PERIOD_SYMPTOMS]);
    expect(DEFAULT_PERIOD_SETTINGS.moodOptions).toEqual([...PERIOD_MOODS]);
  });

  it('accepts an edited list, including an empty one', () => {
    expect(updatePeriodSettingsSchema.safeParse({ symptomOptions: ['cramps', 'migraine'] }).success).toBe(true);
    expect(updatePeriodSettingsSchema.safeParse({ moodOptions: [] }).success).toBe(true);
  });

  it('refuses a non-list, and still refuses an unknown key', () => {
    expect(updatePeriodSettingsSchema.safeParse({ symptomOptions: 'cramps' }).success).toBe(false);
    expect(updatePeriodSettingsSchema.safeParse({ symptomOptions2: [] }).success).toBe(false);
  });

  it('maps a missing column to the defaults in the response', () => {
    const repo = source('server/repos/period.ts');
    // Same reasoning as `bodySigns ?? false`: a field the response does not name
    // would be `undefined` on an older client, which is not "the defaults".
    expect(repo).toContain('symptomOptions: toOptionList(row.symptomOptions, PERIOD_SYMPTOMS),');
    expect(repo).toContain('moodOptions: toOptionList(row.moodOptions, PERIOD_MOODS),');
    // And the write path normalises the list through the same helper.
    expect(repo).toContain('patch.symptomOptions = toOptionList(input.symptomOptions, PERIOD_SYMPTOMS);');
    expect(repo).toContain('patch.moodOptions = toOptionList(input.moodOptions, PERIOD_MOODS);');
  });

  it('adds the columns to both dialects and a migration', () => {
    for (const dialect of ['sqlite', 'pg']) {
      const schema = source(`server/db/schema.${dialect}.ts`);
      expect(schema).toContain('symptom_options');
      expect(schema).toContain('mood_options');
    }
    const migration = readFileSync(new URL('../drizzle/sqlite/0007_crazy_solo.sql', import.meta.url), 'utf8');
    expect(migration).toContain('ADD `symptom_options` text');
    expect(migration).toContain('ADD `mood_options` text');
  });

  it('stores the options as labels, not foreign keys', () => {
    // The day log's own lists are what history holds; nothing here rewrites them.
    const dayLog = updatePeriodDayLogSchema.safeParse({ symptoms: ['cramps'] });
    expect(dayLog.success).toBe(true);
    // There is no field on a day log that points at an option — that absence is
    // the guarantee that removing one cannot corrupt a day.
    expect(source('lib/period-types.ts')).not.toContain('symptomOptionId');
  });
});

describe('the settings screen that edits the options', () => {
  it('exists where the log-section switches live', () => {
    expect(existsSync(new URL('../src/components/period/TodaySectionsSettings.tsx', import.meta.url))).toBe(true);
    const screen = source('components/period/TodaySectionsSettings.tsx');
    expect(screen).toContain("setOptions('symptomOptions', next)");
    expect(screen).toContain("setOptions('moodOptions', next)");
    // Restoring the defaults is offered, so emptying the list is not a dead end.
    expect(screen).toContain('Restore the default options');
  });
});
