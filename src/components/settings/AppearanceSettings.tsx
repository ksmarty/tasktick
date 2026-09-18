'use client';

/**
 * Appearance: theme and accent, applied the instant they are touched.
 *
 * ## The colour scheme belongs to MUI
 *
 * The theme is read and written through `useColorScheme()` — never by reading
 * the `tasktick-theme` cookie or toggling a `dark` class. MUI owns the
 * preference, persists it, and swaps the palette class on `<html>`; the
 * `Providers` wrapper mirrors the resolved value into the cookie purely so the
 * next request can paint the right `theme-color` before any script runs.
 *
 * The two halves deliberately differ in when they "take". `setMode`/`setAccent`
 * apply immediately — that instant feedback is the whole point of a theme picker
 * — while the PATCH to `/api/settings` is what makes the choice survive on
 * another device. If that PATCH fails, the toast says so and the preference stays
 * applied locally rather than snapping back.
 *
 * ## The accent is now a stored preference only
 *
 * Since the app adopted Material's palette, `accent` no longer drives the colour
 * of the UI — every control takes its colour from the theme. The control is kept
 * rather than deleted because the value is still a real stored preference that
 * other surfaces read (calendar/list colours are user data chosen from the same
 * palette), and silently removing a user-facing setting is not a migration step.
 * It is labelled as what it is so it cannot be mistaken for a live theme control.
 */
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import ListItem from '@mui/material/ListItem';
import Typography from '@mui/material/Typography';
import { useColorScheme } from '@mui/material/styles';
import CheckIcon from '@mui/icons-material/Check';
import DarkModeIcon from '@mui/icons-material/DarkMode';
import LightModeIcon from '@mui/icons-material/LightMode';
import MonitorIcon from '@mui/icons-material/Monitor';
import { useToast } from '@/components/app/Toast';
import { api } from '@/lib/api-client';
import { useMutation } from '@/lib/store';
import { ACCENT_LABEL, accentHex } from '@/lib/colors';
import { useAppearance } from '@/app/providers';
import { ACCENT_COLORS, type AccentColor, type UserSettings } from '@/lib/types';
import { SettingsGroup } from './SettingsGroup';
import { SWATCH_GROUP_SX, swatchSx } from './swatches';

type ThemePreference = 'light' | 'dark' | 'system';

const THEME_OPTIONS: { value: ThemePreference; label: string; Icon: typeof LightModeIcon }[] = [
  { value: 'light', label: 'Light', Icon: LightModeIcon },
  { value: 'dark', label: 'Dark', Icon: DarkModeIcon },
  { value: 'system', label: 'Auto', Icon: MonitorIcon },
];

export function AppearanceSettings() {
  const { mode, colorScheme, setMode } = useColorScheme();
  const { accent, setAccent } = useAppearance();
  const { toast } = useToast();

  // MUI's `mode` is the preference; `colorScheme` is the resolved appearance
  // after the system preference has been folded in. They differ only for "Auto".
  const theme: ThemePreference = mode === 'light' || mode === 'dark' ? mode : 'system';
  const dark = colorScheme === 'dark';

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

  return (
    <SettingsGroup title="Appearance" footer="The theme follows Material Design; Auto tracks your device's light or dark setting.">
      <ListItem sx={{ display: 'block', px: 2, py: 1.5 }}>
        <ToggleButtonGroup
          exclusive
          fullWidth
          size="small"
          value={theme}
          onChange={(_event, next: ThemePreference | null) => {
            if (!next) return;
            setMode(next);
            void persist.run({ theme: next });
          }}
          aria-label="Theme"
        >
          {THEME_OPTIONS.map(({ value, label, Icon }) => (
            <ToggleButton key={value} value={value} sx={{ gap: 0.75 }}>
              <Icon fontSize="small" aria-hidden />
              {label}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>

        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', px: 1, pt: 0.75 }}>
          {theme === 'system'
            ? `Following the system: ${dark ? 'dark' : 'light'}.`
            : `${dark ? 'Dark' : 'Light'} appearance.`}
        </Typography>
      </ListItem>

      <ListItem sx={{ display: 'block', px: 2, py: 1.5 }}>
        <Typography variant="body1" id="accent-colour-label" sx={{ px: 1, pb: 1 }}>
          Accent colour
        </Typography>

        {/*
         * Retained as a stored preference: the app takes Material's palette now,
         * so this no longer recolours the app's controls. It is kept because the
         * value is persisted and read elsewhere; see the file header.
         */}
        <ToggleButtonGroup
          exclusive
          value={accent}
          onChange={(_event, next: AccentColor | null) => {
            if (!next) return;
            setAccent(next);
            void persist.run({ accent: next });
          }}
          aria-labelledby="accent-colour-label"
          sx={[SWATCH_GROUP_SX, { px: 1 }]}
        >
          {ACCENT_COLORS.map((color) => {
            const swatch = accentHex(color, dark);
            return (
              <ToggleButton key={color} value={color} aria-label={ACCENT_LABEL[color]} sx={swatchSx(swatch)}>
                {color === accent ? <CheckIcon fontSize="small" aria-hidden /> : null}
              </ToggleButton>
            );
          })}
        </ToggleButtonGroup>

        <Typography variant="caption" color="text.disabled" sx={{ display: 'block', px: 1, pt: 1 }}>
          Remembered for you and kept in sync across devices. The app itself now uses Material&rsquo;s palette, so
          this no longer changes the colour of buttons or highlights.
        </Typography>
      </ListItem>
    </SettingsGroup>
  );
}
