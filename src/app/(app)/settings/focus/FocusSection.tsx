'use client';

/**
 * The Focus section, shared by `/settings/focus` and its legacy
 * `/settings/advanced` alias.
 *
 * The two routes show the same controls, but each names itself in the shell's
 * header, so the title is a parameter rather than a constant. The alias marks
 * Focus as the active section (it is the Focus controls), while its own header
 * says "Advanced" — the URL the pomodoro timer links to. The body lives here so
 * the two pages cannot drift apart; only the header differs.
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

export function FocusSection({ title }: { title: string }) {
  const bootstrap = useResource<BootstrapPayload>('/api/bootstrap');

  return (
    <div className="flex flex-col gap-stack px-gutter pt-4 pb-6">
      <PageHeader title={title} leading={<BackToSettings />} />

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
