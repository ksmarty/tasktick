'use client';

/**
 * Instance administration.
 *
 * Gated on the bootstrap user's `isAdmin`. A non-administrator does not get a
 * broken screen: they get told, and the admin-only endpoints would refuse them
 * anyway.
 *
 * A `flex flex-col gap-stack` column inset by `px-gutter`; the refusal state is
 * the same column with a centred block in it rather than a second layout.
 */
import { LockClosedIcon } from '@svg-animated-icons/react/lock-closed';
import { PageHeader } from '@/components/app/PageHeader';
import { Skeleton } from '@/components/ui/skeleton';
import { useResource } from '@/lib/store';
import { AdminUserTable } from '@/components/settings/AdminUserTable';
import { BackToSettings } from '@/components/settings/BackToSettings';
import { InviteManager } from '@/components/settings/InviteManager';
import { SettingsTabs } from '@/components/settings/SettingsTabs';
import type { BootstrapPayload } from '@/lib/view-types';

export default function AdminSettingsPage() {
  const bootstrap = useResource<BootstrapPayload>('/api/bootstrap');
  const user = bootstrap.data?.user;

  return (
    <div className="flex flex-col gap-stack px-gutter pt-4 pb-6">
      <PageHeader title="Admin" leading={<BackToSettings />} />

      <SettingsTabs active="advanced">
        {!user ? (
          <>
            <Skeleton className="h-40 w-full" />
            <Skeleton className="h-40 w-full" />
          </>
        ) : !user.isAdmin ? (
          <div className="flex flex-col items-center gap-2 py-6 text-center">
            <span className="mb-1 grid size-14 place-items-center rounded-full bg-muted text-muted-foreground">
              <LockClosedIcon />
            </span>
            <h2 className="text-base font-semibold">Administrators only</h2>
            <p className="max-w-80 text-sm text-muted-foreground">
              This account cannot manage the instance. Ask the person who set up TaskTick to promote you.
            </p>
          </div>
        ) : (
          <>
            <InviteManager />
            <AdminUserTable currentUserId={user.id} />
          </>
        )}
      </SettingsTabs>
    </div>
  );
}
