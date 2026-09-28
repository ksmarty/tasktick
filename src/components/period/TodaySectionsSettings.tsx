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
 */
import { useToast } from '@/components/app/Toast';
import { SettingsGroup, SettingsRow } from '@/components/settings';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { TODAY_CATEGORIES } from '@/lib/period-types';
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
    </div>
  );
}
