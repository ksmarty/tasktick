/**
 * Period mode — where the switch lives, and the one place the UI names it.
 *
 * ## What the mode is
 *
 * Enabling period tracking does not add a fifth tab. It turns the period
 * interface into the app's home: `/` lands on it, and while the user is on a
 * `/period/*` route the bottom band and the desktop rail carry period-specific
 * destinations instead of the task ones. The exit is a control the shell itself
 * puts in the app bar of every period screen — see `PeriodExitButton` and
 * `AppShell`.
 *
 * ## Where the flag comes from
 *
 * `PeriodSettings.enabled`, served by `GET/PATCH /api/period/settings`. That is
 * the period feature's own contract (`src/lib/period-types.ts`), owned by
 * another agent, and this module deliberately does not declare a second copy of
 * it — the client hook in `./usePeriodMode` reads the typed payload directly.
 *
 * ## The cookie
 *
 * The mode has to be known *on the server* for one thing only: the entry route
 * `/` has to send a cold start to `/period` rather than to `/tasks`, and a server
 * redirect cannot wait for a client fetch. So the resolved value is mirrored into
 * a display cookie, exactly as the theme preference is mirrored into
 * `tasktick-theme` (`src/app/providers.tsx`, `src/app/layout.tsx`).
 *
 * The cookie is a **cache, not storage**: `/api/period/settings` remains the
 * source of truth, the shell reads the API on every load, and a stale or missing
 * cookie can only ever send a user to `/tasks` — the safe direction — from where
 * the period interface is one tap away in Settings.
 *
 * ## No directive
 *
 * Deliberately framework-free: the server reads the cookie and the client writes
 * it. The hook that subscribes to the client store lives beside it in
 * `./usePeriodMode`.
 */

/** The display cookie mirroring `PeriodSettings.enabled` for the entry redirect. */
export const PERIOD_MODE_COOKIE = 'tasktick-period-mode';

/** The value written for a given switch state. */
export function periodModeCookie(enabled: boolean): string {
  return enabled ? 'on' : 'off';
}

/** Reads the cookie; anything but an explicit `on` is off. */
export function periodModeFromCookie(value: string | undefined): boolean {
  return value === 'on';
}
