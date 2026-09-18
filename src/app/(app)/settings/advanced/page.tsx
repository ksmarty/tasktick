'use client';

/**
 * Focus defaults, data export, and what this instance can do.
 *
 * The capability list is not decoration: it is how a self-hoster finds out
 * whether push and OIDC are wired up without reading the boot log.
 *
 * A `flex flex-col gap-stack` column inset by `px-gutter`. The on/off marker is a
 * shadcn `Badge` rather than the old green dot: Celestial Sapphire has no success
 * token — the palette is monochrome on purpose — so the state is carried by the
 * badge's fill and its word, which reads the same for everyone instead of relying
 * on a hue that no longer exists.
 */
import { PageHeader } from '@/components/app/PageHeader';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useResource } from '@/lib/store';
import { BackToSettings } from '@/components/settings/BackToSettings';
import { PeopleIcon } from '@svg-animated-icons/react/people';
import { DataExportCard } from '@/components/settings/DataExportCard';
import { FocusSettings } from '@/components/settings/FocusSettings';
import { SectionLink } from '@/components/settings/SectionLink';
import { SettingsGroup, SettingsRow } from '@/components/settings/SettingsGroup';
import { SettingsTabs } from '@/components/settings/SettingsTabs';
import type { BootstrapPayload } from '@/lib/view-types';

export default function AdvancedSettingsPage() {
  const bootstrap = useResource<BootstrapPayload>('/api/bootstrap');

  return (
    <div className="flex flex-col gap-stack px-gutter pt-4 pb-6">
      <PageHeader title="Advanced" leading={<BackToSettings />} />

      <SettingsTabs active="advanced">
        {!bootstrap.data ? (
          <>
            <Skeleton className="h-40 w-full" />
            <Skeleton className="h-24 w-full" />
          </>
        ) : (
          <>
            <FocusSettings settings={bootstrap.data.settings} />
            <DataExportCard />

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

            {/*
             * Administration is a section of Advanced, not a fifth tab: it is
             * only meaningful to administrators, and a tab that appears for some
             * accounts and not others is worse than a link the rest never see.
             * The link keeps `/settings/admin` reachable, so the route stays a
             * real page rather than an orphan.
             */}
            {bootstrap.data.user.isAdmin ? (
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
