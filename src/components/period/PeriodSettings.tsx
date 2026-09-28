'use client';

/**
 * Period settings: the navigation, and the sections it selects.
 *
 * ## The same pinned shell as the app's settings
 *
 * The period settings are the app's settings for a second interface, so they use
 * the app's settings shell (`SettingsNav`) rather than a page that scrolls
 * everything past the user. Two pinned rows — a primary group and the sections of
 * that group — sit above one scroll pane (`SettingsScroll`), and every section is
 * a real route, so a deep link selects both rows and the header stays constant
 * (it is published once by `app/(app)/period/settings/layout.tsx`).
 *
 * The grouping is by what the setting is *for*:
 *
 *  · **Interface** — how the mode behaves and looks: the tracking switch and the
 *    way back to tasks, then the theme, accent and week start.
 *  · **Cycle** — the prediction inputs and the contraception context, i.e. the
 *    model and the fact about the user's situation that changes what the model
 *    means.
 *  · **Data** — bring history in or take it out.
 *
 * ## The way out lives here, because that is what the user asked for
 *
 * The shell no longer carries a "← Tasks" control: a user should not be switching
 * back and forth, and the only place to switch interfaces is the settings. So the
 * way back is the **Tracking** section — the default landing of the period
 * settings — and it is reachable from every period screen through the band's (or
 * the rail's) Settings destination. Turning the mode off is the same screen, so
 * neither control can be lost.
 *
 * ## Why these model knobs and not more
 *
 * The prediction is derived, so the things a user can legitimately change about it
 * are the two assumptions it rests on and one fact about their situation:
 *
 *  · **Luteal phase length** — ovulation is *next period minus the luteal phase*,
 *    so this one number moves the ovulation and fertile-window estimates. 14 is
 *    the population mean and 12–14 the usual range, which is why the control
 *    offers exactly that.
 *  · **How many cycles to use** — recent cycles describe the body a person has
 *    now. The "all of them" option is offered explicitly and named, because it is
 *    the honest default for someone with four cycles and the wrong one for someone
 *    with forty.
 *  · **Contraception in use** — this does not change the arithmetic, it changes
 *    what the arithmetic *means*. A hormonal method suppresses ovulation, so a
 *    calendar fertility estimate is not a statement about fertility; the setting
 *    is what lets the prediction say so in words (see `PredictionSummary`).
 *
 * Everything else about the model is stated, not configured: the recency weighting
 * and the uncertainty floor are in `@/lib/period-math` with their sources, and
 * exposing them as sliders would let a user tune their way to a confident-looking
 * wrong date.
 */
import { usePathname } from 'next/navigation';
import { ColorWheelIcon } from '@svg-animated-icons/react/color-wheel';
import { DesktopIcon } from '@svg-animated-icons/react/desktop';
import { MoonIcon } from '@svg-animated-icons/react/moon';
import { SunIcon } from '@svg-animated-icons/react/sun';
import { SettingsNav, type SettingsNavGroup } from '@/components/settings/SettingsTabs';
import { SegmentedControl, type SegmentedOption } from '@/components/godui/segmented-control';
import { useToast } from '@/components/app/Toast';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { api } from '@/lib/api-client';
import { isHormonalMethod } from '@/lib/period-math';
import { useMutation, useResource } from '@/lib/store';
import { useAppearance } from '@/app/providers';
import { SettingsGroup, SettingsRow } from '@/components/settings';
import { AccentSwatches } from '@/components/settings/swatches';
import type { AccentPreference, UserSettings } from '@/lib/types';
import type { BootstrapPayload } from '@/lib/view-types';
import { ContraceptionCard } from './ContraceptionCard';
import { ImportCard } from './ImportCard';
import { PeriodModeCard } from './PeriodModeCard';
import { DemoModeCard } from '@/components/settings/DemoModeCard';
import { useContraceptionMethods, usePeriodSettings, useUpdatePeriodSettings } from './data';

/* -------------------------------------------------------------------------- */
/* the navigation                                                             */
/* -------------------------------------------------------------------------- */

export type PeriodSettingsTab = 'mode' | 'appearance' | 'sections' | 'prediction' | 'contraception' | 'data';

/** The route each section points at. */
const PERIOD_SETTINGS_HREF: Record<PeriodSettingsTab, string> = {
  mode: '/period/settings',
  appearance: '/period/settings/appearance',
  /** Which groups the Today form shows — see `TodaySectionsSettings.tsx`. */
  sections: '/period/settings/sections',
  prediction: '/period/settings/prediction',
  contraception: '/period/settings/contraception',
  data: '/period/settings/data',
};

/** The groups, in the order the primary and sub rows show them. */
const PERIOD_SETTINGS_GROUPS: SettingsNavGroup[] = [
  {
    label: 'Interface',
    sections: [
      { value: 'mode', label: 'Tracking' },
      { value: 'appearance', label: 'Appearance' },
      { value: 'sections', label: 'Log sections' },
    ],
  },
  {
    label: 'Cycle',
    sections: [
      { value: 'prediction', label: 'Prediction' },
      { value: 'contraception', label: 'Contraception' },
    ],
  },
  {
    label: 'Data',
    sections: [{ value: 'data', label: 'Import & export' }],
  },
];

/** The section a pathname represents, or `null` when it is not one. */
export function periodSettingsSectionForPath(pathname: string): PeriodSettingsTab | null {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  const entry = (Object.entries(PERIOD_SETTINGS_HREF) as [PeriodSettingsTab, string][]).find(
    ([, href]) => href === path,
  );
  return entry ? entry[0] : null;
}

export function PeriodSettingsNav({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const active = periodSettingsSectionForPath(pathname) ?? 'mode';

  return (
    <SettingsNav
      groups={PERIOD_SETTINGS_GROUPS}
      href={PERIOD_SETTINGS_HREF}
      active={active}
      primaryLabel="Period settings groups"
      subLabel="Period settings sections"
      prefetch
    >
      {children}
    </SettingsNav>
  );
}

/* -------------------------------------------------------------------------- */
/* Interface → Tracking                                                       */
/* -------------------------------------------------------------------------- */

export function PeriodModeSection() {
  return (
    <div className="flex flex-col gap-stack px-gutter pt-4 pb-6">
      <PeriodModeCard variant="period" />
      {/*
       * Demo mode belongs here rather than in the app's Appearance section: it is a
       * choice about the *period* interface, which is where the user looked for it.
       * It swaps the whole request to the sample account, so switching it on shows
       * a period history worth looking at instead of the empty state.
       */}
      <DemoModeCard />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Interface → Appearance                                                     */
/* -------------------------------------------------------------------------- */

type ThemePreference = 'light' | 'dark' | 'system';

const THEME_OPTIONS: SegmentedOption[] = [
  { value: 'light', label: 'Light', icon: <SunIcon /> },
  { value: 'dark', label: 'Dark', icon: <MoonIcon /> },
  { value: 'system', label: 'Auto', icon: <DesktopIcon /> },
];

const WEEK_START_OPTIONS: SegmentedOption[] = [
  { value: '1', label: 'Monday' },
  { value: '0', label: 'Sunday' },
];

/**
 * The period interface's look, reusing the app's own appearance mechanisms.
 *
 * The theme and accent are the app's: `useAppearance()` owns the preference and
 * the palette rules in `globals.css` read `data-accent`, so the period screens
 * follow whatever is chosen here exactly as the task screens do. The week start
 * is the app's existing `weekStartsOn` — deliberately not a second setting, so
 * the cycle month and the task calendar can never disagree about which day a week
 * begins on.
 */
export function PeriodAppearanceSection() {
  const { theme, resolvedTheme, accent, setTheme, setAccent } = useAppearance();
  const { toast } = useToast();
  const bootstrap = useResource<BootstrapPayload>('/api/bootstrap');
  const settings = bootstrap.data?.settings;
  const dark = resolvedTheme === 'dark';

  const persist = useMutation(
    async (patch: { theme?: ThemePreference; accent?: AccentPreference; weekStartsOn?: 0 | 1 }) =>
      api.patch<UserSettings>('/api/settings', patch),
    {
      invalidates: ['/api/settings', '/api/bootstrap'],
      onError: (message) =>
        toast({ title: 'Saved on this device only', description: message, variant: 'error' }),
    },
  );

  return (
    <div className="flex flex-col gap-stack px-gutter pt-4 pb-6">
      <SettingsGroup
        title="Appearance"
        footer="The period interface shares the app's palette, so this is the same theme and accent the rest of the app uses."
      >
        <SettingsRow stacked>
          <SegmentedControl
            aria-label="Theme"
            className="w-full [&>button]:flex-1"
            options={THEME_OPTIONS}
            value={theme}
            onChange={(next) => {
              setTheme(next as ThemePreference);
              void persist.run({ theme: next as ThemePreference });
            }}
          />

          <p className="text-xs text-muted-foreground">
            {theme === 'system'
              ? `Following the system: ${dark ? 'dark' : 'light'}.`
              : `${dark ? 'Dark' : 'Light'} appearance.`}
          </p>
        </SettingsRow>

        <SettingsRow stacked>
          <p id="period-accent-label" className="flex items-center gap-2 text-sm font-medium">
            <ColorWheelIcon className="text-muted-foreground" />
            Accent colour
          </p>

          <AccentSwatches
            value={accent === 'default' ? null : accent}
            onChange={(next) => {
              const chosen = next ?? 'default';
              setAccent(chosen);
              void persist.run({ accent: chosen });
            }}
            includeDefault
            dark={dark}
            labelledBy="period-accent-label"
          />
        </SettingsRow>

        <SettingsRow stacked>
          <p id="period-week-start-label" className="text-sm font-medium">
            Week starts on
          </p>
          {settings ? (
            <SegmentedControl
              aria-labelledby="period-week-start-label"
              className="w-full [&>button]:flex-1"
              options={WEEK_START_OPTIONS}
              value={String(settings.weekStartsOn)}
              onChange={(value) => void persist.run({ weekStartsOn: value === '1' ? 1 : 0 })}
            />
          ) : (
            <Skeleton className="h-9 w-full rounded-md" />
          )}
          <p className="text-xs text-muted-foreground">
            One setting for both calendars, so the cycle month and the task calendar always agree.
          </p>
        </SettingsRow>
      </SettingsGroup>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Cycle → Prediction                                                         */
/* -------------------------------------------------------------------------- */

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

export function PeriodPredictionSection() {
  const { toast } = useToast();
  const settings = usePeriodSettings();
  const current = settings.data;

  const update = useUpdatePeriodSettings({
    onError: (message) => toast({ title: 'Could not save that', description: message, variant: 'error' }),
  });

  return (
    <div className="flex flex-col gap-stack px-gutter pt-4 pb-6">
      {current === undefined ? (
        <>
          <Skeleton className="h-32 rounded-xl" />
          <Skeleton className="h-24 rounded-xl" />
        </>
      ) : (
        <SettingsGroup
          title="Prediction"
          footer="Ovulation is estimated as the next period minus the luteal phase; the length does not move the predicted period itself."
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
            <p className="text-xs text-muted-foreground">14 is the population mean; 12–14 is the usual range.</p>
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
            <p className="text-xs text-muted-foreground">Fewer cycles react faster and are noisier.</p>
          </SettingsRow>
        </SettingsGroup>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Cycle → Contraception                                                      */
/* -------------------------------------------------------------------------- */

export function PeriodContraceptionSection() {
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
    <div className="flex flex-col gap-stack px-gutter pt-4 pb-6">
      {current === undefined ? (
        <Skeleton className="h-24 rounded-xl" />
      ) : (
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
      )}

      <ContraceptionCard />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Data → Import & export                                                     */
/* -------------------------------------------------------------------------- */

export function PeriodDataSection() {
  return (
    <div className="flex flex-col gap-stack px-gutter pt-4 pb-6">
      <ImportCard />
    </div>
  );
}