'use client';

/**
 * Focus: the pomodoro timer's default lengths and auto-start behaviour.
 *
 * These lived under the old Advanced catch-all; they are their own concern, so
 * they get their own section. The focus timer itself links here from
 * `/pomodoro` (through the preserved `/settings/advanced` alias).
 *
 * A `flex flex-col gap-stack` column inset by `px-gutter`, like every other
 * settings section.
 */
import { PageHeader } from '@/components/app/PageHeader';
import { Skeleton } from '@/components/ui/skeleton';
import { useResource } from '@/lib/store';
import { BackToSettings } from '@/components/settings/BackToSettings';
import { FocusSettings } from '@/components/settings/FocusSettings';
import { SettingsTabs } from '@/components/settings/SettingsTabs';
import type { BootstrapPayload } from '@/lib/view-types';

export default function FocusSettingsPage() {
  const bootstrap = useResource<BootstrapPayload>('/api/bootstrap');

  return (
    <div className="flex flex-col gap-stack px-gutter pt-4 pb-6">
      <PageHeader title="Focus" leading={<BackToSettings />} />

      <SettingsTabs active="focus">
        {!bootstrap.data ? (
          <Skeleton className="h-40 w-full" />
        ) : (
          <FocusSettings settings={bootstrap.data.settings} />
        )}
      </SettingsTabs>
    </div>
  );
}
