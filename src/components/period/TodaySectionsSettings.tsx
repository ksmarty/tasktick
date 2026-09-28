'use client';

/**
 * Period settings → Log sections: one switch per group of the Today form.
 *
 * ## What this is for
 *
 * The Today form carries eight groups, and nobody uses all of them: someone
 * tracking to conceive turns on body signs and temperature, someone who never
 * logs a mood would rather not scroll past two rows of mood chips, and someone
 * who has no method recorded gets a "Birth control" card explaining that fact
 * every single day. This section lets each of them be switched off, so the screen
 * a user opens most often is only what they actually use.
 *
 * ## Why the switches are two storage shapes behind one function
 *
 * Seven of these are entries in the settings' `hiddenTodayCategories` list; body
 * signs is its own boolean, because it also governs the body-signs card on
 * Insights and because its default (off) is the user's own instruction rather
 * than "nothing hidden". `withTodayCategoryVisible` owns that split so this screen
 * never has to know which is which — see `today-categories.ts`.
 *
 * ## Nothing is deleted
 *
 * Hiding a section hides the *inputs*, never the recorded days: the calendar, the
 * day detail and the export all keep them, and switching a section back on finds
 * the data where it was. The footer says so, because "turn this off" on a form
 * that has been recording your data for a year is a sentence that needs it.
 *
 * ## The chip vocabularies live here too
 *
 * "Change the options for symptoms & mood" is the same question as "which
 * sections do I use" — what the log offers — so the editor for the two chip
 * lists is the second group on this page. The lists are labels, not foreign
 * keys: a day stores the words themselves, so editing the list here cannot
 * change or hide a recorded day (see `OptionListEditor`).
 */
import { useEffect, useState } from 'react';
import { Cross1Icon } from '@svg-animated-icons/react/cross-1';
import { PlusIcon } from '@svg-animated-icons/react/plus';
import { useToast } from '@/components/app/Toast';
import { SettingsGroup, SettingsRow } from '@/components/settings';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { PERIOD_MOODS, PERIOD_SYMPTOMS, TODAY_CATEGORIES } from '@/lib/period-types';
import { usePeriodSettings, useUpdatePeriodSettings } from './data';
import {
  TODAY_CATEGORY_HINT,
  TODAY_CATEGORY_LABEL,
  isTodayCategoryVisible,
  withTodayCategoryVisible,
} from './today-categories';

export function PeriodSectionsSection() {
  const { toast } = useToast();
  const settings = usePeriodSettings();
  const current = settings.data;

  const update = useUpdatePeriodSettings({
    onError: (message) => toast({ title: 'Could not save that', description: message, variant: 'error' }),
  });

  /**
   * Writes one chip vocabulary, through the store first.
   *
   * Same reasoning as `setVisible` below: the entry keeps serving the old value
   * until a refetch lands, and nothing here remounts, so an editor that waited
   * for the server would look like it ignored the edit. A failure reverts it.
   */
  function setOptions(field: 'symptomOptions' | 'moodOptions', next: string[]) {
    const before = settings.data;
    if (before) settings.mutate({ ...before, [field]: next });
    void update.run({ [field]: next }).then((saved) => {
      if (!saved && before) settings.mutate(before);
    });
  }

  /**
   * Flips one switch.
   *
   * The optimistic write is not a flourish: `invalidate()` marks the settings
   * entry stale but keeps serving the old value until something refetches, and
   * nothing here remounts — so without writing the intended value through first,
   * the switch would stay where it was and two quick taps would both be computed
   * from the *previous* list, the second silently undoing the first. The server's
   * own answer replaces it a moment later and a failure reverts it. This is the
   * same reasoning as `PeriodModeCard`'s switch. */
  function setVisible(category: (typeof TODAY_CATEGORIES)[number], next: boolean) {
    const before = settings.data;
    const patch = withTodayCategoryVisible(before, category, next);
    if (before) settings.mutate({ ...before, ...patch });

    void update.run(patch).then((saved) => {
      if (!saved && before) settings.mutate(before);
    });
  }

  return (
    <div className="flex flex-col gap-stack px-gutter pt-4 pb-6">
      {current === undefined ? (
        <Skeleton className="h-64 rounded-xl" />
      ) : (
        <SettingsGroup
          title="Today’s log"
          footer="Switch off what you never record and the Today screen is only what you use. Nothing already recorded is removed — the days stay on the calendar, in the export and in Insights, and switching a section back on finds them where they were."
        >
          {TODAY_CATEGORIES.map((category) => (
            <SettingsRow key={category}>
              <div className="min-w-0 flex-1">
                <label htmlFor={`period-section-${category}`} className="block text-sm font-medium">
                  {TODAY_CATEGORY_LABEL[category]}
                </label>
                <p className="pt-0.5 text-xs text-muted-foreground">{TODAY_CATEGORY_HINT[category]}</p>
              </div>
              <Switch
                id={`period-section-${category}`}
                aria-label={TODAY_CATEGORY_LABEL[category]}
                checked={isTodayCategoryVisible(current, category)}
                onCheckedChange={(next) => setVisible(category, next)}
              />
            </SettingsRow>
          ))}
        </SettingsGroup>
      )}

      {current === undefined ? (
        <Skeleton className="h-64 rounded-xl" />
      ) : (
        <SettingsGroup
          title="Symptoms &amp; mood"
        >
          <OptionListEditor
            title="Symptom options"
            hint="The chips the Symptoms section offers, in this order."
            options={current.symptomOptions}
            defaults={PERIOD_SYMPTOMS}
            onChange={(next) => setOptions('symptomOptions', next)}
          />
          <OptionListEditor
            title="Mood options"
            hint="The chips the Mood section offers, in this order."
            options={current.moodOptions}
            defaults={PERIOD_MOODS}
            onChange={(next) => setOptions('moodOptions', next)}
          />
        </SettingsGroup>
      )}
    </div>
  );
}

/**
 * One editable chip vocabulary.
 *
 * ## Renaming is a label edit, not a data migration
 *
 * The day log stores the word that was on the chip, so renaming `cramps` to
 * `period cramps` leaves every past day saying `cramps` — which still renders,
 * as one of "your own". That is the deliberate reading of "the options are
 * labels, not foreign keys": the alternative, rewriting history on a rename,
 * would invent an observation the user did not record.
 *
 * ## Why the rows commit on blur
 *
 * A write per keystroke would send the whole list for every character and make
 * two quick renames race. Each row keeps its own text and commits when the field
 * is left (or Enter is pressed), exactly like the day log's number fields.
 */
function OptionListEditor({
  title,
  hint,
  options,
  defaults,
  onChange,
}: {
  title: string;
  hint: string;
  options: string[];
  defaults: readonly string[];
  onChange: (next: string[]) => void;
}) {
  const [draft, setDraft] = useState('');

  function rename(index: number, word: string): boolean {
    if (word === '' || options.some((entry, i) => i !== index && entry === word)) return false;
    onChange(options.map((entry, i) => (i === index ? word : entry)));
    return true;
  }

  function add() {
    const word = draft.trim();
    if (word === '' || options.includes(word)) return;
    onChange([...options, word]);
    setDraft('');
  }

  return (
    <SettingsRow stacked>
      <div className="flex items-baseline gap-2">
        <span className="min-w-0 flex-1 text-sm font-medium">{title}</span>
        <span className="shrink-0 text-xs text-muted-foreground">
          {options.length} {options.length === 1 ? 'option' : 'options'}
        </span>
      </div>
      <p className="text-xs text-muted-foreground">{hint}</p>

      <div className="flex flex-col gap-2">
        {options.map((option, index) => (
          <OptionRow
            key={option}
            option={option}
            onRename={(word) => rename(index, word)}
            onRemove={() => onChange(options.filter((_, i) => i !== index))}
          />
        ))}
        {options.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No options left — add one below, or restore the defaults.
          </p>
        ) : null}
      </div>

      <div className="flex items-center gap-2">
        <Input
          aria-label={`Add a ${title.toLowerCase()} chip`}
          value={draft}
          placeholder="e.g. migraine"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              add();
            }
          }}
          className="h-9 min-w-0 flex-1"
        />
        <Button type="button" variant="outline" size="sm" className="h-9 shrink-0 gap-1" onClick={add}>
          <PlusIcon className="size-4 text-base" />
          Add
        </Button>
      </div>

      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-8 w-fit px-2 text-muted-foreground"
        onClick={() => onChange([...defaults])}
      >
        Restore the default options
      </Button>
    </SettingsRow>
  );
}

/** One option: an editable name and a remove control. */
function OptionRow({
  option,
  onRename,
  onRemove,
}: {
  option: string;
  onRename: (word: string) => boolean;
  onRemove: () => void;
}) {
  const [text, setText] = useState(option);

  /* Re-seed when the list changes under us (a rename accepted elsewhere, a
     restore), never on every render — that would fight the caret. */
  useEffect(() => setText(option), [option]);

  function commit() {
    const word = text.trim();
    if (word === option) return;
    if (!onRename(word)) setText(option);
  }

  return (
    <div className="flex items-center gap-2">
      <Input
        aria-label={`Rename ${option}`}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            event.currentTarget.blur();
          }
        }}
        className="h-9 min-w-0 flex-1"
      />
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-9 w-9 shrink-0 px-0 text-muted-foreground"
        aria-label={`Remove ${option}`}
        onClick={onRemove}
      >
        <Cross1Icon className="size-4 text-base" />
      </Button>
    </div>
  );
}
