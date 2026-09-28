/**
 * Which sections of the Today log are shown — one decision, in one place.
 *
 * ## Why this is a module rather than two `if`s
 *
 * Three surfaces need the answer: the form itself (`DayLogForm`), the settings
 * screen that sets it, and Insights, which hides the body-sign rows for the same
 * reason and must not disagree with the form about what "off" means. The rule is
 * small but not trivial — the body-signs switch is stored on its own while the
 * other seven are stored as a *hidden* list, and `undefined` (a settings read
 * that has not landed, or an older payload) has a defined meaning — so it is
 * written once and unit-tested rather than re-derived at each call site.
 *
 * ## The two defaults
 *
 *  · **Nothing hidden** for the seven ordinary sections: every existing user has
 *    no stored list, and the form they already know is the one with everything
 *    on. The list stores what is hidden, not what is shown, so a category added
 *    to the contract later appears by default instead of being silently absent
 *    from an older "show these" list.
 *  · **Off** for body signs, which is the user's own instruction: most people do
 *    not know what an LH test is, and being asked for one makes them feel they
 *    are missing something. It is off for a missing settings payload, off for a
 *    legacy row, and off in `DEFAULT_PERIOD_SETTINGS`.
 */
import { TODAY_CATEGORIES, type PeriodSettings, type PeriodSettingsUpdate, type TodayCategory } from '@/lib/period-types';

/** The name of a section, as the settings switch and the form heading say it. */
export const TODAY_CATEGORY_LABEL: Record<TodayCategory, string> = {
  flow: 'Flow',
  contraception: 'Birth control',
  symptoms: 'Symptoms',
  mood: 'Mood',
  weight: 'Weight',
  bodySigns: 'Body signs',
  intimacy: 'Sex',
  notes: 'Notes',
};

/**
 * One line under each switch, saying what the section holds.
 *
 * The body-signs line is the one that matters: it names the four observations and
 * says plainly that turning it on is for someone already tracking fertility, so a
 * person who has never heard of an LH test can see that nothing is being withheld
 * from them.
 */
export const TODAY_CATEGORY_HINT: Record<TodayCategory, string> = {
  flow: 'How heavy the bleeding was, and whether it was spotting.',
  contraception: 'Whether today’s pill, ring or patch was taken — when a method has a daily rhythm.',
  symptoms: 'Cramps, headache, bloating and the rest, as chips you can add to.',
  mood: 'How you felt, as chips.',
  weight: 'A weight in kg. Optional on its own — it is not a cycle observation.',
  bodySigns:
    'Cervical mucus, LH tests, ovulation pain and basal temperature. Those are fertility-tracking observations, and most people have never been asked for them — so this is off until you turn it on, and nothing is missing if you leave it off.',
  intimacy: 'Whether you had sex, and whether it was protected.',
  notes: 'Anything else worth remembering about the day.',
};

/**
 * The settings this depends on — the two switches, plus the chip vocabularies.
 *
 * `symptomOptions` / `moodOptions` are optional so an older payload (or a test
 * fixture that predates them) reads as the contract's defaults rather than as an
 * empty row — the form falls back with `?? PERIOD_SYMPTOMS`.
 */
export type TodayLogSettings = Pick<PeriodSettings, 'bodySigns' | 'hiddenTodayCategories'> &
  Partial<Pick<PeriodSettings, 'symptomOptions' | 'moodOptions'>>;

/**
 * Whether a section is shown.
 *
 * `settings` may be `undefined` while the read is in flight; that means "the form
 * as it has always been", i.e. the seven ordinary sections on and body signs off
 * — never a form that flashes empty and then fills in.
 */
export function isTodayCategoryVisible(
  settings: TodayLogSettings | undefined | null,
  category: TodayCategory,
): boolean {
  if (category === 'bodySigns') return settings?.bodySigns === true;
  return !(settings?.hiddenTodayCategories ?? []).includes(category);
}

/** The visible sections, in the form's own order. */
export function visibleTodayCategories(settings: TodayLogSettings | undefined | null): TodayCategory[] {
  return TODAY_CATEGORIES.filter((category) => isTodayCategoryVisible(settings, category));
}

/** True when the user has switched every section off. */
export function allTodayCategoriesHidden(settings: TodayLogSettings | undefined | null): boolean {
  return visibleTodayCategories(settings).length === 0;
}

/**
 * The settings patch that shows or hides one section.
 *
 * The body-signs switch writes a boolean and every other one edits the hidden
 * list, so the two storage shapes stay hidden behind this function — a caller
 * that got it backwards would write a category name into a boolean column and
 * fail validation on the server, which is exactly the sort of mistake that shows
 * up as "the switch does nothing".
 */
export function withTodayCategoryVisible(
  settings: TodayLogSettings | undefined | null,
  category: TodayCategory,
  visible: boolean,
): PeriodSettingsUpdate {
  if (category === 'bodySigns') return { bodySigns: visible };
  const hidden = new Set(settings?.hiddenTodayCategories ?? []);
  if (visible) hidden.delete(category);
  else hidden.add(category);
  // Stored in the contract's own order rather than insertion order, so two users
  // who hid the same sections have byte-identical stored values.
  return { hiddenTodayCategories: TODAY_CATEGORIES.filter((entry) => hidden.has(entry)) };
}

/**
 * The patch that shows every ordinary section again — the escape hatch from an
 * empty form.
 *
 * Deliberately does *not* touch `bodySigns`: "show my sections again" is not the
 * same request as "start asking me for an LH test", and the whole point of the
 * body-signs default is that a user has to ask for it. With the seven ordinary
 * sections restored the form is never empty, so `allTodayCategoriesHidden` stays
 * false however they set the body-signs switch.
 */
export const SHOW_ALL_TODAY_CATEGORIES: PeriodSettingsUpdate = {
  hiddenTodayCategories: [],
};
