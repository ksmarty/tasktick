'use client';

/**
 * Demo mode — see the app populated, without touching your own data.
 *
 * ## How it works
 *
 * The switch sets a **boolean cookie**. `route()` (`src/server/http.ts`) reads it
 * and runs the request as the sample account instead of the signed-in one — reads
 * and writes both. So the app is fully interactive: tick a task off, log a day,
 * check in a habit, and the UI responds exactly as it normally would, while
 * nothing you do can reach your own rows.
 *
 * The cookie carries **only a boolean**. The sample account is resolved on the
 * server from a fixed address, so a forged cookie reaches the sample data and
 * nothing else.
 *
 * ## Why a cookie rather than a stored setting
 *
 * `route()` runs on every API call. Reading a column would mean a database query
 * per request just to decide whose data to read; the cookie is already in the
 * request.
 *
 * ## Why the warning is a banner and not a footnote
 *
 * In demo mode a write looks like it worked and does not persist. Someone who
 * forgets they are in it and wonders why their edit vanished is the failure this
 * screen exists to prevent, so the state is stated where they cannot miss it and
 * the switch is right beside it.
 */
import { useEffect, useState } from 'react';
import { SettingsGroup, SettingsRow } from './SettingsGroup';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';

/** Must match `DEMO_COOKIE` in `src/server/demo.ts`. */
const DEMO_COOKIE = 'tasktick-demo';

function readDemoCookie(): boolean {
  if (typeof document === 'undefined') return false;
  return document.cookie.split('; ').some((part) => part === `${DEMO_COOKIE}=1`);
}

function writeDemoCookie(on: boolean): void {
  const base = `${DEMO_COOKIE}=${on ? '1' : '0'}; path=/; max-age=${on ? 60 * 60 * 24 * 30 : 0}; samesite=lax`;
  document.cookie = base;
}

export function DemoModeCard() {
  const [on, setOn] = useState(false);

  // Read after mount: the server cannot know the cookie without a request, and
  // guessing would make the switch flicker.
  useEffect(() => {
    setOn(readDemoCookie());
  }, []);

  return (
    <SettingsGroup
      title="Demo mode"
      footer="Shows a sample account with tasks, events, habits and cycle history. Nothing you do here is saved, and your own data is never read or changed."
    >
      <SettingsRow stacked>
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <Label htmlFor="demo-mode-switch" className="block text-sm font-medium">
              Demo mode
            </Label>
            <p className="pt-0.5 text-xs text-muted-foreground">
              {on ? 'On — you are looking at sample data' : 'Off — you are looking at your own data'}
            </p>
          </div>
          <Switch
            id="demo-mode-switch"
            aria-label="Demo mode"
            checked={on}
            onCheckedChange={(next) => {
              writeDemoCookie(next);
              setOn(next);
              /*
               * A full reload, deliberately. The swap happens on the server, so the
               * screens already rendered are showing the *other* account's data; a
               * client-side navigation would leave a mix of the two on screen.
               */
              window.location.reload();
            }}
          />
        </div>
      </SettingsRow>
    </SettingsGroup>
  );
}

/**
 * The standing indicator while demo mode is on.
 *
 * Rendered by the shell so it is present on every screen, including the period
 * interface — which is the one most likely to be explored in demo mode.
 */
export function DemoModeBanner() {
  const [on, setOn] = useState(false);
  useEffect(() => {
    setOn(readDemoCookie());
  }, []);
  if (!on) return null;

  return (
    <div
      role="status"
      className="flex shrink-0 items-center justify-center gap-2 border-b border-border bg-secondary px-gutter py-1 text-xs font-medium text-secondary-foreground"
    >
      <span
        aria-hidden
        className="size-1.5 rounded-full bg-primary"
      />
      Demo mode — sample data, nothing is saved
    </div>
  );
}
