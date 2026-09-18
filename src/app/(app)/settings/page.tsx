'use client';

/**
 * Settings: the index.
 *
 * The rule this page follows is that the things you change often live inline
 * (appearance, time zone, clock format) and the things you configure once get
 * their own screen (calendars, notifications, focus, admin). Everything here is
 * a real write against `/api/settings` or `/api/bootstrap`; nothing is a mock.
 *
 * The header is owned by the app shell: this page publishes its title through
 * `PageHeader` (see `@/components/app/PageHeader`) rather than stacking a second
 * bar under the shell's, which is what keeps one title row, one safe-area inset
 * and one elevation across every screen.
 *
 * Layout: one `flex flex-col gap-stack` column, inset by `px-gutter`. The gap
 * between cards is stated once here instead of as a bottom margin on each card,
 * which is how the previous version ended up with three different ones.
 */
import Link from 'next/link';
import { BellIcon } from '@svg-animated-icons/react/bell';
import { CalendarIcon } from '@svg-animated-icons/react/calendar';
import { ChevronRightIcon } from '@svg-animated-icons/react/chevron-right';
import { DashboardIcon } from '@svg-animated-icons/react/dashboard';
import { MagnifyingGlassIcon } from '@svg-animated-icons/react/magnifying-glass';
import { PeopleIcon } from '@svg-animated-icons/react/people';
import { StopwatchIcon } from '@svg-animated-icons/react/stopwatch';
import { TimerIcon } from '@svg-animated-icons/react/timer';
import { PageHeader } from '@/components/app/PageHeader';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { useResource } from '@/lib/store';
import { AccountSettings } from '@/components/settings/AccountSettings';
import { AppearanceSettings } from '@/components/settings/AppearanceSettings';
import { DateTimeSettings } from '@/components/settings/DateTimeSettings';
import { SETTINGS_ROW_CLASS, SettingsGroup } from '@/components/settings/SettingsGroup';
import type { BootstrapPayload } from '@/lib/view-types';
import type { ReactNode } from 'react';

export default function SettingsPage() {
  const bootstrap = useResource<BootstrapPayload>('/api/bootstrap');
  const data = bootstrap.data;

  return (
    <div className="flex flex-col gap-stack px-gutter pb-6">
      {/* No back control: Settings is a top-level destination, reached from the
          sidebar and from the tab bar. */}
      <PageHeader title="Settings" />

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

          <SettingsGroup title="Calendars and sync" footer="CalDAV accounts, local calendars and read-only feeds.">
            <SectionLink
              href="/settings/calendars"
              icon={<CalendarIcon />}
              title="Calendars"
              subtitle="Accounts, colours, subscriptions"
            />
          </SettingsGroup>

          <SettingsGroup title="Notifications">
            <SectionLink
              href="/settings/notifications"
              icon={<BellIcon />}
              title="Push and reminders"
              subtitle={`${data.capabilities.push ? 'Push available' : 'Push not configured'} · reminders ${data.settings.notificationsEnabled ? 'on' : 'off'}`}
            />
          </SettingsGroup>

          <SettingsGroup title="Focus and data" footer="Pomodoro lengths, export and offline behaviour.">
            <SectionLink
              href="/settings/advanced"
              icon={<TimerIcon />}
              title="Focus and advanced"
              subtitle={`${data.settings.pomodoroFocus} min focus · ${data.settings.pomodoroLongBreakEvery} sessions per long break`}
            />
          </SettingsGroup>

          {/*
           * Tools is the phone's only door to the matrix, the focus timer and
           * search: they used to live behind the tab bar's "More" sheet, which
           * is gone, and the desktop sidebar is not on a phone. On mobile this
           * group is therefore load-bearing, not a convenience.
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

          {data.user.isAdmin ? (
            <SettingsGroup title="Instance" footer="Only administrators see this section.">
              <SectionLink
                href="/settings/admin"
                icon={<PeopleIcon />}
                title="Users and invitations"
                subtitle="Invite people, promote or disable accounts"
              />
            </SettingsGroup>
          ) : null}
        </>
      )}
    </div>
  );
}

/** One navigational settings row: an icon, two lines and a chevron. */
function SectionLink({
  href,
  icon,
  title,
  subtitle,
}: {
  href: string;
  icon: ReactNode;
  title: string;
  subtitle: string;
}) {
  return (
    <Link
      href={href}
      className={cn(SETTINGS_ROW_CLASS, 'flex items-center gap-3 transition-colors hover:bg-accent/50')}
    >
      <span className="shrink-0 text-muted-foreground">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm">{title}</span>
        <span className="block truncate text-xs text-muted-foreground">{subtitle}</span>
      </span>
      <ChevronRightIcon className="shrink-0 text-muted-foreground" />
    </Link>
  );
}
