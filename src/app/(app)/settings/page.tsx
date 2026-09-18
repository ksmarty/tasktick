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
 * The header is owned by the app shell: this page publishes its title through
 * `PageHeader` rather than stacking a second bar under the shell's, which is what
 * keeps one title row, one safe-area inset and one elevation across every screen.
 *
 * Layout: one `flex flex-col gap-stack` column, inset by `px-gutter` and given a
 * top gutter so the first group does not sit flush against the app bar.
 */
import { PageHeader } from '@/components/app/PageHeader';
import { Skeleton } from '@/components/ui/skeleton';
import { useResource } from '@/lib/store';
import { AccountSettings } from '@/components/settings/AccountSettings';
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
          </>
        ) : (
          <AccountSettings user={data.user} />
        )}
      </SettingsTabs>
    </div>
  );
}
