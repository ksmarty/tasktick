'use client';

/**
 * Appearance: the theme, and the accent preference that no longer has anything
 * to recolour.
 *
 * ## The colour scheme
 *
 * The theme is read and written through `useAppearance()` — never by reading the
 * `tasktick-theme` cookie or toggling a `dark` class here. That hook owns the
 * preference, persists it and mirrors the resolved value into the cookie so the
 * next request can paint the right `theme-color` before any script runs; the
 * `dark` class on `<html>` is the only rendering input the palette reads. This
 * screen only chooses among the three values and PATCHes the same value to
 * `/api/settings` so the choice survives on another device.
 *
 * The two halves deliberately differ in when they "take". Choosing a theme
 * applies immediately — that instant feedback is the whole point of a theme
 * picker — while the PATCH is what makes it stick. If that PATCH fails, the
 * toast says so and the preference stays applied locally rather than snapping
 * back.
 *
 * ## The accent
 *
 * The accent re-points `--primary`, `--primary-foreground` and `--ring` at one of
 * the twelve iOS system colours (see the block in `globals.css`), so every control
 * that already reads those tokens follows: buttons, the tab bar's sliding blob,
 * chips, switches, the calendar's selected day, focus rings.
 *
 * It was disabled for a while. When the app moved onto GodUI's Celestial Sapphire
 * palette — which is monochrome — the picker could not recolour anything, and a
 * swatch that highlights while changing nothing is indistinguishable from a broken
 * control. The preference was kept rather than deleted precisely so it could be
 * switched back on, which took one prop.
 */
import { ColorWheelIcon } from '@svg-animated-icons/react/color-wheel';
import { DesktopIcon } from '@svg-animated-icons/react/desktop';
import { MoonIcon } from '@svg-animated-icons/react/moon';
import { SunIcon } from '@svg-animated-icons/react/sun';
import { SegmentedControl, type SegmentedOption } from '@/components/godui/segmented-control';
import { useToast } from '@/components/app/Toast';
import { api } from '@/lib/api-client';
import { useMutation } from '@/lib/store';
import type { AccentPreference } from '@/lib/types';
import { useAppearance } from '@/app/providers';
import type { AccentColor, UserSettings } from '@/lib/types';
import { SettingsGroup, SettingsRow } from './SettingsGroup';
import { AccentSwatches } from './swatches';

type ThemePreference = 'light' | 'dark' | 'system';

const THEME_OPTIONS: SegmentedOption[] = [
  { value: 'light', label: 'Light', icon: <SunIcon /> },
  { value: 'dark', label: 'Dark', icon: <MoonIcon /> },
  { value: 'system', label: 'Auto', icon: <DesktopIcon /> },
];

export function AppearanceSettings() {
  const { theme, resolvedTheme, accent, setTheme, setAccent } = useAppearance();
  const { toast } = useToast();

  // `resolvedTheme` is the appearance after the system preference has been folded
  // in; the two differ only for "Auto".
  const dark = resolvedTheme === 'dark';

  const persist = useMutation(
    async (patch: { theme?: ThemePreference; accent?: AccentPreference }) =>
      api.patch<UserSettings>('/api/settings', patch),
    {
      invalidates: ['/api/settings', '/api/bootstrap'],
      onError: (message) =>
        toast({
          title: 'Saved on this device only',
          description: message,
          variant: 'error',
        }),
    },
  );

  /**
   * The accent is stored rather than applied here: the value lives on `<html>` as
   * `data-accent` and the palette rules in `globals.css` do the rest.
   */
  function chooseAccent(next: AccentPreference) {
    setAccent(next);
    void persist.run({ accent: next });
  }

  return (
    <SettingsGroup
      title="Appearance"
      footer="Auto follows your device's light or dark setting. The palette itself is fixed."
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
        <p id="accent-colour-label" className="flex items-center gap-2 text-sm font-medium">
          <ColorWheelIcon className="text-muted-foreground" />
          Accent colour
        </p>

        {/*
          * `default` is the app's own monochrome primary, and the swatches express
          * "no accent" as `null` — so the two are mapped at this boundary rather
          * than teaching the swatch component about a preference it does not own.
          */}
        <AccentSwatches
          value={accent === 'default' ? null : accent}
          onChange={(next) => chooseAccent(next ?? 'default')}
          includeDefault
          dark={dark}
          labelledBy="accent-colour-label"
        />

        <p className="text-xs text-muted-foreground">
          Used for buttons, the tab bar, chips, switches and focus rings. Each colour has a darker variant for the
          dark appearance, so nothing loses contrast when you switch.
        </p>
      </SettingsRow>
    </SettingsGroup>
  );
}
