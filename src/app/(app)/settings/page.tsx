'use client';

/**
 * Settings: the index, and the Account tab.
 *
 * Settings is split into four tabs (Account, Notifications, Calendars,
 * Advanced). Each is a real route, and the tab bar in `SettingsTabs` drives the
 * router, so the URL always names the section you are in and the sub-routes
 * other screens link to keep working.
 *
 * The Account tab is the default because it is the one the user opens Settings
 * for. It holds the things that are personal to the signed-in account: the
 * name/email/password, how the app looks, and the time zone and clock. Those
 * last two are deliberately here rather than under a separate Preferences tab —
 * they are per-person choices with an instant effect, and keeping them on the
 * landing tab means the theme and clock controls are reachable without a second
 * tap (which is also what the settings probe assumes).
 *
 * The header is owned by the app shell: this page publishes its title through
 * `PageHeader` rather than stacking a second bar under the shell's, which is what
 * keeps one title row, one safe-area inset and one elevation across every screen.
 *
 * Layout: one `flex flex-col gap-stack` column, inset by `px-gutter` and given a
 * top gutter so the first group does not sit flush against the app bar — the
 * specific complaint that the Account section "has no margin".
 */
import { DashboardIcon } from '@svg-animated-icons/react/dashboard';
import { MagnifyingGlassIcon } from '@svg-animated-icons/react/magnifying-glass';
import { StopwatchIcon } from '@svg-animated-icons/react/stopwatch';
import { PageHeader } from '@/components/app/PageHeader';
import { Skeleton } from '@/components/ui/skeleton';
import { useResource } from '@/lib/store';
import { AccountSettings } from '@/components/settings/AccountSettings';
import { AppearanceSettings } from '@/components/settings/AppearanceSettings';
import { DateTimeSettings } from '@/components/settings/DateTimeSettings';
import { SectionLink } from '@/components/settings/SectionLink';
import { SettingsGroup } from '@/components/settings/SettingsGroup';
import { SettingsTabs } from '@/components/settings/SettingsTabs';
import type { BootstrapPayload } from '@/lib/view-types';

export default function SettingsPage() {
  const bootstrap = useResource<BootstrapPayload>('/api/bootstrap');
  const data = bootstrap.data;

  return (
    <div className="flex flex-col gap-stack px-gutter pt-4 pb-6">
      {/* No back control: Settings is a top-level destination, reached from the
          sidebar and from the tab bar. */}
      <PageHeader title="Settings" />

      <SettingsTabs active="account">
        {!data ? (
          <>
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-24 w-full" />
          </>
        ) : (
          <>
            <AccountSettings user={data.user} />
            <AppearanceSettings />
            <DateTimeSettings settings={data.settings} />
          </>
        )}
      </SettingsTabs>

      {/*
       * Tools is app navigation, not a preference, so it deliberately sits
       * outside the tab panels — but it has to sit somewhere. On a phone it is
       * the only door to the matrix, the focus timer and search: they used to
       * live behind the tab bar's "More" sheet, which is gone, and the desktop
       * sidebar is not on a phone. Keep it on the settings landing screen.
       */}
      <SettingsGroup title="Tools" footer="Also in the desktop sidebar.">
        <SectionLink
          href="/matrix"
          icon={<DashboardIcon />}
          title="Priority matrix"
          subtitle="Urgent and important, at a glance"
        />
        <SectionLink href="/pomodoro" icon={<StopwatchIcon />} title="Focus timer" subtitle="Pomodoro sessions" />
        <SectionLink href="/search" icon={<MagnifyingGlassIcon />} title="Search" subtitle="Tasks, events and habits" />
      </SettingsGroup>
    </div>
  );
}
