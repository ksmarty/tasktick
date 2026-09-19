'use client';

/**
 * Motion: the in-app reduced-motion preference.
 *
 * The OS `prefers-reduced-motion` query is honoured by every animation library,
 * but this is a self-hosted app: a user may want less motion here without
 * changing the setting for the whole device. So the preference is an explicit
 * choice, and the effective value folds it with the OS:
 *
 *   `Reduce motion` -> always reduced; `Follow system` -> whatever the OS asks.
 *
 * There is deliberately no "force motion on" option — an OS request to reduce is
 * a floor, never overridden.
 *
 * ## Low Power Mode is a heuristic, and says so
 *
 * iOS throttles `requestAnimationFrame` under Low Power Mode and offers no API
 * for it. The inference measures frame timing and is therefore approximate: a
 * busy main thread or a 30 fps display reads the same way. It is opt-in, off by
 * default, and labelled experimental — a guess must never change behaviour
 * silently.
 *
 * The change applies through `@/lib/motion` immediately (so it takes effect on
 * this screen and everywhere else) and is then persisted to `/api/settings`.
 */
import { useEffect, useState } from 'react';
import { DesktopIcon } from '@svg-animated-icons/react/desktop';
import { PauseIcon } from '@svg-animated-icons/react/pause';
import { SegmentedControl, type SegmentedOption } from '@/components/godui/segmented-control';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/components/app/Toast';
import { api } from '@/lib/api-client';
import { applyServerMotionPreferences, setMotionPreferences, useMotionPreferences } from '@/lib/motion';
import { useMutation, useResource } from '@/lib/store';
import type { ReducedMotionPreference, UserSettings } from '@/lib/types';
import type { SettingsPayload } from '@/lib/view-types';
import { SettingsGroup, SettingsRow } from './SettingsGroup';

const MOTION_OPTIONS: SegmentedOption[] = [
  { value: 'system', label: 'Follow system', icon: <DesktopIcon /> },
  { value: 'reduce', label: 'Reduce motion', icon: <PauseIcon /> },
];

export function MotionSettings() {
  const { toast } = useToast();
  const preferences = useMotionPreferences();
  const settings = useResource<SettingsPayload>('/api/settings');

  /*
   * The cookie seeds the store before any request, but the database is the
   * account-level truth. Once the settings arrive, adopt them — this is what
   * carries the preference to a device that has never seen the cookie.
   */
  useEffect(() => {
    const saved = settings.data?.settings;
    if (!saved) return;
    applyServerMotionPreferences(saved.reducedMotion, saved.reduceMotionLowPower);
  }, [settings.data?.settings]);

  const persist = useMutation(
    async (patch: { reducedMotion?: ReducedMotionPreference; reduceMotionLowPower?: boolean }) =>
      api.patch<UserSettings>('/api/settings', patch),
    {
      invalidates: ['/api/settings', '/api/bootstrap'],
      onError: (message) =>
        toast({ title: 'Could not save the motion preference', description: message, variant: 'error' }),
    },
  );

  const [lowPowerBusy, setLowPowerBusy] = useState(false);

  function choosePreference(next: ReducedMotionPreference) {
    setMotionPreferences({ reducedMotion: next });
    void persist.run({ reducedMotion: next });
  }

  function toggleLowPower(next: boolean) {
    setMotionPreferences({ reduceMotionLowPower: next });
    setLowPowerBusy(true);
    persist.run({ reduceMotionLowPower: next }).finally(() => setLowPowerBusy(false));
  }

  return (
    <SettingsGroup
      title="Motion"
      footer="Reduced motion removes entrance and spring animations. Following the system also honours your device's own setting."
    >
      <SettingsRow stacked>
        <SegmentedControl
          aria-label="Reduced motion"
          className="w-full [&>button]:flex-1"
          options={MOTION_OPTIONS}
          value={preferences.reducedMotion}
          onChange={(next) => choosePreference(next as ReducedMotionPreference)}
        />
        <p className="text-xs text-muted-foreground">
          {preferences.reducedMotion === 'reduce'
            ? 'Animations are reduced on this account, whatever the device is set to.'
            : 'Animations follow the device’s own reduced-motion setting.'}
        </p>
      </SettingsRow>

      <SettingsRow>
        <div className="min-w-0 flex-1">
          <Label htmlFor="low-power-motion" className="block">
            Also reduce in Low Power Mode
          </Label>
          <p className="pt-0.5 text-xs text-muted-foreground">
            Experimental: infers Low Power Mode from slowed animation frames. A busy page or a 30 fps display can
            trigger it, so it is off unless you ask for it.
          </p>
        </div>
        <Switch
          id="low-power-motion"
          aria-label="Also reduce motion in Low Power Mode"
          checked={preferences.reduceMotionLowPower}
          disabled={lowPowerBusy}
          onCheckedChange={(next) => toggleLowPower(next)}
        />
      </SettingsRow>
    </SettingsGroup>
  );
}
