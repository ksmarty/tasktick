'use client';

/**
 * Period settings: the model knobs, the contraception context, and the data.
 *
 * ## Why these three knobs and not more
 *
 * The prediction is derived, so the things a user can legitimately change about it
 * are the two assumptions it rests on and one fact about their situation:
 *
 *  · **Luteal phase length** — ovulation is *next period minus the luteal phase*,
 *    so this one number moves the ovulation and fertile-window estimates. 14 is
 *    the population mean; 12–14 is the usual range, which is why the control offers
 *    exactly that and the copy says so rather than presenting it as a preference.
 *  · **How many cycles to use** — recent cycles describe the body a person has
 *    now. The "all of them" option is offered explicitly and named, because it is
 *    the honest default for someone with four cycles and the wrong one for someone
 *    with forty.
 *  · **Contraception in use** — this does not change the arithmetic, it changes
 *    what the arithmetic *means*. A hormonal method suppresses ovulation, so a
 *    calendar fertility estimate is not a statement about fertility; the setting is
 *    what lets the prediction say so in words (see `PredictionSummary`).
 *
 * Everything else about the model is stated, not configured: the recency weighting
 * and the uncertainty floor are in `@/lib/period-math` with their sources, and
 * exposing them as sliders would let a user tune their way to a confident-looking
 * wrong date.
 *
 * ## The switch, the import, and the way out
 *
 * The same `PeriodModeCard` the app's settings show is at the top here, so turning
 * the mode off is possible from inside it. Import/export is below, and the footer
 * row repeats the link back to tasks — the app bar's control is the primary way
 * out, and this is the second place it exists rather than a third mechanism.
 *
 * The header is published here and nowhere else on this route: the shell renders
 * the single app bar (with the exit control on every period screen), and a screen
 * that published none would leave the user with no title and — worse — no exit.
 */
import { useRouter } from 'next/navigation';
import { PageHeader } from '@/components/app/PageHeader';
import { SegmentedControl, type SegmentedOption } from '@/components/godui/segmented-control';
import { useToast } from '@/components/app/Toast';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { isHormonalMethod } from '@/lib/period-math';
import { SettingsGroup, SettingsRow } from '@/components/settings';
import { ContraceptionCard } from './ContraceptionCard';
import { ImportCard } from './ImportCard';
import { PeriodModeCard } from './PeriodModeCard';
import { useContraceptionMethods, usePeriodSettings, useUpdatePeriodSettings } from './data';

/** 12–14 is the usual range, 14 the mean; the ends are offered so nobody is stuck. */
const LUTEAL_OPTIONS: SegmentedOption[] = [12, 13, 14, 15, 16].map((days) => ({
  value: String(days),
  label: `${days}`,
}));

/**
 * How many cycles feed the estimate.
 *
 * `all` is its own option and is labelled in words rather than shown as an empty
 * field — the contract stores it as `null`, and a blank control that means
 * "everything" is a control nobody can read.
 */
const CYCLE_COUNT_OPTIONS: SegmentedOption[] = [
  { value: 'all', label: 'All' },
  { value: '3', label: '3' },
  { value: '6', label: '6' },
  { value: '12', label: '12' },
];

export function PeriodSettings() {
  const router = useRouter();
  const { toast } = useToast();
  const settings = usePeriodSettings();
  const methods = useContraceptionMethods();
  const current = settings.data;

  /*
   * The server's prediction treats an active hormonal method as contraception in
   * use even when the switch is off — the switch is the user's own statement, the
   * method list is a record. Those two can legitimately disagree, and when they do
   * the screen has to say so rather than showing "Off" next to a card that warns
   * about a method suppressing ovulation.
   */
  const hormonalMethodActive = (methods.data ?? []).some(
    (method) => method.endDate === null && isHormonalMethod(method.method),
  );

  const update = useUpdatePeriodSettings({
    onError: (message) => toast({ title: 'Could not save that', description: message, variant: 'error' }),
  });

  return (
    <>
      <PageHeader title="Period settings" />

      <div className="flex flex-col gap-stack px-gutter pt-4 pb-6">
      <PeriodModeCard variant="period" />

      {current === undefined ? (
        <>
          <Skeleton className="h-32 rounded-xl" />
          <Skeleton className="h-24 rounded-xl" />
        </>
      ) : (
        <>
          <SettingsGroup
            title="Prediction"
            footer="Ovulation is estimated as the next period minus the luteal phase, so the luteal length moves the ovulation and fertile-window estimates — not the predicted period itself."
          >
            <SettingsRow stacked>
              <div className="flex items-baseline gap-2">
                <span className="min-w-0 flex-1 text-sm font-medium">Luteal phase</span>
                <span className="shrink-0 text-xs text-muted-foreground">{current.lutealPhaseDays} days</span>
              </div>
              <SegmentedControl
                aria-label="Luteal phase length in days"
                className="w-full [&>button]:flex-1"
                options={LUTEAL_OPTIONS}
                value={String(current.lutealPhaseDays)}
                onChange={(value) => void update.run({ lutealPhaseDays: Number(value) })}
              />
              <p className="text-xs text-muted-foreground">
                14 is the population mean and 12–14 the usual range. It is the most stable part of a cycle for one
                person, which is why it is a setting rather than a constant.
              </p>
            </SettingsRow>

            <SettingsRow stacked>
              <div className="flex items-baseline gap-2">
                <span className="min-w-0 flex-1 text-sm font-medium">Cycles used</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {current.predictionCycleCount === null ? 'all of them' : `last ${current.predictionCycleCount}`}
                </span>
              </div>
              <SegmentedControl
                aria-label="How many cycles feed the prediction"
                className="w-full [&>button]:flex-1"
                options={CYCLE_COUNT_OPTIONS}
                value={current.predictionCycleCount === null ? 'all' : String(current.predictionCycleCount)}
                onChange={(value) =>
                  void update.run({ predictionCycleCount: value === 'all' ? null : Number(value) })
                }
              />
              <p className="text-xs text-muted-foreground">
                Recent cycles describe the body you have now; a cycle from three years ago may describe a body that no
                longer exists. Fewer cycles react faster and are noisier.
              </p>
            </SettingsRow>
          </SettingsGroup>

          <SettingsGroup
            title="Contraception in use"
            footer="This does not change the arithmetic — it changes what the arithmetic means. While a hormonal method is in use, a calendar fertility estimate is not a statement about fertility."
          >
            <SettingsRow>
              <div className="min-w-0 flex-1">
                <label htmlFor="period-contraception-in-use" className="block text-sm font-medium">
                  Using contraception
                </label>
                <p className="pt-0.5 text-xs text-muted-foreground">
                  {current.contraceptionInUse
                    ? 'On. Predictions are labelled so a fertile-window estimate is not read as a contraceptive guarantee.'
                    : hormonalMethodActive
                      ? 'Off — but a hormonal method below is still in use, so predictions already treat contraception as in use. Turn this on to say so explicitly.'
                      : 'Off. The calendar method on its own has a typical-use failure rate of about 24% a year — it is not a contraceptive plan.'}
                </p>
              </div>
              <Switch
                id="period-contraception-in-use"
                aria-label="Using contraception"
                checked={current.contraceptionInUse}
                onCheckedChange={(next) => void update.run({ contraceptionInUse: next })}
              />
            </SettingsRow>
          </SettingsGroup>

          <ContraceptionCard />

          <ImportCard />
        </>
      )}

      <SettingsGroup
        title="Leaving"
        footer="The period interface is a mode, not a separate app: turning it off keeps every record, and the app bar on any period screen has a one-tap way back to your tasks."
      >
        <SettingsRow>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">Back to tasks</p>
            <p className="pt-0.5 text-xs text-muted-foreground">
              Opens the task list without changing this setting. The app will still open in the period interface.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-9 shrink-0"
            onClick={() => router.push('/tasks')}
          >
            Tasks
          </Button>
        </SettingsRow>
      </SettingsGroup>
      </div>
    </>
  );
}
