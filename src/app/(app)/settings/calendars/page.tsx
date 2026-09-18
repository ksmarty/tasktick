'use client';

/**
 * Calendar settings: the accounts, the calendars they brought with them, and the
 * read-only feeds other apps can subscribe to.
 */
import { useState } from 'react';
import Link from 'next/link';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import AddIcon from '@mui/icons-material/Add';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { PageHeader } from '@/components/app/PageHeader';
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
    <Box sx={{ pb: 4 }}>
      <PageHeader
        title="Calendars"
        leading={
          <IconButton component={Link} href="/settings" aria-label="Back to Settings" edge="start">
            <ArrowBackIcon aria-hidden />
          </IconButton>
        }
      />

      {accounts.isInitialLoading ? (
        <Stack sx={{ px: 2, pt: 1 }}>
          <Skeleton variant="rounded" height={128} />
        </Stack>
      ) : (
        <SettingsGroup
          title="CalDAV accounts"
          action={
            <Button size="small" variant="text" startIcon={<AddIcon aria-hidden />} onClick={() => openSheet(null)}>
              Add
            </Button>
          }
          footer="TaskTick keeps both sides in step. Run Discover once after adding an account so its calendars appear below."
        >
          {list.length === 0 ? (
            <Box sx={{ px: 2, py: 2 }}>
              <Typography variant="body1">No accounts connected</Typography>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', pt: 0.5 }}>
                Connect iCloud, Fastmail, Nextcloud or any other CalDAV server to sync your calendars both ways.
              </Typography>
              <Box sx={{ pt: 1.5 }}>
                <Button variant="outlined" startIcon={<AddIcon aria-hidden />} onClick={() => openSheet(null)}>
                  Add a CalDAV account
                </Button>
              </Box>
            </Box>
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
    </Box>
  );
}
