'use client';

/**
 * Calendar settings: the calendars you keep, and the read-only feeds other apps
 * can subscribe to.
 *
 * The CalDAV accounts that create synced calendars moved to their own
 * Integrations section, so this page is only about the calendars themselves:
 * rename, recolour, hide, set the default, delete (locals only — a synced
 * calendar has to be removed with its account), and the outgoing subscription
 * URLs.
 *
 * A `flex flex-col gap-stack` column inset by `px-gutter`.
 */
import { PageHeader } from '@/components/app/PageHeader';
import { BackToSettings } from '@/components/settings/BackToSettings';
import { CalendarListEditor } from '@/components/settings/CalendarListEditor';
import { IcalSubscriptionCard } from '@/components/settings/IcalSubscriptionCard';
import { SettingsTabs } from '@/components/settings/SettingsTabs';

export default function CalendarSettingsPage() {
  return (
    <div className="flex flex-col gap-stack px-gutter pt-4 pb-6">
      <PageHeader title="Calendars" leading={<BackToSettings />} />

      <SettingsTabs active="calendars">
        <CalendarListEditor />
        <IcalSubscriptionCard />
      </SettingsTabs>
    </div>
  );
}
