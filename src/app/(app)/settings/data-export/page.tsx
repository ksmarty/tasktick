'use client';

/**
 * Data: export everything, and the read-only facts about this instance.
 *
 * The export links are the JSON dump and the ICS calendar file. The "This
 * instance" card is the capability list the old Advanced page carried: it is how
 * a self-hoster finds out whether push and OIDC are wired up without reading the
 * boot log, and it belongs next to the data you can take with you. The on/off
 * marker is a shadcn `Badge` — Celestial Sapphire has no success token, so the
 * state is carried by the badge's fill and its word rather than a hue.
 *
 * A `flex flex-col gap-stack` column inset by `px-gutter`, like every other
 * settings section.
 */
import { PageHeader } from '@/components/app/PageHeader';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useResource } from '@/lib/store';
import { BackToSettings } from '@/components/settings/BackToSettings';
import { DataExportCard } from '@/components/settings/DataExportCard';
import { SettingsGroup, SettingsRow } from '@/components/settings/SettingsGroup';
import { SettingsTabs } from '@/components/settings/SettingsTabs';
import type { BootstrapPayload } from '@/lib/view-types';

export default function DataSettingsPage() {
  const bootstrap = useResource<BootstrapPayload>('/api/bootstrap');

  return (
    <div className="flex flex-col gap-stack px-gutter pt-4 pb-6">
      <PageHeader title="Data" leading={<BackToSettings />} />

      <SettingsTabs active="data">
        <DataExportCard />

        {!bootstrap.data ? (
          <Skeleton className="h-40 w-full" />
        ) : (
          <SettingsGroup title="This instance" footer="Read-only facts about the server you are connected to.">
            <CapabilityRow
              title="Push notifications"
              subtitle={bootstrap.data.capabilities.push ? 'Configured (VAPID keys present)' : 'Not configured'}
              on={bootstrap.data.capabilities.push}
            />
            <CapabilityRow
              title="Single sign-on"
              subtitle={bootstrap.data.capabilities.oidc ? 'OIDC provider configured' : 'Email and password only'}
              on={bootstrap.data.capabilities.oidc}
            />
            <SettingsRow>
              <span className="min-w-0 flex-1">
                <span className="block text-sm">Time zone</span>
                <span className="block text-xs text-muted-foreground">{bootstrap.data.settings.timezone}</span>
              </span>
            </SettingsRow>
            <SettingsRow>
              <span className="min-w-0 flex-1">
                <span className="block text-sm">Week starts on</span>
                <span className="block text-xs text-muted-foreground">
                  {bootstrap.data.settings.weekStartsOn === 0 ? 'Sunday' : 'Monday'}
                </span>
              </span>
            </SettingsRow>
          </SettingsGroup>
        )}
      </SettingsTabs>
    </div>
  );
}

/** A read-only fact with an on/off badge. */
function CapabilityRow({ title, subtitle, on }: { title: string; subtitle: string; on: boolean }) {
  return (
    <SettingsRow>
      <span className="min-w-0 flex-1">
        <span className="block text-sm">{title}</span>
        <span className="block text-xs text-muted-foreground">{subtitle}</span>
      </span>
      <Badge variant={on ? 'default' : 'secondary'}>{on ? 'On' : 'Off'}</Badge>
    </SettingsRow>
  );
}
