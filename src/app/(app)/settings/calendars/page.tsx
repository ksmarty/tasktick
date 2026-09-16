'use client';

/**
 * Calendar settings: the accounts, the calendars they brought with them, and the
 * read-only feeds other apps can subscribe to.
 */
import { useState } from 'react';
import { Plus } from 'lucide-react';
import { Button, NavBar, Skeleton } from '@/components/ui';
import { useResource } from '@/lib/store';
import { CalDavAccountRow } from '@/components/settings/CalDavAccountRow';
import { CalDavAccountSheet } from '@/components/settings/CalDavAccountSheet';
import { CalendarListEditor } from '@/components/settings/CalendarListEditor';
import { IcalSubscriptionCard } from '@/components/settings/IcalSubscriptionCard';
import { SettingsGroup } from '@/components/settings/SettingsGroup';
import type { AccountsPayload } from '@/lib/view-types';
import type { CaldavAccount } from '@/lib/types';

export default function CalendarSettingsPage() {
  const accounts = useResource<AccountsPayload>('/api/caldav/accounts');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<CaldavAccount | null>(null);

  const list = accounts.data ?? [];

  function openSheet(account: CaldavAccount | null) {
    setEditing(account);
    setSheetOpen(true);
  }

  return (
    <div className="pb-8">
      <NavBar title="Calendars" back backHref="/settings" backLabel="Settings" largeTitle />

      {accounts.isInitialLoading ? (
        <div className="px-4 pt-2">
          <Skeleton variant="rect" className="h-32" />
        </div>
      ) : (
        <SettingsGroup
          title="CalDAV accounts"
          action={
            <Button size="sm" variant="plain" icon={Plus} onClick={() => openSheet(null)}>
              Add
            </Button>
          }
          footer="TaskTick keeps both sides in step. Run Discover once after adding an account so its calendars appear below."
        >
          {list.length === 0 ? (
            <div className="px-4 py-4">
              <p className="text-body text-label">No accounts connected</p>
              <p className="pt-1 text-footnote text-secondary">
                Connect iCloud, Fastmail, Nextcloud or any other CalDAV server to sync your calendars both ways.
              </p>
              <div className="pt-3">
                <Button variant="tinted" icon={Plus} onClick={() => openSheet(null)}>
                  Add a CalDAV account
                </Button>
              </div>
            </div>
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

      <CalendarListEditor />
      <IcalSubscriptionCard />

      <CalDavAccountSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        account={editing}
        onSaved={() => void accounts.refresh()}
      />
    </div>
  );
}
