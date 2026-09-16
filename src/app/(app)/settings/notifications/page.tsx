'use client';

/**
 * Notification settings.
 */
import { NavBar, Skeleton } from '@/components/ui';
import { useResource } from '@/lib/store';
import { NotificationSettings } from '@/components/settings/NotificationSettings';
import { SettingsGroup } from '@/components/settings/SettingsGroup';
import type { SettingsPayload } from '@/lib/view-types';

export default function NotificationSettingsPage() {
  const settings = useResource<SettingsPayload>('/api/settings');

  return (
    <div className="pb-8">
      <NavBar title="Notifications" back backHref="/settings" backLabel="Settings" largeTitle />

      {!settings.data ? (
        <div className="space-y-4 px-4 pt-2">
          <Skeleton variant="rect" className="h-40" />
          <Skeleton variant="rect" className="h-24" />
        </div>
      ) : (
        <>
          <NotificationSettings payload={settings.data} onChanged={() => void settings.refresh()} />
          <SettingsGroup
            title="What gets sent"
            footer="Reminders are scheduled from each task's own due date and time. Notifications never include your task notes."
          >
            <div className="px-4 py-3">
              <p className="text-body text-label">Task reminders</p>
              <p className="pt-1 text-footnote text-secondary">
                {settings.data.settings.notificationsEnabled
                  ? 'On: due tasks and reminders are pushed to your registered devices.'
                  : 'Off: nothing is pushed, but reminders still appear in the app.'}
              </p>
            </div>
          </SettingsGroup>
        </>
      )}
    </div>
  );
}
