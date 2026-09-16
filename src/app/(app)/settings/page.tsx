'use client';

/**
 * Settings: the index.
 *
 * The rule this page follows is that the things you change often live inline
 * (appearance, time zone, clock format) and the things you configure once get
 * their own screen (calendars, notifications, focus, admin). Everything here is
 * a real write against `/api/settings` or `/api/bootstrap`; nothing is a mock.
 */
import { Bell, ChevronRight, Cloud, Palmtree, ShieldCheck } from 'lucide-react';
import { ListRow, NavBar, Skeleton } from '@/components/ui';
import { useResource } from '@/lib/store';
import { AccountSettings } from '@/components/settings/AccountSettings';
import { AppearanceSettings } from '@/components/settings/AppearanceSettings';
import { DateTimeSettings } from '@/components/settings/DateTimeSettings';
import { SettingsGroup } from '@/components/settings/SettingsGroup';
import type { BootstrapPayload } from '@/lib/view-types';

export default function SettingsPage() {
  const bootstrap = useResource<BootstrapPayload>('/api/bootstrap');
  const data = bootstrap.data;

  return (
    <div className="min-h-dvh pb-8">
      <NavBar title="Settings" back backHref="/today" backLabel="Today" largeTitle />

      {!data ? (
        <div className="space-y-4 px-4 pt-2">
          <Skeleton variant="rect" className="h-24" />
          <Skeleton variant="rect" className="h-32" />
          <Skeleton variant="rect" className="h-24" />
        </div>
      ) : (
        <>
          <AccountSettings user={data.user} />
          <AppearanceSettings />
          <DateTimeSettings settings={data.settings} />

          <SettingsGroup title="Calendars and sync" footer="CalDAV accounts, local calendars and read-only feeds.">
            <ListRow
              title="Calendars"
              subtitle="Accounts, colours, subscriptions"
              leading={<Cloud className="size-5" aria-hidden />}
              trailing={<ChevronRight className="size-4 text-tertiary" aria-hidden />}
              href="/settings/calendars"
            />
          </SettingsGroup>

          <SettingsGroup title="Notifications">
            <ListRow
              title="Push and reminders"
              subtitle={`${data.capabilities.push ? 'Push available' : 'Push not configured'} · reminders ${data.settings.notificationsEnabled ? 'on' : 'off'}`}
              leading={<Bell className="size-5" aria-hidden />}
              trailing={<ChevronRight className="size-4 text-tertiary" aria-hidden />}
              href="/settings/notifications"
            />
          </SettingsGroup>

          <SettingsGroup title="Focus and data" footer="Pomodoro lengths, export and offline behaviour.">
            <ListRow
              title="Focus and advanced"
              subtitle={`${data.settings.pomodoroFocus} min focus · ${data.settings.pomodoroLongBreakEvery} sessions per long break`}
              leading={<Palmtree className="size-5" aria-hidden />}
              trailing={<ChevronRight className="size-4 text-tertiary" aria-hidden />}
              href="/settings/advanced"
            />
          </SettingsGroup>

          {data.user.isAdmin ? (
            <SettingsGroup title="Instance" footer="Only administrators see this section.">
              <ListRow
                title="Users and invitations"
                subtitle="Invite people, promote or disable accounts"
                leading={<ShieldCheck className="size-5" aria-hidden />}
                trailing={<ChevronRight className="size-4 text-tertiary" aria-hidden />}
                href="/settings/admin"
              />
            </SettingsGroup>
          ) : null}
        </>
      )}
    </div>
  );
}
