'use client';

/**
 * Focus defaults, data export, and what this instance can do.
 *
 * The capability list is not decoration: it is how a self-hoster finds out
 * whether push and OIDC are wired up without reading the boot log.
 */
import { NavBar, ListRow, Skeleton } from '@/components/ui';
import { useResource } from '@/lib/store';
import { DataExportCard } from '@/components/settings/DataExportCard';
import { FocusSettings } from '@/components/settings/FocusSettings';
import { SettingsGroup } from '@/components/settings/SettingsGroup';
import type { BootstrapPayload } from '@/lib/view-types';

export default function AdvancedSettingsPage() {
  const bootstrap = useResource<BootstrapPayload>('/api/bootstrap');

  return (
    <div className="pb-8">
      <NavBar title="Advanced" back backHref="/settings" backLabel="Settings" largeTitle />

      {!bootstrap.data ? (
        <div className="space-y-4 px-4 pt-2">
          <Skeleton variant="rect" className="h-40" />
          <Skeleton variant="rect" className="h-24" />
        </div>
      ) : (
        <>
          <FocusSettings settings={bootstrap.data.settings} />
          <DataExportCard />

          <SettingsGroup title="This instance" footer="Read-only facts about the server you are connected to.">
            <ListRow
              title="Push notifications"
              subtitle={bootstrap.data.capabilities.push ? 'Configured (VAPID keys present)' : 'Not configured'}
              trailing={
                <span className="flex items-center gap-1 text-footnote">
                  <span
                    className={
                      bootstrap.data.capabilities.push
                        ? 'size-2 rounded-full bg-success'
                        : 'size-2 rounded-full bg-fill-secondary'
                    }
                    aria-hidden
                  />
                  {bootstrap.data.capabilities.push ? 'On' : 'Off'}
                </span>
              }
            />
            <ListRow
              title="Single sign-on"
              subtitle={bootstrap.data.capabilities.oidc ? 'OIDC provider configured' : 'Email and password only'}
              trailing={
                <span className="flex items-center gap-1 text-footnote">
                  <span
                    className={
                      bootstrap.data.capabilities.oidc
                        ? 'size-2 rounded-full bg-success'
                        : 'size-2 rounded-full bg-fill-secondary'
                    }
                    aria-hidden
                  />
                  {bootstrap.data.capabilities.oidc ? 'On' : 'Off'}
                </span>
              }
            />
            <ListRow title="Time zone" subtitle={bootstrap.data.settings.timezone} />
            <ListRow title="Week starts on" subtitle={bootstrap.data.settings.weekStartsOn === 0 ? 'Sunday' : 'Monday'} />
          </SettingsGroup>
        </>
      )}
    </div>
  );
}
