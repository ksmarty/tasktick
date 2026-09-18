'use client';

/**
 * Date & time: the time zone, the first day of the week and the clock format.
 *
 * These were sharing the Account landing tab; they are per-person preferences
 * with an immediate effect and enough of them to deserve their own section.
 *
 * A `flex flex-col gap-stack` column inset by `px-gutter`, like every other
 * settings section.
 */
import { PageHeader } from '@/components/app/PageHeader';
import { Skeleton } from '@/components/ui/skeleton';
import { useResource } from '@/lib/store';
import { BackToSettings } from '@/components/settings/BackToSettings';
import { DateTimeSettings } from '@/components/settings/DateTimeSettings';
import { SettingsTabs } from '@/components/settings/SettingsTabs';
import type { BootstrapPayload } from '@/lib/view-types';

export default function DateTimeSettingsPage() {
  const bootstrap = useResource<BootstrapPayload>('/api/bootstrap');

  return (
    <div className="flex flex-col gap-stack px-gutter pt-4 pb-6">
      <PageHeader title="Date & time" leading={<BackToSettings />} />

      <SettingsTabs active="date-time">
        {!bootstrap.data ? (
          <Skeleton className="h-40 w-full" />
        ) : (
          <DateTimeSettings settings={bootstrap.data.settings} />
        )}
      </SettingsTabs>
    </div>
  );
}
