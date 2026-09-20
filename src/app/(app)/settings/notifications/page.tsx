'use client';

/**
 * Notification settings.
 *
 * A `flex flex-col gap-stack` column inset by `px-gutter`, like every other
 * settings screen: the cards are the same width and the same distance apart
 * whether you arrive here from the index or from a deep link. All the platform
 * logic lives in `NotificationSettings`; this page only loads the payload.
 */
import { Skeleton } from '@/components/ui/skeleton';
import { useResource } from '@/lib/store';
import { NotificationSettings } from '@/components/settings/NotificationSettings';
import { AppriseSettings } from '@/components/settings/AppriseSettings';
import { SettingsGroup, SettingsRow } from '@/components/settings/SettingsGroup';
import type { SettingsPayload } from '@/lib/view-types';

export default function NotificationSettingsPage() {
  const settings = useResource<SettingsPayload>('/api/settings');

  return (
    <div className="flex flex-col gap-stack px-gutter pt-4 pb-6">
      {!settings.data ? (
        <>
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-24 w-full" />
        </>
      ) : (
        <>
          <NotificationSettings payload={settings.data} onChanged={() => void settings.refresh()} />
          <AppriseSettings payload={settings.data} onChanged={() => void settings.refresh()} />
          <SettingsGroup
            title="What gets sent"
            footer="Reminders are scheduled from each task's own due date and time. Notifications never include your task notes."
          >
            <SettingsRow>
              <span className="min-w-0 flex-1">
                <span className="block text-sm">Task reminders</span>
                <span className="block pt-0.5 text-xs text-muted-foreground">
                  {settings.data.settings.notificationsEnabled
                    ? 'On: due tasks and reminders are pushed to your registered devices.'
                    : 'Off: nothing is pushed, but reminders still appear in the app.'}
                </span>
              </span>
            </SettingsRow>
          </SettingsGroup>
        </>
      )}
    </div>
  );
}
