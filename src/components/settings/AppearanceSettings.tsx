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
 * ## The accent is a stored preference with nothing to drive
 *
 * Since the app adopted GodUI's palette, `accent` no longer colours the UI: the
 * Celestial Sapphire palette is monochrome, so there is no accent hue — `primary`
 * is near-black in light mode and near-white in dark. The control is therefore
 * rendered **disabled** with a one-line explanation. It is deliberately neither
 * deleted (the value is still a real stored preference that other surfaces read,
 * and silently removing a user-facing setting is not a migration step) nor left
 * live and dead (a swatch that highlights and recolours nothing is indistinguishable
 * from a broken control).
 *
 * The storage path is left intact: `setAccent` still writes the preference to the
 * client store and the cookie, and the mutation below still accepts `accent`, so
 * re-enabling the picker is one prop and no plumbing.
 */
import { ColorWheelIcon } from '@svg-animated-icons/react/color-wheel';
import { DesktopIcon } from '@svg-animated-icons/react/desktop';
import { MoonIcon } from '@svg-animated-icons/react/moon';
import { SunIcon } from '@svg-animated-icons/react/sun';
import { SegmentedControl, type SegmentedOption } from '@/components/godui/segmented-control';
import { useToast } from '@/components/app/Toast';
import { api } from '@/lib/api-client';
import { useMutation } from '@/lib/store';
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
    async (patch: { theme?: ThemePreference; accent?: AccentColor }) =>
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
   * Kept whole so the accent preference can still be stored. The picker below is
   * disabled, so this never runs today — see the file header.
   */
  function chooseAccent(next: AccentColor) {
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
         * Disabled on purpose: the palette is monochrome, so this cannot recolour
         * anything. The stored value is still shown so it is clear what is saved.
         */}
        <AccentSwatches
          value={accent}
          onChange={chooseAccent}
          disabled
          dark={dark}
          labelledBy="accent-colour-label"
        />

        <p className="text-xs text-muted-foreground">
          Fixed palette: this app uses Celestial Sapphire, which is monochrome and has no accent hue, so this no
          longer changes anything. Your saved value is kept for the things that still read it.
        </p>
      </SettingsRow>
    </SettingsGroup>
  );
}
