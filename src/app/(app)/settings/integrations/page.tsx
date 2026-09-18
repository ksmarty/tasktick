'use client';

/**
 * Integrations: the CalDAV accounts this instance syncs with.
 *
 * These rows used to live at the top of Calendars, but "which accounts am I
 * connected to" and "which of my calendars are visible" are two concerns. The
 * accounts and their add/edit sheet are here; the calendars those accounts
 * brought with them, plus the read-only feeds, stay under Calendars.
 *
 * The sheet is mounted once here and driven by `editing`, so the empty state's
 * button and the caption's "Add" open the same dialog rather than two
 * near-copies of it.
 */
import { useState } from 'react';
import { PlusIcon } from '@svg-animated-icons/react/plus';
import { PageHeader } from '@/components/app/PageHeader';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useResource } from '@/lib/store';
import { BackToSettings } from '@/components/settings/BackToSettings';
import { CalDavAccountRow } from '@/components/settings/CalDavAccountRow';
import { CalDavAccountSheet } from '@/components/settings/CalDavAccountSheet';
import { SettingsGroup, SettingsRow } from '@/components/settings/SettingsGroup';
import { SettingsTabs } from '@/components/settings/SettingsTabs';
import type { AccountsPayload } from '@/lib/view-types';
import type { CaldavAccount } from '@/lib/types';

export default function IntegrationsSettingsPage() {
  const accounts = useResource<AccountsPayload>('/api/caldav/accounts');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<CaldavAccount | null>(null);

  const list = accounts.data ?? [];

  function openSheet(account: CaldavAccount | null) {
    setEditing(account);
    setSheetOpen(true);
  }

  return (
    <div className="flex flex-col gap-stack px-gutter pt-4 pb-6">
      <PageHeader title="Integrations" leading={<BackToSettings />} />

      <SettingsTabs active="integrations">
        {accounts.isInitialLoading ? (
          <Skeleton className="h-32 w-full" />
        ) : (
          <SettingsGroup
            title="CalDAV accounts"
            action={
              <Button size="sm" variant="ghost" onClick={() => openSheet(null)}>
                <PlusIcon />
                Add
              </Button>
            }
            footer="TaskTick keeps both sides in step. Adding an account discovers its calendars and runs the first sync for you."
          >
            {list.length === 0 ? (
              <SettingsRow stacked>
                <span className="block text-sm">No accounts connected</span>
                <span className="block text-xs text-muted-foreground">
                  Connect iCloud, Fastmail or any other CalDAV server to sync your calendars both ways.
                </span>
                <Button variant="outline" className="self-start" onClick={() => openSheet(null)}>
                  <PlusIcon />
                  Add a CalDAV account
                </Button>
              </SettingsRow>
            ) : (
              list.map((account) => (
                <CalDavAccountRow
                  key={account.id}
                  account={account}
                  onEdit={() => openSheet(account)}
                  onChanged={() => void accounts.refresh()}
                />
              ))
            )}
          </SettingsGroup>
        )}
      </SettingsTabs>

      <CalDavAccountSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        account={editing}
        onSaved={() => void accounts.refresh()}
      />
    </div>
  );
}
