'use client';

/**
 * Settings: the Account section.
 *
 * Settings is a set of small, single-concern sections (see `SettingsTabs`), each
 * a real route. Account is the landing section because it is the one most people
 * open Settings for: the display name, the sign-in address, the password and the
 * way out. Appearance and Date & time have their own sections, so this page no
 * longer mixes them in.
 *
 * The header is owned by the app shell and published once by the settings
 * layout (see `./layout`): the title is "Settings" on every section, because the
 * section list already says which section is open. This page publishes nothing.
 *
 * Layout: one `flex flex-col gap-stack` column, inset by `px-gutter` and given a
 * top gutter so the first group does not sit flush against the app bar.
 */
import { Skeleton } from '@/components/ui/skeleton';
import { useResource } from '@/lib/store';
import { AccountSettings } from '@/components/settings/AccountSettings';
import { AboutRow } from '@/components/settings/AboutRow';
import { SettingsTabs } from '@/components/settings/SettingsTabs';
import type { BootstrapPayload } from '@/lib/view-types';

export default function SettingsPage() {
  const bootstrap = useResource<BootstrapPayload>('/api/bootstrap');
  const data = bootstrap.data;

  return (
    <div className="flex flex-col gap-stack px-gutter pt-4 pb-6">
      <SettingsTabs active="account">
        {!data ? (
          <>
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-32 w-full" />
          </>
        ) : (
          <>
          <AccountSettings user={data.user} />

          {/* Last, not first: a fact to look up, not a setting. */}
          <AboutRow />
          </>
        )}
      </SettingsTabs>
    </div>
  );
}
