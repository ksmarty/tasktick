'use client';

/**
 * The opt-in switch for the whole interface.
 *
 * ## Where it lives, and why
 *
 * In the app's Settings, under **Appearance** — with the theme and accent, because
 * enabling the mode is a look/behaviour choice (a whole second interface) rather
 * than a feature with its own settings, and the user asked for it there. The same
 * component is also the switch *inside* the mode (`/period/settings`), because the
 * one thing a user must always be able to do is reverse a choice they made:
 * turning it off closes the interface, keeps every record, and returns to the task
 * list.
 *
 * ## Turning it on takes you in
 *
 * Enabling a separate interface and leaving the user on the settings page would
 * leave them wondering whether anything happened. So enabling navigates to
 * `/period` — the log screen — and disabling navigates to `/tasks`, which is the
 * honest "you are back in the app now". Neither is a redirect loop: `/tasks`
 * resolves whether or not the mode is on.
 *
 * ## What "off" does not do
 *
 * Nothing is deleted. The period tables keep their rows, the settings keep their
 * values, and turning it back on finds everything as it was. The switch gates the
 * *interface*, which is exactly what the user asked for — an optional separate
 * interface — and never the data.
 */
import { useRouter } from 'next/navigation';
import { HeartIcon } from '@svg-animated-icons/react/heart';
import { useToast } from '@/components/app/Toast';
import { Switch } from '@/components/ui/switch';
import { SettingsGroup, SettingsRow } from '@/components/settings';
import { useUpdatePeriodSettings, usePeriodSettings } from './data';

export function PeriodModeCard() {
  const router = useRouter();
  const { toast } = useToast();
  const settings = usePeriodSettings();
  const enabled = settings.data?.enabled ?? false;

  const update = useUpdatePeriodSettings({
    onError: (message) =>
      toast({ title: 'Could not change that', description: message, variant: 'error' }),
  });

  /**
   * Flips the switch.
   *
   * ## The optimistic write is not a flourish
   *
   * The settings live in the client store, and every other reader of them — the
   * period layout's deep-link guard, the "open period mode" row below — reads that
   * same cached entry. `invalidate()` marks an entry stale but keeps serving the
   * old value until something refetches, so without writing here the cache would
   * still say `enabled: false` at the moment the router enters `/period`, and the
   * guard would bounce the user straight back out of the screen they just turned
   * on. Writing the intended value through first makes the whole UI agree with the
   * switch immediately; the server's own answer replaces it a moment later, and a
   * failure reverts it.
   */
  function setEnabled(next: boolean) {
    const before = settings.data;
    if (before) settings.mutate({ ...before, enabled: next });

    void update.run({ enabled: next }).then((saved) => {
      if (!saved) {
        if (before) settings.mutate(before);
        return;
      }
      if (next) router.push('/period');
      else router.push('/tasks');
    });
  }

  /*
   * **One switch, identical in both interfaces.**
   *
   * There used to be two variants: the app's copy carried an "Open the period
   * interface" button The user
   * asked for neither — a button that names a destination is not a mode switch, and
   * two different cards cannot be the same switch. The switch itself already goes
   * where it says (`/period` on, `/tasks` off), so the buttons were a second way to
   * do what the switch had just done.
   *
   * The label and the hint are therefore state, not destination: they say which
   * interface you are in, which is true from either side and reads the same from
   * either side.
   */
  return (
    <SettingsGroup title="Interface">
      <SettingsRow>
        <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-foreground">
          <HeartIcon className="size-5 text-xl" />
        </span>

        <div className="min-w-0 flex-1">
          <label htmlFor="period-mode-switch" className="block text-sm font-medium">
            Period interface
          </label>
          <p className="pt-0.5 text-xs text-muted-foreground">
            {enabled ? 'On — showing cycle tracking' : 'Off — showing tasks'}
          </p>
        </div>

        <Switch
          id="period-mode-switch"
          aria-label="Period interface"
          checked={enabled}
          disabled={settings.isInitialLoading}
          onCheckedChange={setEnabled}
        />
      </SettingsRow>
    </SettingsGroup>
  );
}