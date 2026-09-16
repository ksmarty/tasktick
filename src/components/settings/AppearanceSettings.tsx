'use client';

/**
 * Appearance: theme and accent, applied the instant they are touched.
 *
 * The two halves deliberately differ in when they "take". `setTheme`/`setAccent`
 * write a cookie and flip the DOM class immediately — that instant feedback is
 * the whole point of a theme picker — while the PATCH to `/api/settings` is what
 * makes the choice survive on another device. If that PATCH fails, the toast says
 * so and the preference stays applied locally rather than snapping back.
 */
import { Monitor, Moon, Sun } from 'lucide-react';
import { ColorPicker, SegmentedControl, useToast } from '@/components/ui';
import { api } from '@/lib/api-client';
import { useMutation } from '@/lib/store';
import { useAppearance } from '@/app/providers';
import { SettingsGroup } from './SettingsGroup';
import type { AccentColor, UserSettings } from '@/lib/types';

type ThemePreference = 'light' | 'dark' | 'system';

const THEME_OPTIONS: { value: ThemePreference; label: string; icon: typeof Sun }[] = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'Auto', icon: Monitor },
];

export function AppearanceSettings() {
  const { theme, accent, resolvedTheme, setTheme, setAccent } = useAppearance();
  const { toast } = useToast();

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
    <SettingsGroup title="Appearance" footer="The accent colours every control, chart and highlight in TaskTick.">
      <div className="px-4 py-3">
        <SegmentedControl
          options={THEME_OPTIONS}
          value={theme}
          onChange={(next) => {
            setTheme(next);
            void persist.run({ theme: next });
          }}
          label="Theme"
        />
        <p className="pt-2 text-footnote text-secondary">
          {theme === 'system' ? `Following the system: ${resolvedTheme}.` : `${resolvedTheme === 'dark' ? 'Dark' : 'Light'} appearance.`}
        </p>
      </div>

      <div className="hairline-t px-4 py-3">
        <ColorPicker
          value={accent}
          onChange={(next) => {
            setAccent(next);
            void persist.run({ accent: next });
          }}
          label="Accent colour"
        />
      </div>
    </SettingsGroup>
  );
}
